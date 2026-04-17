# Test cases: signed commission / negative TVT (Total Venituri de transferat)

Migration: [`028_signed_commission_for_negative_transfer.sql`](028_signed_commission_for_negative_transfer.sql)

## Formula (superseded for cash leg by migration 029)

See [`029_payout_abs_cash_commission_deduction.sql`](029_payout_abs_cash_commission_deduction.sql) and [`029_payout_abs_cash_commission_deduction.testcases.md`](029_payout_abs_cash_commission_deduction.testcases.md).

- **Transfer base:** `COALESCE(total_transfer_earnings, net_earnings, gross - platform_fee, gross, 0)` (see generated column in schema).
- **Driver net after commission:**  
  `driver_payout = ROUND(base - transfer_commission - ABS(cash_commission), 2)`  
  **Transfer:** signed (`transfer_commission` can be negative when TVT is negative).  
  **Cash:** stored `cash_commission` may be negative for negative daily cash; payout subtracts **`|cash_commission|`** (Glovo / Excel parity).

When TVT is negative, `transfer_commission` is negative; subtracting it still follows “minus signed”, which moves the net toward zero vs wrongly using `ABS` on the transfer leg.

## Numeric examples (percentage commission)

Assume **15%** on transfer and cash bases unless noted.

| # | TVT (base) | transfer_comm | cash_comm | Expected driver_net | Wrong if ABS used |
|---|------------|---------------|-----------|---------------------|-------------------|
| A | 100 | 15 | 0 | 100 − 15 = **85** | 85 (same) |
| B | −100 | −15 | 0 | −100 − (−15) = **−85** | −100 − 15 = **−115** |
| C | −100 | −15 | −3 (e.g. daily_cash −20 → −3) | −100 − (−15) − **3** = **−88** (ABS on cash) | −100 − (−15) − (−3) = −82 if cash were fully signed |
| D | 0 | 0 | 0 | **0** | 0 |

## TypeScript parity

Commit path: [`backend/src/modules/earnings/earningsCommit.ts`](../../src/modules/earnings/earningsCommit.ts) — `rawNetPayout = roundMoney(transferAmount - comm.transfer_commission - Math.abs(comm.cash_commission))`.

Recalculate / integrity SQL: [`backend/src/modules/earnings/routes.ts`](../../src/modules/earnings/routes.ts) — subtract `COALESCE(transfer_commission,0)` and **`ABS(COALESCE(cash_commission,0))`**.

## Operational check

After changing TypeScript, run `npm run build` in `backend/` before `node dist/index.js` so `dist/` does not serve stale payout logic.

## Edge note

If `minimum_commission` bumps `company_commission` above the sum of transfer and signed cash components, the DB generated column and trigger still use **signed `transfer_commission` and `ABS(cash_commission)`** only; align any product change across trigger, schema, commit, and tests together.
