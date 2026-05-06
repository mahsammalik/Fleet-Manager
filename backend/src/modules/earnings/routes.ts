import type { PoolClient } from "pg";
import { Router } from "express";
import { authenticateJWT, requireRole } from "../../middleware/auth";
import { pool, query } from "../../db/pool";
import { earningsUpload } from "../../config/multer";
import { buildColumnMap } from "./romanHeaderMap";
import { rowCellsToNormalized, type EarningsStagingPayload } from "./normalizeRow";
import {
  detectPlatformWithMeta,
  isEarningsPlatform,
  type EarningsPlatform,
} from "./detectPlatform";
import { extractDateFromFilename, weekBoundsFromDates } from "./filenameDate";
import { parseEarningsFile } from "./parseFile";
import { DriverMatchIndex, type DriverMatchRow } from "./matchDriver";
import { runEarningsCommitFromStaging } from "./earningsCommit";
import {
  propagateDebtAfterManualEdit,
  recomputeDriverDebtAllocation,
  roundMoney,
} from "./debtAllocation";
import { insertEarningsPreviewStaging } from "./earningsPreviewStage";
import { stagingPayloadToPreviewRow } from "./previewRowMapper";
import { parseCommissionBaseType, type CommissionBaseType } from "./calculatePayout";
import { readOrgGlovoCommissionBase, writeOrgGlovoCommissionBase } from "./orgImportSettings";

/** Platform net from row columns (matches netIncomeFromGrossAndTaxa in calculatePayout). Alias: er */
const ER_NET_INCOME_SQL = `(
  COALESCE(er.gross_earnings, 0) + COALESCE(er.tips, 0) - ABS(COALESCE(er.platform_fee, 0))
)`;

const ER_DRIVER_PAYOUT_SQL = `ROUND((${ER_NET_INCOME_SQL})::numeric - COALESCE(er.company_commission, 0) - ABS(COALESCE(er.daily_cash, 0)), 2)`;

async function selectPayoutDebtSnapshot(client: PoolClient, orgId: string, payoutId: string) {
  const r = await client.query<{
    raw_net_amount: string | null;
    debt_amount: string | null;
    debt_applied_amount: string | null;
    remaining_debt_amount: string | null;
    net_driver_payout: string | null;
    payment_status: string;
    updated_at: string | null;
  }>(
    `SELECT raw_net_amount::text, debt_amount::text, debt_applied_amount::text, remaining_debt_amount::text,
            net_driver_payout::text, payment_status, updated_at::text AS updated_at
     FROM driver_payouts
     WHERE id = $1::uuid AND organization_id = $2::uuid`,
    [payoutId, orgId],
  );
  return r.rows[0] ?? null;
}

const router = Router();

router.use(authenticateJWT);
router.use(requireRole("admin", "accountant"));

export type { EarningsStagingPayload } from "./normalizeRow";

