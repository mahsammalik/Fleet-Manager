import { Router } from "express";
import { authenticateJWT, requireRole } from "../../middleware/auth";
import { pool } from "../../db/pool";
import {
  PAYOUT_DETAIL_PARENT_FROM,
  PAYOUT_TOTALS_BY_PAYOUT_ID_SELECT,
  SETTLEMENT_TOTALS_FROM,
  SETTLEMENT_TOTALS_SELECT,
} from "./settlementTotalsSql";
import { validateSettlementDetail } from "./settlementDetailValidation";
import { refreshVehicleRentForPeriod } from "../earnings/refreshVehicleRentForPeriod";

const router = Router();

router.use(authenticateJWT);
router.use(requireRole("admin", "accountant"));

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PAY_STATUSES = new Set(["pending", "paid", "partial", "overdue", "cancelled"]);

function parsePeriodDates(periodStart: unknown, periodEnd: unknown): { start: string; end: string } | null {
  const start = typeof periodStart === "string" ? periodStart.slice(0, 10) : "";
  const end = typeof periodEnd === "string" ? periodEnd.slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return null;
  return { start, end };
}

router.get("/", async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) return res.status(400).json({ message: "User is not associated with an organization" });

  const period = parsePeriodDates(req.query.periodStart, req.query.periodEnd);
  if (!period) {
    return res.status(400).json({ message: "periodStart and periodEnd are required (YYYY-MM-DD)" });
  }

  const statusRaw =
    req.query.status != null && String(req.query.status).trim() !== ""
      ? String(req.query.status)
      : null;
  const status = statusRaw && PAY_STATUSES.has(statusRaw) ? statusRaw : null;
  const subcontractorId =
    typeof req.query.subcontractorId === "string" && UUID_RE.test(req.query.subcontractorId)
      ? req.query.subcontractorId
      : null;

  const params: unknown[] = [orgId, period.start, period.end];
  const where = ["s.organization_id = $1::uuid", "st.subcontractor_id IS NOT NULL"];
  let p = 4;
  if (status) {
    where.push(`COALESCE(sp.payment_status, 'pending') = $${p++}`);
    params.push(status);
  }
  if (subcontractorId) {
    where.push(`s.id = $${p++}::uuid`);
    params.push(subcontractorId);
  }

  try {
    const { rows } = await pool.query(
      `SELECT ${SETTLEMENT_TOTALS_SELECT},
              sp.payment_period_start::text,
              sp.payment_period_end::text
       ${SETTLEMENT_TOTALS_FROM}
       WHERE ${where.join(" AND ")}
       ORDER BY s.legal_name ASC`,
      params,
    );
    return res.json({ periodStart: period.start, periodEnd: period.end, items: rows });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("List subcontractor payouts error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/refresh", async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) return res.status(400).json({ message: "User is not associated with an organization" });

  const body = req.body as { periodStart?: string; periodEnd?: string };
  const period = parsePeriodDates(body.periodStart, body.periodEnd);
  if (!period) {
    return res.status(400).json({ message: "periodStart and periodEnd are required (YYYY-MM-DD)" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rentRefresh = await refreshVehicleRentForPeriod(client, orgId, period.start, period.end);
    const payoutRes = await client.query<{ n: string }>(
      `SELECT refresh_subcontractor_payouts($1::uuid, $2::date, $3::date)::text AS n`,
      [orgId, period.start, period.end],
    );
    await client.query("COMMIT");
    return res.json({
      periodStart: period.start,
      periodEnd: period.end,
      driverPayoutsFeesUpdated: rentRefresh.feesUpdated,
      driverPayoutsSynced: rentRefresh.payoutsSynced,
      updatedPayoutSettlements: parseInt(payoutRes.rows[0]?.n ?? "0", 10),
    });
  } catch (err) {
    await client.query("ROLLBACK");
    // eslint-disable-next-line no-console
    console.error("Refresh subcontractor payouts error", err);
    return res.status(500).json({ message: "Internal server error" });
  } finally {
    client.release();
  }
});

router.patch("/bulk", async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) return res.status(400).json({ message: "User is not associated with an organization" });

  const body = req.body as {
    ids?: unknown;
    paymentStatus?: string;
    paymentDate?: string;
    paymentMethod?: string;
    paymentReference?: string;
    /** @deprecated use paymentReference */
    transactionRef?: string;
  };
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string" && UUID_RE.test(x)) : [];
  if (!ids.length) return res.status(400).json({ message: "ids is required" });

  const paymentStatus = body.paymentStatus ?? "paid";
  if (!PAY_STATUSES.has(paymentStatus)) {
    return res.status(400).json({ message: "Invalid paymentStatus" });
  }

  const paymentRef = body.paymentReference ?? body.transactionRef ?? null;

  let paymentDate: string | null = null;
  if (body.paymentDate !== undefined && body.paymentDate !== null && String(body.paymentDate).trim() !== "") {
    const d = String(body.paymentDate).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return res.status(400).json({ message: "paymentDate must be YYYY-MM-DD" });
    paymentDate = d;
  } else if (paymentStatus === "paid") {
    paymentDate = new Date().toISOString().slice(0, 10);
  }

  const setPaidDate = paymentStatus === "paid";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const updateRes = await client.query<{ id: string }>(
      `UPDATE subcontractor_payouts sp
       SET payment_status = $2::varchar(30),
           payment_date = CASE WHEN $7 THEN COALESCE($3::date, CURRENT_DATE) ELSE sp.payment_date END,
           payment_method = COALESCE($4, sp.payment_method),
           payment_reference = COALESCE($5, sp.payment_reference),
           paid_amount = CASE
             WHEN $2 = 'paid' THEN (
               SELECT st.total_payable
               FROM subcontractor_settlement_totals(
                 sp.organization_id,
                 sp.payment_period_start,
                 sp.payment_period_end
               ) st
               WHERE st.subcontractor_id = sp.subcontractor_id
               LIMIT 1
             )
             ELSE sp.paid_amount
           END,
           updated_at = NOW()
       WHERE sp.organization_id = $1
         AND sp.id = ANY($6::uuid[])
       RETURNING sp.id::text`,
      [
        orgId,
        paymentStatus,
        paymentDate,
        body.paymentMethod ?? null,
        paymentRef,
        ids,
        setPaidDate,
      ],
    );

    const updatedIds = updateRes.rows.map((r) => r.id);

    if (paymentStatus === "paid" && updatedIds.length > 0) {
      await client.query(
        `UPDATE subcontractor_rent_charges rc
         SET status = 'paid',
             updated_at = NOW()
         FROM subcontractor_payouts sp
         WHERE sp.id = ANY($1::uuid[])
           AND rc.organization_id = sp.organization_id
           AND rc.subcontractor_id = sp.subcontractor_id
           AND rc.period_start = sp.payment_period_start
           AND rc.period_end = sp.payment_period_end
           AND COALESCE(rc.amount, 0) > 0`,
        [updatedIds],
      );
    }

    await client.query("COMMIT");
    return res.json({ updated: updatedIds.length, ids: updatedIds });
  } catch (err) {
    await client.query("ROLLBACK");
    // eslint-disable-next-line no-console
    console.error("Bulk update subcontractor payouts error", err);
    return res.status(500).json({ message: "Internal server error" });
  } finally {
    client.release();
  }
});

