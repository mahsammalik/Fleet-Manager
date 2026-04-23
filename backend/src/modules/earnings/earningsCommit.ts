import type { PoolClient } from "pg";
import type { EarningsPlatform } from "./detectPlatform";
import type { DriverMatchRow } from "./matchDriver";
import { DriverMatchIndex } from "./matchDriver";
import { computeCommissionComponents } from "./commission";
import { query } from "../../db/pool";
import type { EarningsStagingPayload } from "./normalizeRow";
import { applyDebtCarryForward, roundMoney } from "./debtAllocation";

export type EarningsCommitTotals = {
  gross: number;
  fee: number;
  net: number;
  comm: number;
  payout: number;
  trips: number;
};

export type EarningsCommitResult = {
  insertedRows: number;
  skippedNoDriver: number;
  skippedNoDate: number;
  skippedNoMoney: number;
  totals: EarningsCommitTotals;
  autoMatchedVehicleRentals: number;
};

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

type InsertRow = {
  driver_id: string;
  platform_id: string | null;
  trip_date: string;
  trip_count: number | null;
  gross: number | null;
  fee: number | null;
  net: number | null;
  total_transfer_earnings: number | null;
  daily_cash: number | null;
  account_opening_fee: number | null;
  transfer_commission: number;
  cash_commission: number;
  company_commission: number;
  driver_payout: number;
  commission_type: string;
};

function payoutPlatformIdForDriver(drv: DriverMatchRow, platform: EarningsPlatform): string | null {
  switch (platform) {
    case "uber":
      return drv.uber_driver_id ?? null;
    case "bolt":
      return drv.bolt_driver_id ?? null;
    case "glovo":
      return drv.glovo_courier_id ?? null;
    case "bolt_courier":
      return drv.bolt_courier_id ?? null;
    case "wolt_courier":
      return drv.wolt_courier_id ?? null;
    default:
      return null;
  }
}

