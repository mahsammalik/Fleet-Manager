import { Router } from "express";
import { authenticateJWT, requireRole } from "../../middleware/auth";
import { pool } from "../../db/pool";
import { earningsUpload } from "../../config/multer";
import { parseEarningsFile } from "../earnings/parseFile";
import { buildColumnMap } from "../earnings/romanHeaderMap";
import { rowCellsToNormalized } from "../earnings/normalizeRow";
import { detectPlatformWithMeta, isEarningsPlatform, type EarningsPlatform } from "../earnings/detectPlatform";
import { extractDateFromFilename } from "../earnings/filenameDate";
import { insertEarningsPreviewStaging } from "../earnings/earningsPreviewStage";
import { runEarningsCommitFromStaging } from "../earnings/earningsCommit";

const router = Router();

router.use(authenticateJWT);
router.use(requireRole("admin", "accountant"));

/** One-shot: stage + commit in one request (same logic as preview + commit). */
router.post("/earnings-csv", earningsUpload.single("file"), async (req, res) => {
  const orgId = req.user?.orgId;
  const userId = req.user?.sub;
  if (!orgId || !userId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }
  if (!req.file?.buffer) {
    return res.status(400).json({ message: "file is required" });
  }

  const platformRaw = req.body?.platform;
  const weekStart = req.body?.weekStart;
  const weekEnd = req.body?.weekEnd;
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  if (!platformRaw || typeof platformRaw !== "string" || !isEarningsPlatform(platformRaw.trim())) {
    return res.status(400).json({ message: "platform is required and must be a valid earnings provider" });
  }
  if (typeof weekStart !== "string" || typeof weekEnd !== "string" || !isoDate.test(weekStart) || !isoDate.test(weekEnd)) {
    return res.status(400).json({ message: "weekStart and weekEnd are required (YYYY-MM-DD)" });
  }
  if (weekStart > weekEnd) {
    return res.status(400).json({ message: "weekStart must be on or before weekEnd" });
  }

  const platformEff = platformRaw.trim() as EarningsPlatform;

  try {
    const table = await parseEarningsFile(req.file.buffer, req.file.originalname);
    if (!table.headers.length || !table.rows.length) {
      return res.status(400).json({ message: "No data rows found in file" });
    }

    const { confidence: detectionConfidence } = detectPlatformWithMeta(req.file.originalname, table.headers);
    const colMap = buildColumnMap(table.headers);
    const filenameDate = extractDateFromFilename(req.file.originalname);
    const normalizedRows = table.rows.map((cells) =>
      rowCellsToNormalized(cells, colMap, filenameDate, {
        skipInferredPlatformFee: platformEff === "glovo",
      }),
    );

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const importId = await insertEarningsPreviewStaging(client, {
        orgId,
        userId,
        fileName: req.file.originalname,
        weekStart,
        weekEnd,
        platform: platformEff,
        detectionConfidence,
        filenameDate,
        headerCount: table.headers.length,
        rowCount: table.rows.length,
        normalizedRows,
      });
      const commitResult = await runEarningsCommitFromStaging(client, orgId, importId, platformEff, weekStart, weekEnd);
      await client.query("COMMIT");
      return res.json({
        importId,
        ...commitResult,
      });
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Import failed";
    // eslint-disable-next-line no-console
    console.error("One-shot earnings CSV error", err);
    return res.status(400).json({ message: msg });
  }
});

export const importEarningsCsvRoutes = router;
