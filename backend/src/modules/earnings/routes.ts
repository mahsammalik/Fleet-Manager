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
import { computeCommissionComponents } from "./commission";

const router = Router();

router.use(authenticateJWT);
router.use(requireRole("admin", "accountant"));

export interface EarningsStagingPayload {
  tripDateIso: string | null;
  hints: import("./normalizeRow").RowHints;
  amounts: import("./normalizeRow").NormalizedAmounts;
  rawSample: Record<string, string>;
}

function collectWarnings(
  colMap: Map<number, import("./normalizeRow").CanonicalField>,
  normalizedRows: ReturnType<typeof rowCellsToNormalized>[],
  filenameDate: string | null,
): string[] {
  const w: string[] = [];
  const hasGross = [...colMap.values()].includes("gross");
  const hasNet = [...colMap.values()].includes("net");
  const hasDate = [...colMap.values()].includes("trip_date");
  if (!hasGross && !hasNet) {
    w.push("No gross or net earnings column detected; check Romanian/English headers.");
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
    if (g === null && n === null) noMoney += 1;
    if (g !== null && g < 0) badMoney += 1;
    if (n !== null && n < 0) badMoney += 1;
    if (!r.tripDateIso) noDate += 1;
    const k = `${r.hints.courierId ?? ""}|${r.hints.phone ?? ""}|${r.hints.plate ?? ""}|${r.tripDateIso ?? ""}|${g ?? ""}|${n ?? ""}`;
    dupKeys.set(k, (dupKeys.get(k) ?? 0) + 1);
  }
  if (noMoney > 0) w.push(`${noMoney} row(s) have no gross/net amount.`);
  if (badMoney > 0) w.push(`${badMoney} row(s) have negative amounts.`);
  if (noDate > 0) w.push(`${noDate} row(s) are missing trip dates.`);
  const dups = [...dupKeys.values()].filter((c) => c > 1).length;
  if (dups > 0) w.push("Possible duplicate rows detected (same identifiers, date, and amounts).");
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

    const normalizedRows = table.rows.map((cells, idx) =>
      rowCellsToNormalized(cells, colMap, filenameDate),
    );

    const warnings = collectWarnings(colMap, normalizedRows, filenameDate);
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
        platformFee: r.amounts.platformFee,
        dailyCash: r.amounts.dailyCash,
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
      const ins = await client.query<{ id: string }>(
        `INSERT INTO earnings_imports (
          organization_id, file_name, import_date, week_start, week_end, platform,
          status, imported_by, detection_meta
        ) VALUES ($1, $2, CURRENT_DATE, $3::date, $4::date, $5, 'preview', $6::uuid, $7::jsonb)
        RETURNING id`,
        [
          orgId,
          req.file.originalname,
          weekStart,
          weekEnd,
          platform,
          userId,
          JSON.stringify({
            detectedPlatform: platform,
            detectionConfidence,
            filenameDate,
            headerCount: table.headers.length,
            rowCount: table.rows.length,
          }),
        ],
      );
      const newId = ins.rows[0]?.id;
      if (!newId) throw new Error("Failed to create earnings import");
      importId = newId;

      const chunk = 250;
      for (let i = 0; i < normalizedRows.length; i += chunk) {
        const slice = normalizedRows.slice(i, i + chunk);
        const values: unknown[] = [];
        const ph: string[] = [];
        let p = 1;
        for (let j = 0; j < slice.length; j++) {
          const rowIndex = i + j;
          const r = slice[j];
          const payload: EarningsStagingPayload = {
            tripDateIso: r.tripDateIso,
            hints: r.hints,
            amounts: r.amounts,
            rawSample: r.rawSample,
          };
          ph.push(`($${p++}, $${p++}, $${p++}, $${p++}::jsonb)`);
          values.push(orgId, importId, rowIndex, JSON.stringify(payload));
        }
        await client.query(
          `INSERT INTO earnings_import_staging (organization_id, import_id, row_index, payload) VALUES ${ph.join(",")}`,
          values,
        );
      }
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

    const staging = await client.query<{ row_index: number; payload: EarningsStagingPayload }>(
      `SELECT row_index, payload FROM earnings_import_staging WHERE import_id = $1 ORDER BY row_index`,
      [importId],
    );

    const index = await loadMatchIndex(orgId);
    const driversRes = await client.query<DriverMatchRow & { id: string }>(
      `SELECT id, phone, uber_driver_id, bolt_driver_id, glovo_courier_id, bolt_courier_id, wolt_courier_id,
              commission_type, commission_rate::text, fixed_commission_amount::text, minimum_commission::text
       FROM drivers WHERE organization_id = $1`,
      [orgId],
    );
    const driverById = new Map(driversRes.rows.map((d) => [d.id, d]));

    type InsertRow = {
      driver_id: string;
      trip_date: string;
      trip_count: number | null;
      gross: number | null;
      fee: number | null;
      net: number | null;
      company_commission: number;
      driver_payout: number;
      commission_type: string;
    };

    const toInsert: InsertRow[] = [];
    let skippedNoDriver = 0;
    let skippedNoDate = 0;
    let skippedNoMoney = 0;

    for (const row of staging.rows) {
      const p = row.payload;
      const { driverId } = index.match(platformEff, p.hints);
      if (!driverId) {
        skippedNoDriver += 1;
        continue;
      }
      const tripDateIso = p.tripDateIso ?? weekEndEff;
      if (!tripDateIso) {
        skippedNoDate += 1;
        continue;
      }
      const gross = p.amounts.gross;
      const net = p.amounts.net;
      const fee = p.amounts.platformFee;
      const dailyCash = p.amounts.dailyCash ?? 0;
      if (gross === null && net === null) {
        skippedNoMoney += 1;
        continue;
      }

      const drv = driverById.get(driverId);
      if (!drv) {
        skippedNoDriver += 1;
        continue;
      }

      const transferAmount = net ?? gross ?? 0;
      const comm = computeCommissionComponents(drv, transferAmount, dailyCash);

      let g = gross;
      let n = net;
      let f = fee;
      if (g === null && n !== null && f !== null) g = n + f;
      if (n === null && g !== null && f !== null) n = g - f;
      if (f === null && g !== null && n !== null) f = g - n;

      toInsert.push({
        driver_id: driverId,
        trip_date: tripDateIso,
        trip_count: p.amounts.tripCount,
        gross: g,
        fee: f,
        net: n,
        company_commission: comm.company_commission,
        // Driver payout = transfer + signed cash - total commission.
        driver_payout: Math.max(
          0,
          Math.round((transferAmount + dailyCash - comm.company_commission) * 100) / 100,
        ),
        commission_type: comm.commission_type,
      });
    }

    const batch = 200;
    for (let i = 0; i < toInsert.length; i += batch) {
      const slice = toInsert.slice(i, i + batch);
      const values: unknown[] = [];
      const ph: string[] = [];
      let p = 1;
      for (const r of slice) {
        ph.push(
          `($${p++}::uuid, $${p++}::uuid, $${p++}, $${p++}::date, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`,
        );
        values.push(
          importId,
          r.driver_id,
          platformEff,
          r.trip_date,
          r.trip_count,
          r.gross,
          r.fee,
          r.net,
          r.company_commission,
          r.driver_payout,
          r.commission_type,
        );
      }
      await client.query(
        `INSERT INTO earnings_records (
          import_id, driver_id, platform, trip_date, trip_count,
          gross_earnings, platform_fee, net_earnings,
          company_commission, driver_payout, commission_type
        ) VALUES ${ph.join(",")}`,
        values,
      );
    }

    const totals = toInsert.reduce(
      (acc, r) => {
        acc.gross += r.gross ?? 0;
        acc.fee += r.fee ?? 0;
        acc.net += r.net ?? 0;
        acc.comm += r.company_commission;
        acc.payout += r.driver_payout;
        acc.trips += r.trip_count ?? 1;
        return acc;
      },
      { gross: 0, fee: 0, net: 0, comm: 0, payout: 0, trips: 0 },
    );

    await client.query(
      `UPDATE earnings_imports SET
        status = 'completed',
        record_count = $2,
        total_gross = $3,
        total_trips = $4
       WHERE id = $1`,
      [importId, toInsert.length, totals.gross, totals.trips],
    );

    const byDriver = new Map<
      string,
      { gross: number; fee: number; net: number; comm: number; payout: number }
    >();
    for (const r of toInsert) {
      const cur = byDriver.get(r.driver_id) ?? { gross: 0, fee: 0, net: 0, comm: 0, payout: 0 };
      cur.gross += r.gross ?? 0;
      cur.fee += r.fee ?? 0;
      cur.net += r.net ?? 0;
      cur.comm += r.company_commission;
      cur.payout += r.driver_payout;
      byDriver.set(r.driver_id, cur);
    }

    for (const [driverId, agg] of byDriver) {
      await client.query(
        `INSERT INTO driver_payments (
          organization_id, driver_id, payment_period_start, payment_period_end,
          total_gross_earnings, total_platform_fees, total_net_earnings,
          company_commission, net_driver_payout, payment_status
        ) VALUES ($1, $2, $3::date, $4::date, $5, $6, $7, $8, $9, 'pending')
        ON CONFLICT (organization_id, driver_id, payment_period_start, payment_period_end)
        DO UPDATE SET
          total_gross_earnings = COALESCE(driver_payments.total_gross_earnings, 0) + EXCLUDED.total_gross_earnings,
          total_platform_fees = COALESCE(driver_payments.total_platform_fees, 0) + EXCLUDED.total_platform_fees,
          total_net_earnings = COALESCE(driver_payments.total_net_earnings, 0) + EXCLUDED.total_net_earnings,
          company_commission = COALESCE(driver_payments.company_commission, 0) + EXCLUDED.company_commission,
          net_driver_payout = COALESCE(driver_payments.net_driver_payout, 0) + EXCLUDED.net_driver_payout`,
        [
          orgId,
          driverId,
          weekStartEff,
          weekEndEff,
          agg.gross,
          agg.fee,
          agg.net,
          agg.comm,
          agg.payout,
        ],
      );
    }

    await client.query(`DELETE FROM earnings_import_staging WHERE import_id = $1`, [importId]);

    await client.query("COMMIT");

    return res.json({
      importId,
      insertedRows: toInsert.length,
      skippedNoDriver,
      skippedNoDate,
      skippedNoMoney,
      totals,
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

export const earningsImportRoutes = router;
