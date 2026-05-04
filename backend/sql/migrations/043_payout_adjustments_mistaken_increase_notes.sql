-- API note: `adjust` request body uses positive amount to REDUCE remaining debt; negative increases it.
-- Rows below are positive *stored* deltas (new − previous) for type=adjust — often from the old API where
-- positive request amount increased remaining (same mistaken outcome as "forgive" typed as adjust +50).
--
-- Optional repair aid: list payout_adjustments that look like mistaken debt INCREASES via type=adjust.
-- Review each row before any UPDATE. Do not run blindly in production.
--
-- Example manual fix (uncomment and edit IDs after business approval):
-- BEGIN;
-- UPDATE driver_payouts SET remaining_debt_amount = <correct_remaining>, payment_status = <correct_status>
-- WHERE id = '<payout_uuid>';
-- DELETE FROM payout_adjustments WHERE id = '<bad_adjustment_uuid>'; -- or leave audit row and add compensating row
-- COMMIT;

SELECT pa.id AS adjustment_id,
       pa.organization_id,
       pa.payout_id,
       pa.adjustment_type,
       pa.amount AS signed_delta,
       pa.previous_remaining_debt,
       pa.new_remaining_debt,
       pa.reason,
       pa.created_at
FROM payout_adjustments pa
WHERE pa.adjustment_type = 'adjust'
  AND pa.amount > 0
ORDER BY pa.created_at DESC;
