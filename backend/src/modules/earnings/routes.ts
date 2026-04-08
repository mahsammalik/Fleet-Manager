import { Router } from "express";
import { authenticateJWT, requireRole } from "../../middleware/auth";
import { pool, query } from "../../db/pool";
import { earningsUpload } from "../../config/multer";
import { buildColumnMap } from "./romanHeaderMap";
import { rowCellsToNormalized } from "./normalizeRow";
import {
  detectPlatformWithMeta,
  isEarningsPlatform,
  type EarningsPlatform,
} from "./detectPlatform";
import { extractDateFromFilename, weekBoundsFromDates } from "./filenameDate";
import { parseEarningsFile } from "./parseFile";
import { DriverMatchIndex, type DriverMatchRow } from "./matchDriver";
import { runEarningsCommitFromStaging } from "./earningsCommit";
import { insertEarningsPreviewStaging } from "./earningsPreviewStage";

const router = Router();

router.use(authenticateJWT);
router.use(requireRole("admin", "accountant"));

export type { EarningsStagingPayload } from "./normalizeRow";

function collectWarnings(
  colMap: Map<number, import("./normalizeRow").CanonicalField>,
  normalizedRows: ReturnType<typeof rowCellsToNormalized>[],
  filenameDate: string | null,
  platform: EarningsPlatform,
): string[] {
  const w: string[] = [];
  const hasGross = [...colMap.values()].includes("gross");
  const hasNet = [...colMap.values()].includes("net");
  const hasTransferTotal = [...colMap.values()].includes("transfer_total");
  const hasDate = [...colMap.values()].includes("trip_date");
  if (!hasGross && !hasNet && !hasTransferTotal) {
    w.push("No gross, net, or TVT (total transfer) column detected; check Romanian/English headers.");
  }
  if (!hasDate && !filenameDate) {
    w.push("No trip date column and no date found in filename; rows may lack dates.");
  }
  let noMoney = 0;
  let badMoney = 0;
  let noDate = 0;
  const dupKeys = new Map<string, number>();
  for (const r of normalizedRows) {
    const g = r.amounts.gross;
    const n = r.amounts.net;
    const tt = r.amounts.transferTotal;
    if (g === null && n === null && tt === null) noMoney += 1;
    if (g !== null && g < 0) badMoney += 1;
    if (n !== null && n < 0) badMoney += 1;
    if (tt !== null && tt < 0) badMoney += 1;
    if (!r.tripDateIso) noDate += 1;
    const k = `${r.hints.courierId ?? ""}|${r.hints.phone ?? ""}|${r.hints.plate ?? ""}|${r.tripDateIso ?? ""}|${g ?? ""}|${n ?? ""}|${tt ?? ""}`;
    dupKeys.set(k, (dupKeys.get(k) ?? 0) + 1);
  }
  if (noMoney > 0) w.push(`${noMoney} row(s) have no gross, net, or TVT amount.`);
  if (badMoney > 0) w.push(`${badMoney} row(s) have negative amounts.`);
  if (noDate > 0) w.push(`${noDate} row(s) are missing trip dates.`);
  const dups = [...dupKeys.values()].filter((c) => c > 1).length;
  if (dups > 0) w.push("Possible duplicate rows detected (same identifiers, date, and amounts).");
  if (platform === "glovo") {
    const hasFeeCol = [...colMap.values()].includes("platform_fee");
    const missingFee = normalizedRows.some(
      (r) => r.amounts.platformFee == null && r.amounts.gross != null && r.amounts.net != null,
    );
    if (missingFee) {
      w.push(
        hasFeeCol
          ? "Glovo: fee (Taxa aplicatie) missing on some rows — check comma‑decimal CSV cells or use XLSX export."
          : "Glovo: Taxa aplicatie column not detected; fee will stay empty until headers/columns are recognized.",
      );
    }
  }
  return w;
}

async function loadMatchIndex(orgId: string): Promise<DriverMatchIndex> {
  const { rows: drivers } = await query<DriverMatchRow>(
    `SELECT id, phone, uber_driver_id, bolt_driver_id, glovo_courier_id, bolt_courier_id, wolt_courier_id,
            commission_type, commission_rate::text, fixed_commission_amount::text, minimum_commission::text
     FROM drivers WHERE organization_id = $1`,
    [orgId],
  );
  const { rows: plates } = await query<{ license_plate: string; current_driver_id: string }>(
    `SELECT license_plate, current_driver_id::text
     FROM vehicles
     WHERE organization_id = $1 AND current_driver_id IS NOT NULL`,
    [orgId],
  );
  return new DriverMatchIndex(drivers, plates);
}

