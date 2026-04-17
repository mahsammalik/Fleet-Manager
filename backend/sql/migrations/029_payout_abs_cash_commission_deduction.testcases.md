# Test cases: payout uses `ABS(cash_commission)` for deduction

Migration: [`029_payout_abs_cash_commission_deduction.sql`](029_payout_abs_cash_commission_deduction.sql)

## Formula

- **Transfer base:** unchanged (`COALESCE(total_transfer_earnings, …)`).
- **Driver payout / net after commission:**

  `driver_payout = ROUND(base - transfer_commission - ABS(cash_commission), 2)`

- **Transfer commission:** signed (`rate × TVT`). Negative TVT → negative `transfer_commission` (subtracting it reduces how negative the net is).
- **Cash leg:** `cash_commission` remains stored **signed** (e.g. negative daily cash → negative `cash_commission` for reporting), but the amount **deducted from the driver** is **`|cash_commission|`**, matching Glovo / Excel when daily cash is negative.

## Glovo-style row (matches user spreadsheet)

Assume **10%** commission.

| Field | Value |
|-------|------|
| Total Venituri de transferat (TVT) | −69.32 |
| Plata zilnica cu cash | −316.28 |
| `transfer_commission` | −6.93 (10% × TVT) |
| `cash_commission` (stored) | −31.63 (10% × daily cash) |

**Expected `driver_payout`:**

`−69.32 − (−6.93) − |−31.63| = −69.32 + 6.93 − 31.63 ≈ **−94.02**`

(Fully signed subtraction would give **−30.76** — incorrect vs Excel for this product rule.)

## Other checks

| Scenario | transfer_comm | cash_comm | Payout |
|----------|----------------|-----------|--------|
| TVT 100, daily 50, 10% | 10 | 5 | 100 − 10 − 5 = **85** (`ABS` on positive cash unchanged) |
| TVT −100, daily 0, 10% | −10 | 0 | −100 − (−10) − 0 = **−90** |
| TVT 100, daily −200, 10% | 10 | −20 | 100 − 10 − 20 = **70** (not 110 from subtracting −20) |

## Parity

- TypeScript commit: [`backend/src/modules/earnings/earningsCommit.ts`](../../src/modules/earnings/earningsCommit.ts)
- Recalculate / integrity SQL: [`backend/src/modules/earnings/routes.ts`](../../src/modules/earnings/routes.ts)

`company_commission` in the DB may still be the signed sum of components from [`computeCommissionComponents`](../../src/modules/earnings/commission.ts); it can differ from `TVT − driver_payout` when daily cash is negative — use payout columns for driver money.
