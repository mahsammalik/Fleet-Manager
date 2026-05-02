-- Align commission_base with ladder net_income everywhere it drifted (e.g. old TVT-based rollup).

UPDATE driver_payouts
SET commission_base = net_income
WHERE net_income IS NOT NULL
  AND commission_base IS DISTINCT FROM net_income;

COMMENT ON COLUMN driver_payouts.commission_base IS 'Period sum of ladder net income (matches net_income); fleet transfer-leg bases stay implicit per earnings_records';
