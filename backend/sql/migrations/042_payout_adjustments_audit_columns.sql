-- Before/after remaining debt + optional applied magnitude for forgive/cash (delta remains in amount for compatibility)

ALTER TABLE payout_adjustments
    ADD COLUMN IF NOT EXISTS previous_remaining_debt NUMERIC(12, 2),
    ADD COLUMN IF NOT EXISTS new_remaining_debt NUMERIC(12, 2),
    ADD COLUMN IF NOT EXISTS applied_amount NUMERIC(12, 2);

COMMENT ON COLUMN payout_adjustments.amount IS 'Signed change in remaining_debt (new - previous).';
COMMENT ON COLUMN payout_adjustments.previous_remaining_debt IS 'remaining_debt_amount before this adjustment.';
COMMENT ON COLUMN payout_adjustments.new_remaining_debt IS 'remaining_debt_amount after this adjustment.';
COMMENT ON COLUMN payout_adjustments.applied_amount IS 'Positive magnitude of reduction for forgive/cash_received; NULL for adjust/carry_forward.';
