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

router.post("/records/recalculate-bulk", async (req, res) => {
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
      cash_commission: string | null;
      total_transfer_earnings: string | null;
      account_opening_fee: string | null;
      transfer_commission: string | null;
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
         er.cash_commission::text,
         er.total_transfer_earnings::text AS total_transfer_earnings,
         er.account_opening_fee::text AS account_opening_fee,
         er.transfer_commission::text AS transfer_commission,
         er.vehicle_rental_fee::text,
         er.vehicle_rental_id::text,
         GREATEST(
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
         )::text AS expected_payout,
         (
           COALESCE(er.driver_payout, 0)::numeric(12, 2) =
           GREATEST(
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
           )::numeric(12, 2)
         ) AS ok
       FROM earnings_records er
       JOIN earnings_imports ei ON ei.id = er.import_id
       WHERE ei.organization_id = $1
         AND COALESCE(er.cash_commission, 0) <> 0
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

const PAY_STATUSES = new Set(["pending", "approved", "paid", "hold"]);

router.get("/payouts", async (req, res) => {
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

    const countRes = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c
       FROM driver_payouts dp
       INNER JOIN drivers d ON d.id = dp.driver_id
       WHERE ${whereSql}`,
      params,
    );
    const total = parseInt(countRes.rows[0]?.c ?? "0", 10);

    params.push(pageSize, offset);
    const listRes = await pool.query(
      `SELECT dp.id::text, dp.driver_id::text, dp.payment_period_start::text, dp.payment_period_end::text,
              dp.net_driver_payout::text, dp.payment_status, dp.payment_date::text,
              dp.total_gross_earnings::text, dp.company_commission::text,
              dp.vehicle_rental_fee::text,
              d.first_name, d.last_name, d.phone
       FROM driver_payouts dp
       INNER JOIN drivers d ON d.id = dp.driver_id
       WHERE ${whereSql}
       ORDER BY dp.payment_period_end DESC, dp.created_at DESC
       LIMIT $${p} OFFSET $${p + 1}`,
      params,
    );

    return res.json({ items: listRes.rows, page, pageSize, total });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Earnings payouts list error", err);
    return res.status(500).json({ message: "Failed to list payouts" });
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
          vr.id::text AS vehicle_rental_id,
          vr.total_rent_amount::text AS rental_amount,
          vr.rental_start_date::text AS rental_start_date,
          vr.rental_end_date::text AS rental_end_date,
          vr.rental_type,
          CASE
            WHEN COALESCE(vr.total_rent_amount, 0) > 0 AND COALESCE(dp.vehicle_rental_fee, 0) > 0
              THEN ROUND((dp.vehicle_rental_fee / vr.total_rent_amount) * 100.0, 2)::text
            ELSE NULL
          END AS overlap_pct
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

  try {
    const result = await pool.query(
      `UPDATE driver_payouts dp
       SET payment_status = $2::varchar(50),
           payment_date = CASE WHEN $7 THEN COALESCE($3::date, CURRENT_DATE) ELSE payment_date END,
           payment_method = COALESCE($4, payment_method),
           transaction_ref = COALESCE($5, transaction_ref)
       WHERE dp.organization_id = $1 AND dp.id = ANY($6::uuid[])`,
      [orgId, paymentStatus, paymentDate, body.paymentMethod ?? null, body.transactionRef ?? null, ids, setPaidDate],
    );
    return res.json({ updatedRows: result.rowCount ?? 0 });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Earnings payouts bulk update error", err);
    return res.status(500).json({ message: "Bulk update failed" });
  }
});

type PayoutExportRow = {
  id: string;
  driver_id: string;
  payment_period_start: string;
  payment_period_end: string;
  net_driver_payout: string | null;
  vehicle_rental_fee: string | null;
  payment_status: string;
  payment_date: string | null;
  first_name: string;
  last_name: string;
  phone: string | null;
};

async function fetchPayoutExportRows(
  orgId: string,
  status: string | null,
  from: string | null,
  to: string | null,
  q: string | null,
  driverId: string | null,
): Promise<PayoutExportRow[]> {
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
  if (driverId) {
    where.push(`dp.driver_id = $${p++}::uuid`);
    params.push(driverId);
  }
  if (q) {
    const qq = `%${q.trim()}%`;
    where.push(
      `(d.first_name ILIKE $${p} OR d.last_name ILIKE $${p} OR d.phone ILIKE $${p} OR CONCAT(d.first_name, ' ', d.last_name) ILIKE $${p})`,
    );
    params.push(qq);
    p++;
  }
  const whereSql = where.join(" AND ");
  const { rows } = await pool.query<PayoutExportRow>(
    `SELECT dp.id::text, dp.driver_id::text, dp.payment_period_start::text, dp.payment_period_end::text,
            dp.net_driver_payout::text, dp.vehicle_rental_fee::text, dp.payment_status, dp.payment_date::text,
            d.first_name, d.last_name, d.phone
     FROM driver_payouts dp
     INNER JOIN drivers d ON d.id = dp.driver_id
     WHERE ${whereSql}
     ORDER BY dp.payment_period_end DESC, dp.created_at DESC
     LIMIT 10000`,
    params,
  );
  return rows;
}

router.get("/reports/export", async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) return res.status(400).json({ message: "User is not associated with an organization" });

  const statusRaw = req.query.status != null && String(req.query.status).trim() !== "" ? String(req.query.status) : null;
  const status = statusRaw && PAY_STATUSES.has(statusRaw) ? statusRaw : null;
  const from = typeof req.query.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : null;
  const to = typeof req.query.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : null;
  const q = typeof req.query.q === "string" && req.query.q.trim() !== "" ? req.query.q : null;
  const driverIdExport =
    typeof req.query.driverId === "string" && UUID_RE.test(req.query.driverId) ? req.query.driverId : null;

  try {
    const rows = await fetchPayoutExportRows(orgId, status, from, to, q, driverIdExport);
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const header = [
      "id",
      "driver_id",
      "first_name",
      "last_name",
      "phone",
      "period_start",
      "period_end",
      "net_payout",
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
          esc(r.first_name),
          esc(r.last_name),
          r.phone != null ? esc(r.phone) : "",
          r.payment_period_start,
          r.payment_period_end,
          r.net_driver_payout ?? "",
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
