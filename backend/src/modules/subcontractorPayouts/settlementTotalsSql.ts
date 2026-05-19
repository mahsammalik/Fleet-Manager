/**
 * Settlement totals are vertical SUMs from driver_payouts only.
 * total_commission = SUM(company_commission); subcontractor_payouts has no commission columns.
 */
export const SETTLEMENT_TOTALS_FROM = `
  FROM subcontractors s
  LEFT JOIN subcontractor_settlement_totals($1::uuid, $2::date, $3::date) st
    ON st.subcontractor_id = s.id
  LEFT JOIN subcontractor_payouts sp
    ON sp.subcontractor_id = s.id
   AND sp.organization_id = s.organization_id
   AND sp.payment_period_start = $2::date
   AND sp.payment_period_end = $3::date`;

export const SETTLEMENT_TOTALS_SELECT = `
       sp.id::text,
       s.id::text AS subcontractor_id,
       s.legal_name,
       s.status::text AS subcontractor_status,
       st.driver_payout_count,
       COALESCE(st.total_gross_income, 0)::text AS total_gross_income,
       COALESCE(st.total_tips, 0)::text AS total_tips,
       COALESCE(st.total_commission, 0)::text AS total_commission,
       COALESCE(st.total_vehicle_rent, 0)::text AS total_vehicle_rent,
       COALESCE(st.total_account_opening_fee, 0)::text AS total_account_opening_fee,
       COALESCE(st.total_platform_fees, 0)::text AS total_platform_fees,
       COALESCE(st.total_daily_cash, 0)::text AS total_daily_cash,
       COALESCE(st.total_payable, 0)::text AS total_payable,
       COALESCE(st.total_payable, 0)::text AS amount_payable,
       COALESCE(sp.payment_status, 'pending') AS payment_status,
       sp.payment_date::text,
       sp.payment_method,
       sp.payment_reference,
       sp.paid_amount::text AS paid_amount`;

/** Totals for one settlement row: SUM(driver_payouts) WHERE subcontractor_payout_id = sp.id */
export const PAYOUT_TOTALS_BY_PAYOUT_ID_LATERAL = `
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS driver_payout_count,
           ROUND(COALESCE(SUM(dp.total_gross_earnings), 0)::numeric, 2) AS total_gross_income,
           ROUND(COALESCE(SUM(dp.tips), 0)::numeric, 2) AS total_tips,
           ROUND(COALESCE(SUM(dp.company_commission), 0)::numeric, 2) AS total_commission,
           ROUND(COALESCE(SUM(dp.vehicle_rental_fee), 0)::numeric, 2) AS total_vehicle_rent,
           ROUND(COALESCE(SUM(dp.account_opening_fee), 0)::numeric, 2) AS total_account_opening_fee,
           ROUND(COALESCE(SUM(dp.total_platform_fees), 0)::numeric, 2) AS total_platform_fees,
           ROUND(COALESCE(SUM(dp.total_daily_cash), 0)::numeric, 2) AS total_daily_cash,
           ROUND(COALESCE(SUM(dp.net_driver_payout), 0)::numeric, 2) AS total_payable
    FROM driver_payouts dp
    WHERE dp.subcontractor_payout_id = sp.id
  ) pt ON true`;

export const PAYOUT_TOTALS_BY_PAYOUT_ID_SELECT = `
       pt.driver_payout_count,
       COALESCE(pt.total_gross_income, 0)::text AS total_gross_income,
       COALESCE(pt.total_tips, 0)::text AS total_tips,
       COALESCE(pt.total_commission, 0)::text AS total_commission,
       COALESCE(pt.total_vehicle_rent, 0)::text AS total_vehicle_rent,
       COALESCE(pt.total_account_opening_fee, 0)::text AS total_account_opening_fee,
       COALESCE(pt.total_platform_fees, 0)::text AS total_platform_fees,
       COALESCE(pt.total_daily_cash, 0)::text AS total_daily_cash,
       COALESCE(pt.total_payable, 0)::text AS total_payable,
       COALESCE(pt.total_payable, 0)::text AS amount_payable`;

export const PAYOUT_DETAIL_PARENT_FROM = `
  FROM subcontractor_payouts sp
  INNER JOIN subcontractors s ON s.id = sp.subcontractor_id AND s.organization_id = sp.organization_id
  ${PAYOUT_TOTALS_BY_PAYOUT_ID_LATERAL}`;
