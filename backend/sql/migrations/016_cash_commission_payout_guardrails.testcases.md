## Test Cases: Cash Commission Deduction

1. **Percentage with cash commission**
- Input: `transfer_base=4026.44`, `company_commission=25.10`, `cash_commission=-25.10`
- Expected: `driver_payout=4001.34`, `driver_payout_after_cash=4001.34`, `has_cash_commission=true`

2. **No cash commission**
- Input: `cash_commission=0`
- Expected: `has_cash_commission=false`; payout still follows `max(0, transfer_base - company_commission)`

3. **Over-commission**
- Input: `transfer_base=100`, `company_commission=150`
- Expected: `driver_payout=0` (clamped)

4. **Trigger protection**
- Insert/update row with stale `driver_payout`; expected trigger rewrites `driver_payout` and `net_earnings` to computed value.

5. **Bulk repair**
- After running migration `016_cash_commission_payout_guardrails.sql`, query `016_cash_commission_payout_guardrails.verify.sql` should return:
  - `broken_cash_rows = 0`
  - inspected rows have `ok = true`
