-- Run after 042: new columns exist (no data assertions; historical rows may have NULLs)

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'payout_adjustments'
  AND column_name IN ('previous_remaining_debt', 'new_remaining_debt', 'applied_amount')
ORDER BY column_name;
