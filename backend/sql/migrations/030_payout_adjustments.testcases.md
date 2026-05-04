# Migration 030 — payout_adjustments (manual debt audit)

## Preconditions

- `driver_payouts` has `raw_net_amount`, `debt_amount`, `remaining_debt_amount`, `debt_applied_amount`, `payment_status` including `debt` and `hold`.
- `payout_adjustments` exists (030).

## Scenario A — Negative CSV week → debt row

1. Import earnings for a driver where rolled-up `raw_net_amount` for the period is **−83.07**.
2. After commit, that `driver_payouts` row has:
   - `payment_status = 'debt'`
   - `debt_amount = 83.07`, `remaining_debt_amount = 83.07`
   - `net_driver_payout = 0`
3. `POST /api/earnings/payouts/bulk` with `paymentStatus: paid` must **not** mark this row paid (existing guard).

## Scenario B — Next positive week auto-deducts

1. Week 1 as in A (`remaining_debt_amount = 83.07`).
2. Import week 2 with `raw_net_amount = 2135.73` for the same driver.
3. After commit, week 2 row has `debt_applied_amount = 83.07`, `net_driver_payout ≈ 2052.66`, week 1 `remaining_debt_amount = 0`.

## Scenario C — Forgive + audit row

1. Week 1 still has `remaining_debt_amount > 0` (or repeat A without B).
2. `POST /api/earnings/payouts/{week1_payout_id}/adjust-debt` with body `{ "type": "forgive", "note": "management" }`.
3. Week 1: `remaining_debt_amount = 0`, `payment_status = 'hold'` (negative raw, cleared).
4. `payout_adjustments` has one row: `adjustment_type = forgive`, `amount` equals change in remaining (negative delta).
5. After migration 042: same row has `previous_remaining_debt`, `new_remaining_debt`, and `applied_amount` populated (`applied_amount` = reduction magnitude).

## Scenario D — Carry forward recompute

1. `POST /api/earnings/debts/bulk-carry-forward` with optional `from` / `to` / `driverIds`.
2. Response `driversProcessed` matches distinct drivers in filter.
3. Re-run scenario B totals unchanged (within rounding) when data unchanged.

## Scenario E — Partial forgive + re-import does not restore full debt

1. Week 1 as in A with `remaining_debt_amount = 83.07`.
2. `POST .../adjust-debt` with `{ "type": "forgive", "amount": 40 }` → remaining ≈ 43.07.
3. Re-run earnings commit / carry-forward for that driver so `applyDebtCarryForward` runs on week 1 again.
4. Expect `remaining_debt_amount` to stay ≈ 43.07 (not reset to 83.07).

## Scenario F — `adjust` positive amount reduces remaining (negative increases)

1. Payout with `remaining_debt_amount = 100`.
2. `POST .../adjust-debt` with `{ "type": "adjust", "amount": 50 }`.
3. Expect `remaining_debt_amount = 50` and audit `amount = -50` (signed delta new − previous).
4. `POST .../adjust-debt` with `{ "type": "adjust", "amount": -50 }` on a row with remaining 50 → remaining `100`, audit `amount = +50`.

## Scenario G — Forgive / cash cannot exceed remaining (400)

1. `remaining_debt_amount = 100`.
2. `POST .../adjust-debt` with `{ "type": "forgive", "amount": 120 }` → **400** with message about exceeding remaining.
3. Same for `{ "type": "cash_received", "amount": 120 }`.