router.get("/import/org-settings", async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }
  try {
    const glovoCommissionBaseType = await readOrgGlovoCommissionBase(orgId);
    return res.json({ glovoCommissionBaseType });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("org-settings get error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.patch("/import/org-settings", async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }
  if (req.user?.role !== "admin") {
    return res.status(403).json({ message: "Only admins can change import settings" });
  }
  const raw = (req.body as { glovoCommissionBaseType?: unknown })?.glovoCommissionBaseType;
  const glovoCommissionBaseType = parseCommissionBaseType(raw);
  try {
    await writeOrgGlovoCommissionBase(orgId, glovoCommissionBaseType);
    return res.json({ glovoCommissionBaseType });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("org-settings patch error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

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
  let negativeTransfer = 0;
  let noDate = 0;
  const dupKeys = new Map<string, number>();
  for (const r of normalizedRows) {
    const g = r.amounts.gross;
    const n = r.amounts.net;
    const tt = r.amounts.transferTotal;
    if (g === null && n === null && tt === null) noMoney += 1;
    if (g !== null && g < 0) badMoney += 1;
    if (n !== null && n < 0) badMoney += 1;
    if (tt !== null && tt < 0) {
      badMoney += 1;
      negativeTransfer += 1;
    }
    if (!r.tripDateIso) noDate += 1;
    const k = `${r.hints.courierId ?? ""}|${r.hints.phone ?? ""}|${r.hints.plate ?? ""}|${r.tripDateIso ?? ""}|${g ?? ""}|${n ?? ""}|${tt ?? ""}`;
    dupKeys.set(k, (dupKeys.get(k) ?? 0) + 1);
  }
  if (noMoney > 0) w.push(`${noMoney} row(s) have no gross, net, or TVT amount.`);
  if (badMoney > 0) w.push(`${badMoney} row(s) have negative amounts.`);
  if (negativeTransfer > 0) {
    w.push(
      `${negativeTransfer} row(s) have negative transfer totals and will be treated as driver debt during payout commit.`,
    );
  }
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

router.post("/import/preview", earningsUpload.single("file"), async (req, res) => {
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
    let effectiveGlovoBase: CommissionBaseType = "net_income";
    if (platform === "glovo") {
      const defaultGlovoBase = await readOrgGlovoCommissionBase(orgId);
      const bodyRaw = (req.body as { glovoCommissionBaseType?: unknown })?.glovoCommissionBaseType;
      effectiveGlovoBase =
        bodyRaw !== undefined && bodyRaw !== null && String(bodyRaw).trim() !== ""
          ? parseCommissionBaseType(bodyRaw)
          : defaultGlovoBase;
    }

    let validForCommit = 0;
    let invalidRows = 0;
    let warningRows = 0;
    let debtCandidateRows = 0;
    for (const r of normalizedRows) {
      const { driverId } = index.match(platform, r.hints);
      const hasDate = !!r.tripDateIso;
      const hasMoney =
        r.amounts.gross != null || r.amounts.net != null || r.amounts.transferTotal != null;
      if (driverId && hasDate && hasMoney) validForCommit += 1;
      else invalidRows += 1;
      if (r.amounts.accountOpeningFee != null && r.amounts.accountOpeningFee > 0) warningRows += 1;
      if ((r.amounts.transferTotal ?? 0) < 0) {
        debtCandidateRows += 1;
      }
    }

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
        glovoCommissionBaseType: platform === "glovo" ? effectiveGlovoBase : undefined,
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
      glovoCommissionBaseType: platform === "glovo" ? effectiveGlovoBase : undefined,
      warnings,
      previewRows: [],
      aggregates: {
        valid: validForCommit,
        invalid: invalidRows,
        warnings: warningRows,
        debtRows: debtCandidateRows,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Import failed";
    // eslint-disable-next-line no-console
    console.error("Earnings preview error", err);
    return res.status(400).json({ message: msg });
  }
});

router.get("/import/:id/preview-rows", async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }
  const { id: importId } = req.params;
  const offset = Math.max(0, parseInt(String(req.query.offset ?? "0"), 10) || 0);
  const limitIn = parseInt(String(req.query.limit ?? "500"), 10) || 500;
  const limit = Math.min(2000, Math.max(1, limitIn));

  try {
    const { rows: impRows } = await query<{ platform: string }>(
      `SELECT platform FROM earnings_imports
       WHERE id = $1::uuid AND organization_id = $2::uuid AND status = 'preview'`,
      [importId, orgId],
    );
    if (!impRows[0]) {
      return res.status(404).json({ message: "Preview import not found or not in preview status" });
    }
    const platform = impRows[0].platform as EarningsPlatform;
    if (!isEarningsPlatform(platform)) {
      return res.status(400).json({ message: "Invalid platform on import" });
    }

    const { rows: countRows } = await query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM earnings_import_staging WHERE import_id = $1::uuid`,
      [importId],
    );
    const total = parseInt(countRows[0]?.c ?? "0", 10);

    const { rows: staging } = await query<{ row_index: number; payload: EarningsStagingPayload }>(
      `SELECT row_index, payload FROM earnings_import_staging
       WHERE import_id = $1::uuid
       ORDER BY row_index ASC
       OFFSET $2 LIMIT $3`,
      [importId, offset, limit],
    );

    const index = await loadMatchIndex(orgId);
    const previewRows = staging.map((r) =>
      stagingPayloadToPreviewRow(r.row_index, r.payload, platform, index),
    );

    return res.json({ offset, limit, total, rows: previewRows });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Earnings preview-rows error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/import/commit", async (req, res) => {
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
      autoMatchedVehicleRentals: commitResult.autoMatchedVehicleRentals,
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

router.delete("/import/:id", async (req, res) => {
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

router.post("/sync-vehicles", async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) return res.status(400).json({ message: "User is not associated with an organization" });

  const body = req.body as { importId?: unknown; driverId?: unknown };
  const importId =
    typeof body.importId === "string" && UUID_RE.test(body.importId) ? body.importId : null;
  const driverId =
    typeof body.driverId === "string" && UUID_RE.test(body.driverId) ? body.driverId : null;

  try {
    const touchResult = await pool.query(
      `UPDATE earnings_records er
       SET trip_date = er.trip_date
       FROM earnings_imports ei
       WHERE er.import_id = ei.id AND ei.organization_id = $1::uuid
         AND ($2::uuid IS NULL OR er.import_id = $2::uuid)
         AND ($3::uuid IS NULL OR er.driver_id = $3::uuid)`,
      [orgId, importId, driverId],
    );
    const refreshRes = await pool.query<{ n: string }>(
      `SELECT refresh_driver_payout_vehicle_fees($1::uuid)::text AS n`,
      [orgId],
    );
    const updatedPayouts = parseInt(refreshRes.rows[0]?.n ?? "0", 10);
    return res.json({
      retouchedRecords: touchResult.rowCount ?? 0,
      updatedPayouts,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Earnings sync-vehicles error", err);
    return res.status(500).json({ message: "Sync failed" });
  }
});

router.put("/records/:id/recalculate", async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) return res.status(400).json({ message: "User is not associated with an organization" });
  const { id } = req.params;
  try {
    const result = await pool.query<{
      id: string;
      driver_payout: string | null;
      net_earnings: string | null;
      company_commission: string | null;
    }>(
      `UPDATE earnings_records er
       SET driver_payout = ${ER_DRIVER_PAYOUT_SQL},
           net_earnings = ${ER_DRIVER_PAYOUT_SQL}
       FROM earnings_imports ei
       WHERE er.import_id = ei.id
         AND ei.organization_id = $1
         AND er.id = $2::uuid
       RETURNING er.id, er.driver_payout::text, er.net_earnings::text, er.company_commission::text`,
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

router.post("/records/recalculate-bulk", async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) return res.status(400).json({ message: "User is not associated with an organization" });
  const onlyCash = (req.body as { onlyCashCommission?: boolean } | undefined)?.onlyCashCommission ?? true;
  try {
    const result = await pool.query<{ id: string }>(
      `UPDATE earnings_records er
       SET driver_payout = ${ER_DRIVER_PAYOUT_SQL},
           net_earnings = ${ER_DRIVER_PAYOUT_SQL}
       FROM earnings_imports ei
       WHERE er.import_id = ei.id
         AND ei.organization_id = $1
         AND ($2::boolean = false OR COALESCE(er.daily_cash, 0) <> 0)
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

router.get("/imports", async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) return res.status(400).json({ message: "User is not associated with an organization" });
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize ?? "20"), 10) || 20));
  const offset = (page - 1) * pageSize;
  try {
    const [{ rows: countRows }, { rows }] = await Promise.all([
      pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM earnings_imports WHERE organization_id = $1`,
        [orgId],
      ),
      pool.query(
        `SELECT id::text, file_name, import_date::text, week_start::text, week_end::text, platform, record_count,
                status, created_at::text
         FROM earnings_imports
         WHERE organization_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [orgId, pageSize, offset],
      ),
    ]);
    const total = parseInt(countRows[0]?.c ?? "0", 10);
    return res.json({ items: rows, page, pageSize, total });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Earnings imports list error", err);
    return res.status(500).json({ message: "Failed to list imports" });
  }
});

router.get("/overview", async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) return res.status(400).json({ message: "User is not associated with an organization" });
  try {
    const [pendingRes, earnings30Res, avgPaidRes, monthlyRes] = await Promise.all([
      query<{ t: string | null }>(
        `SELECT COALESCE(SUM(net_driver_payout), 0)::text AS t
         FROM driver_payouts WHERE organization_id = $1 AND payment_status = 'pending'`,
        [orgId],
      ),
      query<{ t: string | null }>(
        `SELECT COALESCE(SUM(COALESCE(er.gross_earnings, 0)), 0)::text AS t
         FROM earnings_records er
         INNER JOIN drivers d ON er.driver_id = d.id
         WHERE d.organization_id = $1 AND er.trip_date >= (CURRENT_DATE - INTERVAL '30 days')::date`,
        [orgId],
      ),
      query<{ t: string | null }>(
        `SELECT COALESCE(AVG(net_driver_payout), 0)::text AS t
         FROM driver_payouts
         WHERE organization_id = $1
           AND payment_status = 'paid'
           AND payment_period_end >= (CURRENT_DATE - INTERVAL '90 days')::date`,
        [orgId],
      ),
      query<{ m: Date | string; total: string | null; commission: string | null }>(
        `SELECT date_trunc('month', er.trip_date AT TIME ZONE 'UTC') AS m,
                SUM(COALESCE(er.gross_earnings, 0))::text AS total,
                SUM(COALESCE(er.company_commission, 0))::text AS commission
         FROM earnings_records er
         INNER JOIN drivers d ON er.driver_id = d.id
         WHERE d.organization_id = $1
         GROUP BY 1
         ORDER BY 1 ASC`,
        [orgId],
      ),
    ]);

    const monthly = monthlyRes.rows.map((r) => {
      const monthDate = r.m instanceof Date ? r.m : new Date(r.m);
      const label = monthDate.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
      return {
        month: label,
        totalEarnings: parseFloat(r.total ?? "0"),
        totalCommission: parseFloat(r.commission ?? "0"),
      };
    });

    return res.json({
      kpis: {
        pendingPaymentsTotal: parseFloat(pendingRes.rows[0]?.t ?? "0"),
        totalEarningsLast30Days: parseFloat(earnings30Res.rows[0]?.t ?? "0"),
        avgPayoutPaidLast90Days: parseFloat(avgPaidRes.rows[0]?.t ?? "0"),
      },
      monthly,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Earnings overview error", err);
    return res.status(500).json({ message: "Failed to load overview" });
  }
});