router.post("/earnings/import/preview", earningsUpload.single("file"), async (req, res) => {
  const orgId = req.user?.orgId;
  const userId = req.user?.sub;
  if (!orgId || !userId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }
  if (!req.file?.buffer) {
    return res.status(400).json({ message: "file is required" });
  }

  try {
    const table = await parseEarningsFile(req.file.buffer, req.file.originalname);
    if (!table.headers.length || !table.rows.length) {
      return res.status(400).json({ message: "No data rows found in file" });
    }

    const { platform, confidence: detectionConfidence } = detectPlatformWithMeta(
      req.file.originalname,
      table.headers,
    );
    const colMap = buildColumnMap(table.headers);
    const filenameDate = extractDateFromFilename(req.file.originalname);

    const normalizedRows = table.rows.map((cells) =>
      rowCellsToNormalized(cells, colMap, filenameDate, {
        skipInferredPlatformFee: platform === "glovo",
      }),
    );

    const warnings = collectWarnings(colMap, normalizedRows, filenameDate, platform);
    const dates = normalizedRows.map((r) => r.tripDateIso).filter((d): d is string => !!d);
    const { weekStart, weekEnd } = weekBoundsFromDates(dates);

    const index = await loadMatchIndex(orgId);
    let matched = 0;
    const previewSlice = normalizedRows.slice(0, 10).map((r, i) => {
      const { driverId, matchMethod } = index.match(platform, r.hints);
      if (driverId) matched += 1;
      return {
        rowIndex: i,
        tripDate: r.tripDateIso,
        gross: r.amounts.gross,
        net: r.amounts.net,
        transferTotal: r.amounts.transferTotal,
        platformFee: r.amounts.platformFee,
        dailyCash: r.amounts.dailyCash,
        accountOpeningFee: r.amounts.accountOpeningFee,
        tripCount: r.amounts.tripCount,
        matchMethod,
        driverMatched: !!driverId,
        hints: r.hints,
      };
    });

    const totalMatchPreview = normalizedRows.filter((r) => index.match(platform, r.hints).driverId).length;
    const matchRate =
      normalizedRows.length === 0 ? 0 : Math.round((1000 * totalMatchPreview) / normalizedRows.length) / 1000;

    const client = await pool.connect();
    let importId: string;
    try {
      await client.query("BEGIN");
      importId = await insertEarningsPreviewStaging(client, {
        orgId,
        userId,
        fileName: req.file.originalname,
        weekStart,
        weekEnd,
        platform,
        detectionConfidence,
        filenameDate,
        headerCount: table.headers.length,
        rowCount: table.rows.length,
        normalizedRows,
      });
      await client.query("COMMIT");
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      client.release();
      throw e;
    }
    client.release();

    return res.json({
      importId,
      platform,
      detectionConfidence,
      fileName: req.file.originalname,
      totalRows: normalizedRows.length,
      matchedPreviewCount: totalMatchPreview,
      matchRate,
      weekStart,
      weekEnd,
      warnings,
      previewRows: previewSlice,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Import failed";
    // eslint-disable-next-line no-console
    console.error("Earnings preview error", err);
    return res.status(400).json({ message: msg });
  }
});

router.post("/earnings/import/commit", async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }
  const body = req.body as {
    importId?: string;
    platform?: string;
    weekStart?: string;
    weekEnd?: string;
  };
  const importId = body.importId;
  if (!importId || typeof importId !== "string") {
    return res.status(400).json({ message: "importId is required" });
  }

  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  if (body.platform !== undefined && body.platform !== null && String(body.platform).trim() !== "") {
    if (!isEarningsPlatform(String(body.platform))) {
      return res.status(400).json({ message: "Invalid platform" });
    }
  }
  if (body.weekStart !== undefined && body.weekStart !== "" && !isoDate.test(body.weekStart)) {
    return res.status(400).json({ message: "weekStart must be YYYY-MM-DD" });
  }
  if (body.weekEnd !== undefined && body.weekEnd !== "" && !isoDate.test(body.weekEnd)) {
    return res.status(400).json({ message: "weekEnd must be YYYY-MM-DD" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const impRes = await client.query<{
      id: string;
      platform: EarningsPlatform;
      week_start: string;
      week_end: string;
      status: string;
    }>(
      `SELECT id, platform, week_start::text, week_end::text, status
       FROM earnings_imports
       WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
      [importId, orgId],
    );
    const imp = impRes.rows[0];
    if (!imp) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Import not found" });
    }
    if (imp.status !== "preview") {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Import is not in preview status" });
    }

    let platformEff: EarningsPlatform = imp.platform;
    let weekStartEff = imp.week_start.slice(0, 10);
    let weekEndEff = imp.week_end.slice(0, 10);

    if (body.platform !== undefined && body.platform !== null && String(body.platform).trim() !== "") {
      platformEff = String(body.platform) as EarningsPlatform;
    }
    if (body.weekStart !== undefined && body.weekStart !== "") {
      weekStartEff = body.weekStart;
    }
    if (body.weekEnd !== undefined && body.weekEnd !== "") {
      weekEndEff = body.weekEnd;
    }
    if (weekStartEff > weekEndEff) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "weekStart must be on or before weekEnd" });
    }

    await client.query(
      `UPDATE earnings_imports
       SET platform = $1, week_start = $2::date, week_end = $3::date
       WHERE id = $4 AND organization_id = $5`,
      [platformEff, weekStartEff, weekEndEff, importId, orgId],
    );

    const commitResult = await runEarningsCommitFromStaging(
      client,
      orgId,
      importId,
      platformEff,
      weekStartEff,
      weekEndEff,
    );

    await client.query("COMMIT");

    return res.json({
      importId,
      insertedRows: commitResult.insertedRows,
      skippedNoDriver: commitResult.skippedNoDriver,
      skippedNoDate: commitResult.skippedNoDate,
      skippedNoMoney: commitResult.skippedNoMoney,
      totals: commitResult.totals,
    });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line no-console
    console.error("Earnings commit error", err);
    return res.status(500).json({ message: "Commit failed" });
  } finally {
    client.release();
  }
});

router.delete("/earnings/import/:id", async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }
  const { id } = req.params;
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM earnings_imports WHERE id = $1 AND organization_id = $2 AND status = 'preview'`,
      [id, orgId],
    );
    if (!rowCount) {
      return res.status(404).json({ message: "Preview import not found or already completed" });
    }
    return res.status(204).send();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Earnings cancel error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.put("/earnings/payouts/:id/recalculate", async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) return res.status(400).json({ message: "User is not associated with an organization" });
  const { id } = req.params;
  try {
    const result = await pool.query<{
      id: string;
      driver_payout: string | null;
      net_earnings: string | null;
      cash_commission: string | null;
      company_commission: string | null;
    }>(
      `UPDATE earnings_records er
       SET
         driver_payout = GREATEST(
           0,
           ROUND(
             (
               COALESCE(
                 er.total_transfer_earnings,
                 er.net_earnings,
                 COALESCE(er.gross_earnings, 0) - COALESCE(er.platform_fee, 0),
                 er.gross_earnings,
                 0
               ) - ABS(COALESCE(er.transfer_commission, 0)) - ABS(COALESCE(er.cash_commission, 0))
             )::numeric,
             2
           )
         ),
         net_earnings = GREATEST(
           0,
           ROUND(
             (
               COALESCE(
                 er.total_transfer_earnings,
                 er.net_earnings,
                 COALESCE(er.gross_earnings, 0) - COALESCE(er.platform_fee, 0),
                 er.gross_earnings,
                 0
               ) - ABS(COALESCE(er.transfer_commission, 0)) - ABS(COALESCE(er.cash_commission, 0))
             )::numeric,
             2
           )
         )
       FROM earnings_imports ei
       WHERE er.import_id = ei.id
         AND ei.organization_id = $1
         AND er.id = $2::uuid
       RETURNING er.id, er.driver_payout::text, er.net_earnings::text, er.cash_commission::text, er.company_commission::text`,
      [orgId, id],
    );
    if (!result.rowCount) return res.status(404).json({ message: "Payout record not found" });
    return res.json({ updated: true, row: result.rows[0] });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Recalculate payout by id error", err);
    return res.status(500).json({ message: "Failed to recalculate payout" });
  }
});

router.post("/earnings/payouts/recalculate-bulk", async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) return res.status(400).json({ message: "User is not associated with an organization" });
  const onlyCash = (req.body as { onlyCashCommission?: boolean } | undefined)?.onlyCashCommission ?? true;
  try {
    const result = await pool.query<{ id: string }>(
      `UPDATE earnings_records er
       SET
         driver_payout = GREATEST(
           0,
           ROUND(
             (
               COALESCE(
                 er.total_transfer_earnings,
                 er.net_earnings,
                 COALESCE(er.gross_earnings, 0) - COALESCE(er.platform_fee, 0),
                 er.gross_earnings,
                 0
               ) - ABS(COALESCE(er.transfer_commission, 0)) - ABS(COALESCE(er.cash_commission, 0))
             )::numeric,
             2
           )
         ),
         net_earnings = GREATEST(
           0,
           ROUND(
             (
               COALESCE(
                 er.total_transfer_earnings,
                 er.net_earnings,
                 COALESCE(er.gross_earnings, 0) - COALESCE(er.platform_fee, 0),
                 er.gross_earnings,
                 0
               ) - ABS(COALESCE(er.transfer_commission, 0)) - ABS(COALESCE(er.cash_commission, 0))
             )::numeric,
             2
           )
         )
       FROM earnings_imports ei
       WHERE er.import_id = ei.id
         AND ei.organization_id = $1
         AND ($2::boolean = false OR COALESCE(er.cash_commission, 0) < 0)
       RETURNING er.id`,
      [orgId, onlyCash],
    );
    return res.json({ updatedRows: result.rowCount ?? 0 });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Bulk recalculate payouts error", err);
    return res.status(500).json({ message: "Failed to bulk recalculate payouts" });
  }
});

export const earningsImportRoutes = router;