function num(v: string | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

router.get("/:id/detail", async (req, res) => {
  const orgId = req.user?.orgId;
  const { id } = req.params;
  if (!orgId) return res.status(400).json({ message: "User is not associated with an organization" });
  if (!UUID_RE.test(id)) return res.status(400).json({ message: "Invalid id" });

  try {
    const { rows } = await pool.query<{
      id: string;
      subcontractor_id: string;
      legal_name: string;
      payment_period_start: string;
      payment_period_end: string;
      driver_payout_count: number | null;
      total_gross_income: string;
      total_tips: string;
      total_commission: string;
      total_vehicle_rent: string;
      total_account_opening_fee: string;
      total_platform_fees: string;
      total_daily_cash: string;
      total_payable: string;
      payment_status: string;
      paid_amount: string | null;
    }>(
      `SELECT sp.id::text,
              sp.subcontractor_id::text,
              s.legal_name,
              sp.payment_period_start::text,
              sp.payment_period_end::text,
              ${PAYOUT_TOTALS_BY_PAYOUT_ID_SELECT},
              sp.payment_status,
              sp.paid_amount::text AS paid_amount
       ${PAYOUT_DETAIL_PARENT_FROM}
       WHERE sp.id = $1::uuid AND sp.organization_id = $2::uuid
       LIMIT 1`,
      [id, orgId],
    );
    const parent = rows[0];
    if (!parent) return res.status(404).json({ message: "Subcontractor payout not found" });

    const { rows: driverRows } = await pool.query<{
      id: string;
      driver_id: string;
      name: string;
      gross: string;
      tips: string;
      commission: string;
      vehicle_rent: string;
      account_opening_fee: string;
      platform_fees: string;
      daily_cash: string;
      net: string;
    }>(
      `SELECT dp.id::text,
              dp.driver_id::text,
              TRIM(COALESCE(d.first_name, '') || ' ' || COALESCE(d.last_name, '')) AS name,
              COALESCE(dp.total_gross_earnings, 0)::text AS gross,
              COALESCE(dp.tips, 0)::text AS tips,
              COALESCE(dp.company_commission, 0)::text AS commission,
              COALESCE(dp.vehicle_rental_fee, 0)::text AS vehicle_rent,
              COALESCE(dp.account_opening_fee, 0)::text AS account_opening_fee,
              COALESCE(dp.total_platform_fees, 0)::text AS platform_fees,
              COALESCE(dp.total_daily_cash, 0)::text AS daily_cash,
              COALESCE(dp.net_driver_payout, 0)::text AS net
       FROM driver_payouts dp
       INNER JOIN drivers d ON d.id = dp.driver_id
       WHERE dp.subcontractor_payout_id = $1::uuid
       ORDER BY d.last_name, d.first_name`,
      [id],
    );

    const payable = num(parent.total_payable);

    const driversForValidation = driverRows.map((d) => ({
      gross: num(d.gross),
      tips: num(d.tips),
      commission: num(d.commission),
      vehicle_rent: num(d.vehicle_rent),
      account_opening_fee: num(d.account_opening_fee),
      platform_fees: num(d.platform_fees),
      daily_cash: num(d.daily_cash),
      net: num(d.net),
    }));

    const validation = validateSettlementDetail(driversForValidation, {
      gross_incl_tips: num(parent.total_gross_income),
      tips: num(parent.total_tips),
      commission: num(parent.total_commission),
      vehicle_rent: num(parent.total_vehicle_rent),
      account_opening_fee: num(parent.total_account_opening_fee),
      platform_fees: num(parent.total_platform_fees),
      daily_cash: num(parent.total_daily_cash),
      payable,
    });

    return res.json({
      settlement: {
        id: parent.id,
        subcontractor_id: parent.subcontractor_id,
        subcontractor_name: parent.legal_name,
        period_start: parent.payment_period_start,
        period_end: parent.payment_period_end,
        status: parent.payment_status,
        payable: payable.toFixed(2),
        paid_amount: parent.paid_amount,
      },
      totals: {
        drivers: parent.driver_payout_count ?? driverRows.length,
        gross_incl_tips: num(parent.total_gross_income).toFixed(2),
        tips: num(parent.total_tips).toFixed(2),
        commission: num(parent.total_commission).toFixed(2),
        vehicle_rent: num(parent.total_vehicle_rent).toFixed(2),
        account_opening_fee: num(parent.total_account_opening_fee).toFixed(2),
        platform_fees: num(parent.total_platform_fees).toFixed(2),
        daily_cash: num(parent.total_daily_cash).toFixed(2),
        payable: payable.toFixed(2),
      },
      drivers: driverRows,
      validation,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Get subcontractor settlement detail error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/:id", async (req, res) => {
  const orgId = req.user?.orgId;
  const { id } = req.params;
  if (!orgId) return res.status(400).json({ message: "User is not associated with an organization" });
  if (!UUID_RE.test(id)) return res.status(400).json({ message: "Invalid id" });

  try {
    const { rows } = await pool.query(
      `SELECT sp.id::text,
              sp.subcontractor_id::text,
              s.legal_name,
              sp.payment_period_start::text,
              sp.payment_period_end::text,
              ${PAYOUT_TOTALS_BY_PAYOUT_ID_SELECT},
              sp.payment_status,
              sp.payment_date::text,
              sp.payment_method,
              sp.payment_reference,
              sp.paid_amount::text AS paid_amount
       ${PAYOUT_DETAIL_PARENT_FROM}
       WHERE sp.id = $1::uuid AND sp.organization_id = $2::uuid
       LIMIT 1`,
      [id, orgId],
    );
    const parent = rows[0];
    if (!parent) return res.status(404).json({ message: "Subcontractor payout not found" });

    const { rows: driverPayouts } = await pool.query(
      `SELECT dp.id::text,
              dp.driver_id::text,
              d.first_name,
              d.last_name,
              dp.payment_status,
              dp.payment_date::text
       FROM driver_payouts dp
       INNER JOIN drivers d ON d.id = dp.driver_id
       WHERE dp.subcontractor_payout_id = $1::uuid
       ORDER BY d.last_name, d.first_name`,
      [id],
    );

    return res.json({ ...parent, driverPayouts });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Get subcontractor payout error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

export { router as subcontractorPayoutRoutes };