/** Build rows and write earnings_records, driver_payouts rollup, finalize import (same transaction as caller). */
export async function runEarningsCommitFromStaging(
  client: PoolClient,
  orgId: string,
  importId: string,
  platformEff: EarningsPlatform,
  weekStartEff: string,
  weekEndEff: string,
): Promise<EarningsCommitResult> {
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
    const transferTotalRaw = p.amounts.transferTotal ?? null;
    if (gross === null && net === null && transferTotalRaw === null) {
      skippedNoMoney += 1;
      continue;
    }

    const drv = driverById.get(driverId);
    if (!drv) {
      skippedNoDriver += 1;
      continue;
    }

    let g = gross;
    let n = net;
    let f = fee;
    if (g === null && n !== null && f !== null) g = n + f;
    if (n === null && g !== null && f !== null) n = g - f;
    if (f === null && g !== null && n !== null) f = g - n;
    const transferAmount = transferTotalRaw ?? n ?? g ?? 0;
    const cashAmount = p.amounts.dailyCash ?? 0;
    const comm = computeCommissionComponents(drv, transferAmount, cashAmount);

    // Transfer commission stays signed (negative TVT → negative transfer_commission).
    // Cash commission is stored signed (negative daily cash → negative cash_commission) but the driver
    // deduction follows Excel/Glovo: subtract |cash_commission| so the fleet % applies to cash volume.
    const rawNetPayout = roundMoney(
      transferAmount - comm.transfer_commission - Math.abs(comm.cash_commission),
    );

    const accountOpeningRaw = p.amounts.accountOpeningFee ?? null;

    toInsert.push({
      driver_id: driverId,
      platform_id: payoutPlatformIdForDriver(drv, platformEff),
      trip_date: tripDateIso,
      trip_count: p.amounts.tripCount,
      gross: g,
      fee: f,
      net: rawNetPayout,
      total_transfer_earnings: transferTotalRaw,
      daily_cash: p.amounts.dailyCash ?? null,
      account_opening_fee: accountOpeningRaw,
      transfer_commission: comm.transfer_commission,
      cash_commission: comm.cash_commission,
      company_commission: comm.company_commission,
      driver_payout: rawNetPayout,
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
        `($${p++}::uuid, $${p++}::uuid, $${p++}, $${p++}::date, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`,
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
        r.total_transfer_earnings,
        r.daily_cash,
        r.account_opening_fee,
        r.transfer_commission,
        r.cash_commission,
        r.company_commission,
        r.driver_payout,
        r.commission_type,
      );
    }
    await client.query(
      `INSERT INTO earnings_records (
          import_id, driver_id, platform, trip_date, trip_count,
          gross_earnings, platform_fee, net_earnings,
          total_transfer_earnings, daily_cash, account_opening_fee, transfer_commission, cash_commission,
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

  const feeByDriverRes = await client.query<{ driver_id: string; s: string }>(
    `SELECT driver_id::text,
            COALESCE(SUM(mx), 0)::text AS s
       FROM (
         SELECT driver_id,
                MAX(vehicle_rental_fee) AS mx
           FROM earnings_records
          WHERE import_id = $1::uuid
            AND vehicle_rental_id IS NOT NULL
            AND vehicle_rental_fee IS NOT NULL
          GROUP BY driver_id, vehicle_rental_id
       ) t
       GROUP BY driver_id`,
    [importId],
  );
  const vehicleFeeByDriver = new Map<string, number>();
  for (const row of feeByDriverRes.rows) {
    vehicleFeeByDriver.set(row.driver_id, parseFloat(row.s) || 0);
  }

  const byDriver = new Map<
    string,
    {
      gross: number;
      fee: number;
      net: number;
      comm: number;
      payout: number;
      dailyCash: number;
      vehicleRentalFee: number;
      platformId: string | null;
    }
  >();
  for (const r of toInsert) {
    const cur = byDriver.get(r.driver_id) ?? {
      gross: 0,
      fee: 0,
      net: 0,
      comm: 0,
      payout: 0,
      dailyCash: 0,
      vehicleRentalFee: 0,
      platformId: null,
    };
    cur.gross += r.gross ?? 0;
    cur.fee += r.fee ?? 0;
    cur.net += r.net ?? 0;
    cur.comm += r.company_commission;
    cur.payout += r.driver_payout;
    cur.dailyCash += r.daily_cash ?? 0;
    cur.platformId ??= r.platform_id ?? null;
    byDriver.set(r.driver_id, cur);
  }
  for (const [driverId, agg] of byDriver) {
    agg.vehicleRentalFee = vehicleFeeByDriver.get(driverId) ?? 0;
  }

  for (const [driverId, agg] of byDriver) {
    const upsertRes = await client.query<{ id: string }>(
      `INSERT INTO driver_payouts (
          organization_id, driver_id, platform_id, payment_period_start, payment_period_end,
          total_gross_earnings, total_platform_fees, total_net_earnings,
          total_daily_cash,
          company_commission, raw_net_amount, net_driver_payout, debt_amount, debt_applied_amount, remaining_debt_amount,
          vehicle_rental_fee, payment_status
        ) VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9, $10, $11, 0, 0, 0, 0, $12, 'pending')
        ON CONFLICT (organization_id, driver_id, payment_period_start, payment_period_end)
        DO UPDATE SET
          platform_id = COALESCE(driver_payouts.platform_id, EXCLUDED.platform_id),
          total_gross_earnings = COALESCE(driver_payouts.total_gross_earnings, 0) + EXCLUDED.total_gross_earnings,
          total_platform_fees = COALESCE(driver_payouts.total_platform_fees, 0) + EXCLUDED.total_platform_fees,
          total_net_earnings = COALESCE(driver_payouts.total_net_earnings, 0) + EXCLUDED.total_net_earnings,
          total_daily_cash = COALESCE(driver_payouts.total_daily_cash, 0) + EXCLUDED.total_daily_cash,
          company_commission = COALESCE(driver_payouts.company_commission, 0) + EXCLUDED.company_commission,
          raw_net_amount = COALESCE(driver_payouts.raw_net_amount, 0) + EXCLUDED.raw_net_amount,
          vehicle_rental_fee = COALESCE(driver_payouts.vehicle_rental_fee, 0) + EXCLUDED.vehicle_rental_fee
        RETURNING id::text`,
      [
        orgId,
        driverId,
        agg.platformId,
        weekStartEff,
        weekEndEff,
        agg.gross,
        agg.fee,
        agg.net,
        agg.dailyCash,
        agg.comm,
        agg.payout,
        agg.vehicleRentalFee,
      ],
    );
    const payoutId = upsertRes.rows[0]?.id;
    if (payoutId) {
      await applyDebtCarryForward(client, orgId, payoutId);
    }
  }

  const matchRes = await client.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM earnings_records WHERE import_id = $1::uuid AND vehicle_rental_id IS NOT NULL`,
    [importId],
  );
  const autoMatchedVehicleRentals = parseInt(matchRes.rows[0]?.c ?? "0", 10);

  await client.query(`DELETE FROM earnings_import_staging WHERE import_id = $1`, [importId]);

  return {
    insertedRows: toInsert.length,
    skippedNoDriver,
    skippedNoDate,
    skippedNoMoney,
    totals,
    autoMatchedVehicleRentals,
  };
}
