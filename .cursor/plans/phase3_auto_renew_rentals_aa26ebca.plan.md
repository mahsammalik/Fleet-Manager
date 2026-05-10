---
name: Phase3 Auto Renew Rentals
overview: Implement full Phase 3 recurring-rental automation with schema updates, scheduler-based auto-renew, and API support for recurring fields, using rental payment/deposit state to gate eligibility.
todos: []
isProject: false
---

# Phase 3: Auto-Renew Recurring Rentals

## Goal
Automatically create the next rental period when eligible recurring rentals reach end date, while allowing admins to control recurrence through rental create/update APIs.

## Scope
Implement full Phase 3 now:
- DB migration for recurring fields + index
- Scheduler auto-renew logic
- API support for recurring fields in rental create/update

Eligibility source for blocking renewals:
- Use rental payment/deposit state (`payment_status`, `deposit_status`, etc.), not `driver_payouts` debt fields.

## Target Files
- [backend/sql/migrations/049_auto_renew_rentals.sql](backend/sql/migrations/049_auto_renew_rentals.sql)
- [backend/src/modules/vehicles/routes.ts](backend/src/modules/vehicles/routes.ts)
- [backend/src/schedulers/rentalAutoExtend.ts](backend/src/schedulers/rentalAutoExtend.ts)
- [backend/sql/schema.sql](backend/sql/schema.sql) (if this repo keeps canonical schema synchronized with migrations)

## Implementation Plan
1. Add recurring schema fields via migration.
   - Create migration using next available number (`049_auto_renew_rentals.sql`) to avoid collision with existing `048_*` files.
   - Add columns to `vehicle_rentals`:
     - `is_recurring BOOLEAN DEFAULT false`
     - `auto_renew_interval INTEGER DEFAULT 7`
     - `max_renewal_date DATE NULL`
     - `renewed_from_id UUID NULL REFERENCES vehicle_rentals(id)`
   - Add partial index optimized for renewal scans:
     - on `(rental_end_date, is_recurring, status)` with `WHERE is_recurring = true AND status = 'active'`.

2. Expose recurring fields in rental create/update APIs.
   - In [backend/src/modules/vehicles/routes.ts](backend/src/modules/vehicles/routes.ts):
     - Extend `POST /:id/rentals` body parsing and insert list to accept/store recurring fields.
     - Extend `PATCH /:vehicleId/rentals/:rentalId` body parsing and update query with `COALESCE` behavior.
   - Validate:
     - `auto_renew_interval` positive integer (default `7`).
     - `max_renewal_date` must be valid date and not before current rental start/end context.

3. Implement auto-renew scheduler logic.
   - Update [backend/src/schedulers/rentalAutoExtend.ts](backend/src/schedulers/rentalAutoExtend.ts) to process only eligible recurring rentals:
     - `rental_end_date = CURRENT_DATE`
     - `is_recurring = true`
     - rental `status = 'active'`
     - driver employment status is active
     - vehicle status not in disallowed states (`maintenance`, `sold`, `scrapped`)
     - renewal blocked if payment/deposit state indicates unresolved obligations (rule-driven checks on rental fields).
   - Create next rental row by copying relevant fields and shifting date window by `auto_renew_interval`.
   - Set linkage:
     - new row `renewed_from_id = previous.id`
   - Respect stop conditions:
     - `is_recurring = false`
     - driver/vehicle disallowed status
     - `max_renewal_date` reached/exceeded
     - deposit/payment blocking conditions.

4. Ensure safe, idempotent scheduler execution.
   - Keep existing non-overlap guard (`isRunning`) and transaction boundaries.
   - Use row locking/defensive conditions to prevent duplicate renewals if job reruns.
   - Emit concise logs for renewed vs skipped counts and reasons.

5. Keep compatibility and observability.
   - Existing overdue/bulk-complete behavior remains unchanged.
   - If response payloads include rental records, recurring fields flow naturally from `SELECT r.*` paths.
   - Optionally include renewal reason in notes/audit trail for traceability.

6. Validate and regression-check.
   - Lint/type-check touched backend files.
   - Verify with representative scenarios:
     - eligible recurring rental renews exactly once
     - non-active driver/blocked vehicle skips renewal
     - unresolved payment/deposit state blocks renewal
     - max renewal date stops renewal
     - manual toggle `is_recurring=false` stops renewal.

## Expected Outcome
Recurring rentals renew automatically for eligible drivers/vehicles on end date, reducing weekly manual admin work while preserving control and stop safeguards through existing API flows.