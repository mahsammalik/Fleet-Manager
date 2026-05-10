import cron from "node-cron";
import { pool } from "../db/pool";

type RenewableRentalRow = {
  rental_id: string;
  vehicle_id: string;
  driver_id: string;
  organization_id: string;
  rental_start_date: string;
  rental_end_date: string;
  rental_type: "daily" | "weekly" | "monthly" | null;
  total_rent_amount: string | null;
  deposit_amount: string | null;
  payment_status: "pending" | "paid" | "partial" | "overdue" | null;
  deposit_status: "pending" | "paid" | "refunded" | "partial" | null;
  notes: string | null;
  auto_renew_interval: number | null;
  max_renewal_date: string | null;
};

let isRunning = false;

async function runRentalAutoExtendJob(): Promise<void> {
  if (isRunning) {
    // eslint-disable-next-line no-console
    console.warn("[scheduler] Rental auto-renew skipped: previous run still active");
    return;
  }

  isRunning = true;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { rows } = await client.query<RenewableRentalRow>(
      `
      SELECT
        r.id::text AS rental_id,
        r.vehicle_id::text,
        r.driver_id::text,
        r.organization_id::text,
        r.rental_start_date::text,
        r.rental_end_date::text,
        r.rental_type,
        r.total_rent_amount::text,
        r.deposit_amount::text,
        r.payment_status,
        r.deposit_status,
        r.notes,
        r.auto_renew_interval,
        r.max_renewal_date::text
      FROM vehicle_rentals r
      JOIN drivers d ON d.id = r.driver_id
      JOIN vehicles v ON v.id = r.vehicle_id
      LEFT JOIN vehicle_rentals nx
        ON nx.renewed_from_id = r.id
        AND nx.organization_id = r.organization_id
        AND nx.status = 'active'
      WHERE r.status = 'active'
        AND r.is_recurring = true
        AND r.rental_end_date = CURRENT_DATE
        AND d.employment_status = 'active'
        AND v.status IN ('available', 'rented')
        AND nx.id IS NULL
        AND (r.max_renewal_date IS NULL OR CURRENT_DATE < r.max_renewal_date)
        AND COALESCE(r.payment_status, 'pending') NOT IN ('pending', 'overdue')
        AND NOT (
          COALESCE(r.deposit_amount, 0) > 0
          AND COALESCE(r.deposit_status, 'pending') IN ('pending', 'paid', 'partial')
        )
      FOR UPDATE SKIP LOCKED
      `,
    );

    let renewed = 0;
    let skipped = 0;
    for (const rental of rows) {
      const intervalDays = Number(rental.auto_renew_interval ?? 7) || 7;
      if (intervalDays <= 0) {
        skipped += 1;
        continue;
      }

      const nextStartRes = await client.query<{ d: string }>(
        "SELECT ($1::date + INTERVAL '1 day')::date::text AS d",
        [rental.rental_end_date],
      );
      const nextEndRes = await client.query<{ d: string }>(
        "SELECT ($1::date + ($2::int * INTERVAL '1 day'))::date::text AS d",
        [rental.rental_end_date, intervalDays],
      );
      const nextStart = nextStartRes.rows[0]?.d;
      const nextEnd = nextEndRes.rows[0]?.d;
      if (!nextStart || !nextEnd) {
        skipped += 1;
        continue;
      }

      if (rental.max_renewal_date && nextStart > rental.max_renewal_date) {
        skipped += 1;
        continue;
      }

      const nextNotes = [rental.notes?.trim() ?? "", `Auto-renewed from rental ${rental.rental_id}`]
        .filter(Boolean)
        .join(" | ");

      await client.query(
        `
        INSERT INTO vehicle_rentals (
          vehicle_id, driver_id, organization_id,
          rental_start_date, rental_end_date, rental_type, total_rent_amount,
          deposit_amount, deposit_status, deposit_paid_at, deposit_refunded_at, deposit_deduction_amount, deposit_deduction_reason,
          payment_status, payment_date, payment_method, payment_reference, rent_paid_amount,
          status, notes, is_recurring, auto_renew_interval, max_renewal_date, renewed_from_id, created_by
        )
        VALUES (
          $1, $2, $3,
          $4, $5, $6, $7,
          $8, NULL, NULL, NULL, 0, NULL,
          'pending', NULL, NULL, NULL, 0,
          'active', $9, true, $10, $11, $12, NULL
        )
        `,
        [
          rental.vehicle_id,
          rental.driver_id,
          rental.organization_id,
          nextStart,
          nextEnd,
          rental.rental_type ?? "daily",
          rental.total_rent_amount,
          rental.deposit_amount ?? 0,
          nextNotes || null,
          intervalDays,
          rental.max_renewal_date,
          rental.rental_id,
        ],
      );

      await client.query(
        "UPDATE vehicle_rentals SET status = 'completed', updated_at = NOW() WHERE id = $1",
        [rental.rental_id],
      );

      renewed += 1;

      await client.query(
        `
        INSERT INTO driver_activities (
          driver_id,
          activity_type,
          activity_description,
          old_values,
          new_values
        )
        VALUES ($1, $2, $3, $4, $5)
        `,
        [
          rental.driver_id,
          "rental_auto_extended",
          `Recurring rental auto-renewed from ${rental.rental_end_date} to ${nextEnd}`,
          JSON.stringify({
            rental_id: rental.rental_id,
            rental_end_date: rental.rental_end_date,
            organization_id: rental.organization_id,
          }),
          JSON.stringify({
            renewed_from_id: rental.rental_id,
            rental_start_date: nextStart,
            rental_end_date: nextEnd,
            organization_id: rental.organization_id,
            renewal_interval_days: intervalDays,
            reason: "Auto renew recurring rental",
          }),
        ],
      );
    }

    await client.query("COMMIT");

    // eslint-disable-next-line no-console
    console.info(
      `[scheduler] Rental auto-renew completed. Eligible: ${rows.length}, renewed: ${renewed}, skipped: ${skipped}`,
    );
  } catch (error) {
    await client.query("ROLLBACK");
    // eslint-disable-next-line no-console
    console.error("[scheduler] Rental auto-renew failed", error);
  } finally {
    client.release();
    isRunning = false;
  }
}

export function startRentalAutoExtendScheduler(): void {
  cron.schedule("0 2 * * *", async () => {
  // cron.schedule("*/30 * * * * *", async () => {
    await runRentalAutoExtendJob();
  });

  // eslint-disable-next-line no-console
  console.info("[scheduler] Rental auto-renew scheduler started (daily at 02:00)");
}