router.get("/records/payout-integrity", async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) return res.status(400).json({ message: "User is not associated with an organization" });
  try {
    const { rows } = await query<{
      id: string;
      driver_id: string;
      trip_date: string;
      platform: string;
      net_earnings: string | null;
      driver_payout: string | null;
      company_commission: string | null;
      commission_base: string | null;
      total_transfer_earnings: string | null;
      account_opening_fee: string | null;
      vehicle_rental_fee: string | null;
      vehicle_rental_id: string | null;
      expected_payout: string | null;
      ok: boolean;
    }>(
      `SELECT
         er.id::text,
         er.driver_id::text,
         er.trip_date::text,
         er.platform,
         er.net_earnings::text,
         er.driver_payout::text,
         er.company_commission::text,
         er.commission_base::text AS commission_base,
         er.total_transfer_earnings::text AS total_transfer_earnings,
         er.account_opening_fee::text AS account_opening_fee,
         er.vehicle_rental_fee::text,
         er.vehicle_rental_id::text,
         ${ER_DRIVER_PAYOUT_SQL}::text AS expected_payout,
         (COALESCE(er.driver_payout, 0)::numeric(12, 2) = ${ER_DRIVER_PAYOUT_SQL}::numeric(12, 2)) AS ok
       FROM earnings_records er
       JOIN earnings_imports ei ON ei.id = er.import_id
       WHERE ei.organization_id = $1
         AND (COALESCE(er.daily_cash, 0) <> 0 OR COALESCE(er.company_commission, 0) <> 0)
       ORDER BY er.trip_date DESC, er.created_at DESC
       LIMIT 100`,
      [orgId],
    );
    return res.json(rows);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Payout integrity error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

const PAY_STATUSES = new Set(["pending", "processing", "approved", "paid", "failed", "hold", "debt"]);

const REPORT_MAX_ROWS = 10000;

type PayoutReportFilters = {
  status: string | null;
  from: string | null;
  to: string | null;
  q: string | null;
  driverId: string | null;
  minVehicleRental: number | null;
};

type PayoutFilterQuery = Record<string, unknown>;

function parsePayoutReportFilters(queryParams: PayoutFilterQuery): PayoutReportFilters {
  const statusRaw =
    queryParams.status != null && String(queryParams.status).trim() !== ""
      ? String(queryParams.status)
      : null;
  const status = statusRaw && PAY_STATUSES.has(statusRaw) ? statusRaw : null;
  const from =
    typeof queryParams.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(queryParams.from)
      ? queryParams.from
      : null;
  const to =
    typeof queryParams.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(queryParams.to)
      ? queryParams.to
      : null;
  const q =
    typeof queryParams.q === "string" && queryParams.q.trim() !== "" ? queryParams.q.trim() : null;
  const driverId =
    typeof queryParams.driverId === "string" && UUID_RE.test(queryParams.driverId)
      ? queryParams.driverId
      : null;
  const minVehicleRentalRaw =
    queryParams.minVehicleRental != null && String(queryParams.minVehicleRental).trim() !== ""
      ? Number(queryParams.minVehicleRental)
      : Number.NaN;
  const minVehicleRental =
    Number.isFinite(minVehicleRentalRaw) && minVehicleRentalRaw >= 0 ? minVehicleRentalRaw : null;

  return { status, from, to, q, driverId, minVehicleRental };
}

function buildPayoutReportWhereClause(orgId: string, filters: PayoutReportFilters) {
  const where: string[] = ["dp.organization_id = $1"];
  const params: unknown[] = [orgId];
  let p = 2;

  if (filters.status) {
    where.push(`dp.payment_status = $${p++}`);
    params.push(filters.status);
  }
  if (filters.from) {
    where.push(`dp.payment_period_end >= $${p++}::date`);
    params.push(filters.from);
  }
  if (filters.to) {
    where.push(`dp.payment_period_start <= $${p++}::date`);
    params.push(filters.to);
  }
  if (filters.driverId) {
    where.push(`dp.driver_id = $${p++}::uuid`);
    params.push(filters.driverId);
  }
  if (filters.q) {
    where.push(
      `(d.first_name ILIKE $${p} OR d.last_name ILIKE $${p} OR d.phone ILIKE $${p} OR dp.platform_id ILIKE $${p} OR CONCAT(d.first_name, ' ', d.last_name) ILIKE $${p} OR COALESCE(dp.vehicle_rental_fee::text, '') ILIKE $${p})`,
    );
    params.push(`%${filters.q}%`);
    p++;
  }
  if (filters.minVehicleRental != null) {
    where.push(`COALESCE(dp.vehicle_rental_fee, 0) >= $${p++}::numeric`);
    params.push(filters.minVehicleRental);
  }

  return { whereSql: where.join(" AND "), params, nextParamIndex: p };
}

type EarningsReportRow = {
  id: string;
  driver_id: string;
  platform_id: string | null;
  payment_period_start: string;
  payment_period_end: string;
  period_start_label: string;
  period_end_label: string;
  net_driver_payout: string | null;
  raw_net_amount: string | null;
  debt_amount: string | null;
  debt_applied_amount: string | null;
  remaining_debt_amount: string | null;
  vehicle_rental_fee: string | null;
  payment_status: string;
  payment_date: string | null;
  total_gross_earnings: string | null;
  income: string | null;
  tips: string | null;
  total_platform_fees: string | null;
  total_daily_cash: string | null;
  account_opening_fee: string | null;
  gross_income: string | null;
  net_income: string | null;
  company_commission: string | null;
  commission_base: string | null;
  commission_rate: string | null;
  commission_base_type: string | null;
  first_name: string;
  last_name: string;
  phone: string | null;
  driver_name: string;
};

async function fetchEarningsReportRows(
  orgId: string,
  filters: PayoutReportFilters,
  limit: number,
): Promise<EarningsReportRow[]> {
  const { whereSql, params, nextParamIndex } = buildPayoutReportWhereClause(orgId, filters);
  const boundedLimit = Math.max(1, Math.min(REPORT_MAX_ROWS, limit));
  const listParams = [...params, boundedLimit];
  const { rows } = await pool.query<EarningsReportRow>(
    `SELECT dp.id::text, dp.driver_id::text, dp.platform_id,
            dp.payment_period_start::text, dp.payment_period_end::text,
            TO_CHAR(dp.payment_period_start, 'YYYY-MM-DD') AS period_start_label,
            TO_CHAR(dp.payment_period_end, 'YYYY-MM-DD') AS period_end_label,
            dp.net_driver_payout::text, dp.raw_net_amount::text, dp.debt_amount::text,
            dp.debt_applied_amount::text, dp.remaining_debt_amount::text,
            dp.vehicle_rental_fee::text, dp.payment_status, dp.payment_date::text,
            dp.total_gross_earnings::text, dp.income::text, dp.tips::text,
            dp.total_platform_fees::text, dp.total_daily_cash::text, dp.account_opening_fee::text,
            dp.gross_income::text, dp.net_income::text,
            dp.company_commission::text,
            dp.commission_base::text, dp.commission_rate::text, dp.commission_base_type,
            d.first_name, d.last_name, d.phone, CONCAT(d.first_name, ' ', d.last_name) AS driver_name
     FROM driver_payouts dp
     INNER JOIN drivers d ON d.id = dp.driver_id
     WHERE ${whereSql}
     ORDER BY dp.payment_period_end DESC, dp.created_at DESC
     LIMIT $${nextParamIndex}`,
    listParams,
  );
  return rows;
}

async function fetchEarningsReportSummary(orgId: string, filters: PayoutReportFilters) {
  const { whereSql, params } = buildPayoutReportWhereClause(orgId, filters);
  const { rows } = await pool.query<{
    row_count: string;
    total_net_payout: string | null;
    total_vehicle_rental: string | null;
    total_revenue: string | null;
    total_debt: string | null;
    total_commission_legs: string | null;
    total_company_commission: string | null;
  }>(
    `SELECT
       COUNT(*)::text AS row_count,
       COALESCE(SUM(dp.net_driver_payout), 0)::text AS total_net_payout,
       COALESCE(SUM(dp.vehicle_rental_fee), 0)::text AS total_vehicle_rental,
       COALESCE(SUM(dp.total_gross_earnings), 0)::text AS total_revenue,
       COALESCE(SUM(dp.remaining_debt_amount), 0)::text AS total_debt,
       COALESCE(SUM(dp.company_commission), 0)::text AS total_commission_legs,
       COALESCE(SUM(dp.company_commission), 0)::text AS total_company_commission
     FROM driver_payouts dp
     INNER JOIN drivers d ON d.id = dp.driver_id
     WHERE ${whereSql}`,
    params,
  );
  const summary = rows[0];
  return {
    rowCount: parseInt(summary?.row_count ?? "0", 10),
    totalNetPayout: parseFloat(summary?.total_net_payout ?? "0"),
    totalVehicleRental: parseFloat(summary?.total_vehicle_rental ?? "0"),
    totalRevenue: parseFloat(summary?.total_revenue ?? "0"),
    totalDebt: parseFloat(summary?.total_debt ?? "0"),
    totalCommissionLegs: parseFloat(summary?.total_commission_legs ?? "0"),
    totalCompanyCommission: parseFloat(summary?.total_company_commission ?? "0"),
  };
}

async function fetchPayoutList(orgId: string, filters: PayoutReportFilters, page: number, pageSize: number) {
  const offset = (page - 1) * pageSize;
  const { whereSql, params, nextParamIndex } = buildPayoutReportWhereClause(orgId, filters);

  const countRes = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c
     FROM driver_payouts dp
     INNER JOIN drivers d ON d.id = dp.driver_id
     WHERE ${whereSql}`,
    params,
  );
  const total = parseInt(countRes.rows[0]?.c ?? "0", 10);

  const listParams = [...params, pageSize, offset];
    const listRes = await pool.query(
    `SELECT dp.id::text, dp.driver_id::text, dp.platform_id,
            dp.payment_period_start::text, dp.payment_period_end::text,
            dp.net_driver_payout::text, dp.payment_status, dp.payment_date::text,
            dp.raw_net_amount::text, dp.debt_amount::text, dp.debt_applied_amount::text, dp.remaining_debt_amount::text,
            dp.total_gross_earnings::text, dp.income::text, dp.tips::text, dp.total_platform_fees::text,
            dp.total_daily_cash::text, dp.account_opening_fee::text, dp.company_commission::text,
            dp.gross_income::text, dp.net_income::text, dp.commission_base::text,
            dp.commission_rate::text, dp.commission_base_type,
            dp.vehicle_rental_fee::text,
            d.first_name, d.last_name, d.phone,
            CONCAT(d.first_name, ' ', d.last_name) AS driver_name,
            TO_CHAR(dp.payment_period_start, 'YYYY-MM-DD') AS period_start_label,
            TO_CHAR(dp.payment_period_end, 'YYYY-MM-DD') AS period_end_label,
            er_plat.platform AS earnings_platform
     FROM driver_payouts dp
     INNER JOIN drivers d ON d.id = dp.driver_id
     LEFT JOIN LATERAL (
       SELECT er.platform
       FROM earnings_records er
       INNER JOIN earnings_imports ei ON ei.id = er.import_id AND ei.organization_id = dp.organization_id
       WHERE er.driver_id = dp.driver_id
         AND er.trip_date >= dp.payment_period_start
         AND er.trip_date <= dp.payment_period_end
       ORDER BY er.trip_date DESC
       LIMIT 1
     ) er_plat ON true
     WHERE ${whereSql}
     ORDER BY dp.payment_period_end DESC, dp.created_at DESC
     LIMIT $${nextParamIndex} OFFSET $${nextParamIndex + 1}`,
    listParams,
  );

  return { items: listRes.rows, page, pageSize, total };
}

router.get("/payouts", async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) return res.status(400).json({ message: "User is not associated with an organization" });

  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(String(req.query.pageSize ?? "25"), 10) || 25));
  const filters = parsePayoutReportFilters(req.query as PayoutFilterQuery);

  try {
    return res.json(await fetchPayoutList(orgId, filters, page, pageSize));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Earnings payouts list error", err);
    return res.status(500).json({ message: "Failed to list payouts" });
  }
});

router.get("/payouts/search", async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) return res.status(400).json({ message: "User is not associated with an organization" });

  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(String(req.query.pageSize ?? "25"), 10) || 25));
  const filters = parsePayoutReportFilters(req.query as PayoutFilterQuery);

  try {
    return res.json(await fetchPayoutList(orgId, filters, page, pageSize));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Earnings payouts search error", err);
    return res.status(500).json({ message: "Failed to search payouts" });
  }
});

router.get("/reports", async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) return res.status(400).json({ message: "User is not associated with an organization" });

  const limitRaw = parseInt(String(req.query.limit ?? String(REPORT_MAX_ROWS)), 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(REPORT_MAX_ROWS, limitRaw)) : REPORT_MAX_ROWS;
  const filters = parsePayoutReportFilters(req.query as PayoutFilterQuery);

  try {
    const [items, summary] = await Promise.all([
      fetchEarningsReportRows(orgId, filters, limit),
      fetchEarningsReportSummary(orgId, filters),
    ]);
    return res.json({
      items,
      summary,
      truncated: summary.rowCount > items.length,
      limit,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Earnings reports preview error", err);
    return res.status(500).json({ message: "Failed to load reports" });
  }
});

/** Aggregated fleet commission by stored commission_base_type (filtered like /reports). */
router.get("/reports/commission-by-base-type", async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) return res.status(400).json({ message: "User is not associated with an organization" });
  const filters = parsePayoutReportFilters(req.query as PayoutFilterQuery);
  try {
    const { whereSql, params } = buildPayoutReportWhereClause(orgId, filters);
    const { rows } = await pool.query<{
      commission_base_type: string;
      payout_count: string;
      total_company_commission: string | null;
      total_commission_base: string | null;
      avg_commission_rate: string | null;
    }>(
      `SELECT COALESCE(NULLIF(TRIM(dp.commission_base_type), ''), 'net_income') AS commission_base_type,
              COUNT(*)::text AS payout_count,
              SUM(COALESCE(dp.company_commission, 0))::text AS total_company_commission,
              SUM(COALESCE(dp.commission_base, 0))::text AS total_commission_base,
              AVG(NULLIF(dp.commission_rate, 0))::text AS avg_commission_rate
         FROM driver_payouts dp
         INNER JOIN drivers d ON d.id = dp.driver_id
        WHERE ${whereSql}
        GROUP BY 1
        ORDER BY 1`,
      params,
    );
    return res.json({
      items: rows.map((r) => ({
        commission_base_type: r.commission_base_type,
        payoutCount: parseInt(r.payout_count ?? "0", 10),
        totalCompanyCommission: parseFloat(r.total_company_commission ?? "0"),
        totalCommissionBase: parseFloat(r.total_commission_base ?? "0"),
        avgCommissionRate: parseFloat(r.avg_commission_rate ?? "0"),
      })),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("commission-by-base-type error", err);
    return res.status(500).json({ message: "Failed to load commission summary" });
  }
});

router.get("/payouts/with-proration-details", async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) return res.status(400).json({ message: "User is not associated with an organization" });

  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(String(req.query.pageSize ?? "25"), 10) || 25));
  const offset = (page - 1) * pageSize;
  const statusRaw = req.query.status != null && String(req.query.status).trim() !== "" ? String(req.query.status) : null;
  const status = statusRaw && PAY_STATUSES.has(statusRaw) ? statusRaw : null;
  const from = typeof req.query.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : null;
  const to = typeof req.query.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : null;
  const qSearch =
    typeof req.query.q === "string" && req.query.q.trim() !== "" ? `%${req.query.q.trim()}%` : null;
  const driverIdFilter =
    typeof req.query.driverId === "string" && UUID_RE.test(req.query.driverId)
      ? req.query.driverId
      : null;

  try {
    const where: string[] = ["dp.organization_id = $1"];
    const params: unknown[] = [orgId];
    let p = 2;
    if (status) {
      where.push(`dp.payment_status = $${p++}`);
      params.push(status);
    }
    if (from) {
      where.push(`dp.payment_period_end >= $${p++}::date`);
      params.push(from);
    }
    if (to) {
      where.push(`dp.payment_period_start <= $${p++}::date`);
      params.push(to);
    }
    if (driverIdFilter) {
      where.push(`dp.driver_id = $${p++}::uuid`);
      params.push(driverIdFilter);
    }
    if (qSearch) {
      where.push(
        `(d.first_name ILIKE $${p} OR d.last_name ILIKE $${p} OR d.phone ILIKE $${p} OR CONCAT(d.first_name, ' ', d.last_name) ILIKE $${p})`,
      );
      params.push(qSearch);
      p++;
    }
    const whereSql = where.join(" AND ");
    params.push(pageSize, offset);

    const { rows } = await pool.query(
      `SELECT
          dp.id::text AS payout_id,
          dp.vehicle_rental_fee::text AS vehicle_rental_fee,
          dp.remaining_debt_amount::text AS remaining_debt_amount,
          vr.id::text AS vehicle_rental_id,
          vr.total_rent_amount::text AS rental_amount,
          vr.rental_start_date::text AS rental_start_date,
          vr.rental_end_date::text AS rental_end_date,
          vr.rental_type,
          NULL::text AS overlap_pct
        FROM driver_payouts dp
        INNER JOIN drivers d ON d.id = dp.driver_id
        LEFT JOIN LATERAL (
          SELECT v.*
          FROM vehicle_rentals v
          WHERE v.organization_id = dp.organization_id
            AND v.driver_id = dp.driver_id
            AND v.rental_start_date <= dp.payment_period_end
            AND v.rental_end_date >= dp.payment_period_start
          ORDER BY v.rental_start_date DESC, v.id
          LIMIT 1
        ) vr ON true
        WHERE ${whereSql}
        ORDER BY dp.payment_period_end DESC, dp.created_at DESC
        LIMIT $${p} OFFSET $${p + 1}`,
      params,
    );

    return res.json({ items: rows, page, pageSize });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Earnings payouts proration details error", err);
    return res.status(500).json({ message: "Failed to load proration details" });
  }
});

router.patch("/payouts/bulk", async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) return res.status(400).json({ message: "User is not associated with an organization" });

  const body = req.body as {
    ids?: unknown;
    paymentStatus?: string;
    paymentDate?: string;
    paymentMethod?: string;
    transactionRef?: string;
  };
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string") : [];
  if (!ids.length) return res.status(400).json({ message: "ids is required" });

  const paymentStatus = body.paymentStatus ?? "paid";
  if (!PAY_STATUSES.has(paymentStatus)) {
    return res.status(400).json({ message: "Invalid paymentStatus" });
  }

  let paymentDate: string | null = null;
  if (body.paymentDate !== undefined && body.paymentDate !== null && String(body.paymentDate).trim() !== "") {
    const d = String(body.paymentDate).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return res.status(400).json({ message: "paymentDate must be YYYY-MM-DD" });
    paymentDate = d;
  } else if (paymentStatus === "paid") {
    paymentDate = new Date().toISOString().slice(0, 10);
  }

  const setPaidDate = paymentStatus === "paid";
  const blockPayableTransition = paymentStatus === "paid" || paymentStatus === "approved";

  try {
    const result = await pool.query(
      `UPDATE driver_payouts dp
       SET payment_status = $2::varchar(50),
           payment_date = CASE WHEN $7 THEN COALESCE($3::date, CURRENT_DATE) ELSE payment_date END,
           payment_method = COALESCE($4, payment_method),
           transaction_ref = COALESCE($5, transaction_ref)
       WHERE dp.organization_id = $1
         AND dp.id = ANY($6::uuid[])
         AND (
           NOT $8::boolean
           OR (
             dp.payment_status IS DISTINCT FROM 'debt'
             AND COALESCE(dp.remaining_debt_amount, 0) = 0
           )
         )`,
      [
        orgId,
        paymentStatus,
        paymentDate,
        body.paymentMethod ?? null,
        body.transactionRef ?? null,
        ids,
        setPaidDate,
        blockPayableTransition,
      ],
    );
    return res.json({ updatedRows: result.rowCount ?? 0 });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Earnings payouts bulk update error", err);
    return res.status(500).json({ message: "Bulk update failed" });
  }
});

const DEBT_ADJUST_TYPES = new Set(["adjust", "forgive", "cash_received", "carry_forward"]);

/** Manual debt: `forgive` / `cash_received` reduce remaining (positive amount). `adjust`: positive amount subtracts from remaining (reduces collectible); negative amount adds (correction / increase owed). Stored `payout_adjustments.amount` remains signed delta (new − previous). */
router.post("/payouts/:id/adjust-debt", async (req, res) => {
  const orgId = req.user?.orgId;
  const userId = req.user?.sub;
  if (!orgId || !userId) return res.status(400).json({ message: "User is not associated with an organization" });

  const payoutId = String(req.params.id ?? "");
  if (!UUID_RE.test(payoutId)) return res.status(400).json({ message: "Invalid payout id" });

  const body = req.body as { type?: unknown; amount?: unknown; note?: unknown };
  const type = typeof body.type === "string" ? body.type.trim() : "";
  if (!DEBT_ADJUST_TYPES.has(type)) {
    return res.status(400).json({ message: "type must be adjust, forgive, cash_received, or carry_forward" });
  }
  const note = typeof body.note === "string" ? body.note.slice(0, 2000) : null;
  const amountRaw = body.amount;
  const amountNum =
    amountRaw !== undefined && amountRaw !== null && String(amountRaw).trim() !== ""
      ? Number(amountRaw)
      : null;
  if (amountNum !== null && !Number.isFinite(amountNum)) {
    return res.status(400).json({ message: "amount must be a number" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const pr = await client.query<{
      id: string;
      driver_id: string;
      raw_net_amount: string | null;
      remaining_debt_amount: string | null;
      payment_period_end: string;
      payment_status: string;
    }>(
      `SELECT id::text, driver_id::text, raw_net_amount::text, remaining_debt_amount::text,
              payment_period_end::text, payment_status
       FROM driver_payouts
       WHERE id = $1::uuid AND organization_id = $2::uuid
       FOR UPDATE`,
      [payoutId, orgId],
    );
    const row = pr.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Payout not found" });
    }

    const oldRem = roundMoney(Number(row.remaining_debt_amount ?? "0"));
    const rawNet = roundMoney(Number(row.raw_net_amount ?? "0"));

    if (type === "carry_forward") {
      await client.query(
        `INSERT INTO payout_adjustments (organization_id, payout_id, amount, reason, adjustment_type, created_by,
         previous_remaining_debt, new_remaining_debt, applied_amount)
         VALUES ($1::uuid, $2::uuid, 0, $3, 'carry_forward', $4::uuid, NULL, NULL, NULL)`,
        [orgId, payoutId, note, userId],
      );
      await recomputeDriverDebtAllocation(client, orgId, row.driver_id);
      const carrySnapshot = await selectPayoutDebtSnapshot(client, orgId, payoutId);
      await client.query("COMMIT");
      return res.json({
        ok: true,
        driverId: row.driver_id,
        type: "carry_forward",
        payoutId,
        payout: carrySnapshot,
      });
    }

    let newRem = oldRem;

    if (type === "forgive") {
      let take: number;
      if (amountNum != null && String(amountRaw).trim() !== "") {
        if (amountNum < 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            message: "Forgive amount must be positive (or omit amount to forgive all remaining debt).",
          });
        }
        const absAmt = roundMoney(Math.abs(roundMoney(amountNum)));
        if (!Number.isFinite(absAmt) || absAmt <= 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            message: "Partial forgive: enter a positive amount, or omit amount to forgive all remaining debt.",
          });
        }
        if (absAmt > oldRem) {
          await client.query("ROLLBACK");
          return res.status(400).json({ message: "Forgive amount cannot exceed current remaining debt" });
        }
        take = roundMoney(Math.min(oldRem, absAmt));
      } else {
        take = oldRem;
      }
      newRem = roundMoney(Math.max(0, oldRem - take));
    } else if (type === "cash_received") {
      if (amountNum == null || String(amountRaw).trim() === "") {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "amount is required for cash_received" });
      }
      if (amountNum < 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "Cash received amount must be a positive number" });
      }
      const payAmt = roundMoney(Math.abs(roundMoney(amountNum)));
      if (!Number.isFinite(payAmt) || payAmt <= 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "amount must be a positive number for cash_received" });
      }
      if (payAmt > oldRem) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "Cash received cannot exceed current remaining debt" });
      }
      newRem = roundMoney(Math.max(0, oldRem - payAmt));
    } else if (type === "adjust") {
      if (amountNum == null || !Number.isFinite(amountNum)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "amount is required for adjust" });
      }
      // Positive = reduce remaining collectible; negative = increase (correction).
      newRem = roundMoney(Math.max(0, oldRem - roundMoney(amountNum)));
    }

    if (type === "forgive" || type === "cash_received") {
      if (newRem > oldRem) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "Invalid debt adjustment: remaining would increase" });
      }
    }

    const delta = roundMoney(newRem - oldRem);
    const appliedAmount =
      type === "forgive" || type === "cash_received" ? roundMoney(Math.max(0, oldRem - newRem)) : null;
    const nextStatus =
      newRem > 0
        ? rawNet < 0
          ? "debt"
          : row.payment_status
        : rawNet < 0
          ? "hold"
          : row.payment_status === "paid" || row.payment_status === "approved" || row.payment_status === "hold"
            ? row.payment_status
            : "pending";

    await client.query(
      `INSERT INTO payout_adjustments (organization_id, payout_id, amount, reason, adjustment_type, created_by,
       previous_remaining_debt, new_remaining_debt, applied_amount)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5::varchar(32), $6::uuid, $7, $8, $9)`,
      [orgId, payoutId, delta, note, type, userId, oldRem, newRem, appliedAmount],
    );

    await client.query(
      `UPDATE driver_payouts
       SET remaining_debt_amount = $1,
           payment_status = $2,
           updated_at = NOW()
       WHERE id = $3::uuid AND organization_id = $4::uuid`,
      [newRem, nextStatus, payoutId, orgId],
    );

    await propagateDebtAfterManualEdit(client, orgId, row.driver_id, row.payment_period_end.slice(0, 10), row.id);

    const payoutSnapshot = await selectPayoutDebtSnapshot(client, orgId, payoutId);

    await client.query("COMMIT");
    return res.json({
      ok: true,
      payoutId,
      driverId: row.driver_id,
      type,
      previousRemaining: oldRem,
      remainingDebtAmount: newRem,
      paymentStatus: nextStatus,
      payout: payoutSnapshot,
    });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line no-console
    console.error("adjust-debt error", err);
    return res.status(500).json({ message: "adjust-debt failed" });
  } finally {
    client.release();
  }
});

router.get("/debts/summary", async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) return res.status(400).json({ message: "User is not associated with an organization" });

  try {
    const totalRes = await pool.query<{ s: string; c: string }>(
      `SELECT COALESCE(SUM(remaining_debt_amount), 0)::text AS s,
              COUNT(DISTINCT driver_id)::text AS c
       FROM driver_payouts
       WHERE organization_id = $1::uuid AND COALESCE(remaining_debt_amount, 0) > 0`,
      [orgId],
    );
    const topRes = await pool.query<{
      driver_id: string;
      first_name: string;
      last_name: string;
      outstanding: string;
      oldest_period_end: string;
    }>(
      `SELECT dp.driver_id::text,
              d.first_name,
              d.last_name,
              COALESCE(SUM(dp.remaining_debt_amount), 0)::text AS outstanding,
              MIN(dp.payment_period_end)::text AS oldest_period_end
       FROM driver_payouts dp
       INNER JOIN drivers d ON d.id = dp.driver_id
       WHERE dp.organization_id = $1::uuid AND COALESCE(dp.remaining_debt_amount, 0) > 0
       GROUP BY dp.driver_id, d.first_name, d.last_name
       ORDER BY COALESCE(SUM(dp.remaining_debt_amount), 0) DESC
       LIMIT 15`,
      [orgId],
    );

    return res.json({
      totalOutstanding: parseFloat(totalRes.rows[0]?.s ?? "0"),
      driversWithDebt: parseInt(totalRes.rows[0]?.c ?? "0", 10),
      topDebtors: topRes.rows.map((r) => ({
        driverId: r.driver_id,
        name: `${r.first_name} ${r.last_name}`.trim(),
        outstanding: parseFloat(r.outstanding),
        oldestPeriodEnd: r.oldest_period_end?.slice(0, 10) ?? null,
      })),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("debts summary error", err);
    return res.status(500).json({ message: "Failed to load debt summary" });
  }
});

router.post("/debts/bulk-carry-forward", async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) return res.status(400).json({ message: "User is not associated with an organization" });

  const body = req.body as { driverIds?: unknown; from?: unknown; to?: unknown };
  const from =
    typeof body.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.from) ? body.from : null;
  const to = typeof body.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.to) ? body.to : null;
  const driverIds = Array.isArray(body.driverIds)
    ? body.driverIds.filter((x): x is string => typeof x === "string" && UUID_RE.test(x))
    : null;

  try {
    const params: unknown[] = [orgId];
    let p = 2;
    const where: string[] = ["dp.organization_id = $1::uuid"];
    if (from) {
      where.push(`dp.payment_period_end >= $${p++}::date`);
      params.push(from);
    }
    if (to) {
      where.push(`dp.payment_period_start <= $${p++}::date`);
      params.push(to);
    }
    if (driverIds?.length) {
      where.push(`dp.driver_id = ANY($${p++}::uuid[])`);
      params.push(driverIds);
    }
    const drvRes = await pool.query<{ driver_id: string }>(
      `SELECT DISTINCT dp.driver_id::text AS driver_id
       FROM driver_payouts dp
       WHERE ${where.join(" AND ")}`,
      params,
    );
    const drivers = drvRes.rows.map((r) => r.driver_id);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const driverId of drivers) {
        await recomputeDriverDebtAllocation(client, orgId, driverId);
      }
      await client.query("COMMIT");
      return res.json({ ok: true, driversProcessed: drivers.length });
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
    // eslint-disable-next-line no-console
    console.error("bulk-carry-forward error", err);
    return res.status(500).json({ message: "bulk-carry-forward failed" });
  }
});

router.get("/debts/aging", async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) return res.status(400).json({ message: "User is not associated with an organization" });

  try {
    const { rows } = await pool.query<{ bucket: string; total: string; row_count: string }>(
      `SELECT
         CASE
           WHEN (CURRENT_DATE - payment_period_end) <= 30 THEN '0_30'
           WHEN (CURRENT_DATE - payment_period_end) <= 60 THEN '31_60'
           WHEN (CURRENT_DATE - payment_period_end) <= 90 THEN '61_90'
           ELSE '91_plus'
         END AS bucket,
         COALESCE(SUM(remaining_debt_amount), 0)::text AS total,
         COUNT(*)::text AS row_count
       FROM driver_payouts
       WHERE organization_id = $1::uuid AND COALESCE(remaining_debt_amount, 0) > 0
       GROUP BY 1
       ORDER BY 1`,
      [orgId],
    );
    const map = Object.fromEntries(rows.map((r) => [r.bucket, { total: parseFloat(r.total), rowCount: parseInt(r.row_count, 10) }]));
    return res.json({
      buckets: {
        "0_30": map["0_30"] ?? { total: 0, rowCount: 0 },
        "31_60": map["31_60"] ?? { total: 0, rowCount: 0 },
        "61_90": map["61_90"] ?? { total: 0, rowCount: 0 },
        "91_plus": map["91_plus"] ?? { total: 0, rowCount: 0 },
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("debts aging error", err);
    return res.status(500).json({ message: "Failed to load debt aging" });
  }
});

router.get("/debts/collection-summary", async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) return res.status(400).json({ message: "User is not associated with an organization" });

  const from =
    typeof req.query.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : null;
  const to = typeof req.query.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : null;
  if (!from || !to) {
    return res.status(400).json({ message: "from and to query params are required (YYYY-MM-DD)" });
  }

  try {
    const appliedRes = await pool.query<{ period_end: string; collected: string }>(
      `SELECT payment_period_end::text AS period_end,
              COALESCE(SUM(debt_applied_amount), 0)::text AS collected
       FROM driver_payouts
       WHERE organization_id = $1::uuid
         AND payment_period_end >= $2::date AND payment_period_start <= $3::date
         AND COALESCE(debt_applied_amount, 0) > 0
       GROUP BY payment_period_end
       ORDER BY payment_period_end`,
      [orgId, from, to],
    );

    const adjRes = await pool.query<{ adjustment_type: string; total: string }>(
      `SELECT adjustment_type, COALESCE(SUM(ABS(amount)), 0)::text AS total
       FROM payout_adjustments
       WHERE organization_id = $1::uuid
         AND created_at >= $2::timestamptz AND created_at < ($3::date + INTERVAL '1 day')::timestamptz
       GROUP BY adjustment_type`,
      [orgId, `${from}T00:00:00Z`, to],
    );

    return res.json({
      from,
      to,
      appliedFromPayouts: appliedRes.rows.map((r) => ({
        periodEnd: r.period_end.slice(0, 10),
        collected: parseFloat(r.collected),
      })),
      adjustmentsByType: Object.fromEntries(adjRes.rows.map((r) => [r.adjustment_type, parseFloat(r.total)])),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("collection summary error", err);
    return res.status(500).json({ message: "Failed to load collection summary" });
  }
});

router.get("/debts/history/:driverId", async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) return res.status(400).json({ message: "User is not associated with an organization" });

  const driverId = String(req.params.driverId ?? "");
  if (!UUID_RE.test(driverId)) return res.status(400).json({ message: "Invalid driver id" });

  try {
    const adj = await pool.query<{
      id: string;
      payout_id: string;
      amount: string;
      reason: string | null;
      adjustment_type: string;
      created_at: string;
      period_start: string | null;
      period_end: string | null;
      previous_remaining_debt: string | null;
      new_remaining_debt: string | null;
      applied_amount: string | null;
    }>(
      `SELECT pa.id::text, pa.payout_id::text, pa.amount::text, pa.reason, pa.adjustment_type, pa.created_at::text,
              dp.payment_period_start::text AS period_start, dp.payment_period_end::text AS period_end,
              pa.previous_remaining_debt::text AS previous_remaining_debt,
              pa.new_remaining_debt::text AS new_remaining_debt,
              pa.applied_amount::text AS applied_amount
       FROM payout_adjustments pa
       INNER JOIN driver_payouts dp ON dp.id = pa.payout_id AND dp.organization_id = pa.organization_id
       WHERE pa.organization_id = $1::uuid AND dp.driver_id = $2::uuid
       ORDER BY pa.created_at DESC
       LIMIT 500`,
      [orgId, driverId],
    );

    const snaps = await pool.query<{
      id: string;
      payment_period_start: string;
      payment_period_end: string;
      raw_net_amount: string | null;
      debt_amount: string | null;
      remaining_debt_amount: string | null;
      debt_applied_amount: string | null;
      net_driver_payout: string | null;
      payment_status: string;
    }>(
      `SELECT id::text, payment_period_start::text, payment_period_end::text,
              raw_net_amount::text, debt_amount::text, remaining_debt_amount::text,
              debt_applied_amount::text, net_driver_payout::text, payment_status
       FROM driver_payouts
       WHERE organization_id = $1::uuid AND driver_id = $2::uuid
       ORDER BY payment_period_end DESC, id DESC`,
      [orgId, driverId],
    );

    return res.json({
      adjustments: adj.rows,
      payouts: snaps.rows,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("debt history error", err);
    return res.status(500).json({ message: "Failed to load debt history" });
  }
});

router.get("/reports/export", async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) return res.status(400).json({ message: "User is not associated with an organization" });

  const formatRaw =
    req.query.format != null && String(req.query.format).trim() !== "" ? String(req.query.format) : "csv";
  const format = formatRaw.toLowerCase();
  const filters = parsePayoutReportFilters(req.query as PayoutFilterQuery);

  try {
    const rows = await fetchEarningsReportRows(orgId, filters, REPORT_MAX_ROWS);
    const summary = await fetchEarningsReportSummary(orgId, filters);

    if (format === "pdf") {
      return res.json({
        items: rows,
        summary,
        truncated: summary.rowCount > rows.length,
        limit: REPORT_MAX_ROWS,
      });
    }
    if (format !== "csv") {
      return res.status(400).json({ message: "format must be csv or pdf" });
    }

    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const header = [
      "id",
      "driver_id",
      "driver_name",
      "platform_id",
      "first_name",
      "last_name",
      "phone",
      "period_start",
      "period_end",
      "income",
      "tips",
      "total_revenue",
      "commission_base",
      "commission_rate",
      "commission_base_type",
      "company_commission",
      "account_opening_fee",
      "raw_net_amount",
      "net_payout",
      "debt_amount",
      "debt_applied_amount",
      "remaining_debt_amount",
      "vehicle_rental_fee",
      "status",
      "paid_date",
    ];
    const lines = [
      header.join(","),
      ...rows.map((r) =>
        [
          r.id,
          r.driver_id,
          esc(r.driver_name),
          r.platform_id ?? "",
          esc(r.first_name),
          esc(r.last_name),
          r.phone != null ? esc(r.phone) : "",
          r.payment_period_start,
          r.payment_period_end,
          r.income ?? "",
          r.tips ?? "",
          r.total_gross_earnings ?? "",
          r.commission_base ?? "",
          r.commission_rate ?? "",
          r.commission_base_type ?? "",
          r.company_commission ?? "",
          r.account_opening_fee ?? "",
          r.raw_net_amount ?? "",
          r.net_driver_payout ?? "",
          r.debt_amount ?? "",
          r.debt_applied_amount ?? "",
          r.remaining_debt_amount ?? "",
          r.vehicle_rental_fee ?? "",
          r.payment_status,
          r.payment_date ?? "",
        ].join(","),
      ),
    ];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="earnings-payouts-report.csv"');
    return res.send(lines.join("\n"));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Earnings export error", err);
    return res.status(500).json({ message: "Export failed" });
  }
});

export const earningsRoutes = router;
