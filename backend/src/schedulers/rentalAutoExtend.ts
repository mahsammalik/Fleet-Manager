import cron from "node-cron";
import { pool } from "../db/pool";

type ExtendedRentalRow = {
  rental_id: string;
  driver_id: string;
  organization_id: string;
  previous_end_date: string;
  new_end_date: string;
};

let isRunning = false;

async function runRentalAutoExtendJob(): Promise<void> {
  if (isRunning) {
    // eslint-disable-next-line no-console
    console.warn("[scheduler] Rental auto-extend skipped: previous run still active");
    return;
  }

  isRunning = true;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { rows } = await client.query<ExtendedRentalRow>(
      `
      UPDATE vehicle_rentals
      SET
        rental_end_date = (rental_end_date + INTERVAL '7 day')::date,
        updated_at = NOW()
      WHERE status = 'active'
        AND CURRENT_DATE = (rental_end_date + INTERVAL '1 day')::date
      RETURNING
        id AS rental_id,
        driver_id,
        organization_id,
        (rental_end_date - INTERVAL '7 day')::date::text AS previous_end_date,
        rental_end_date::text AS new_end_date
      `,
    );

    for (const rental of rows) {
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
          `Rental auto-extended from ${rental.previous_end_date} to ${rental.new_end_date}`,
          JSON.stringify({
            rental_id: rental.rental_id,
            rental_end_date: rental.previous_end_date,
            organization_id: rental.organization_id,
          }),
          JSON.stringify({
            rental_id: rental.rental_id,
            rental_end_date: rental.new_end_date,
            organization_id: rental.organization_id,
            extension_days: 7,
            reason: "Auto extension on overdue day 1",
          }),
        ],
      );
    }

    await client.query("COMMIT");

    // eslint-disable-next-line no-console
    console.info(`[scheduler] Rental auto-extend completed. Extended rentals: ${rows.length}`);
  } catch (error) {
    await client.query("ROLLBACK");
    // eslint-disable-next-line no-console
    console.error("[scheduler] Rental auto-extend failed", error);
  } finally {
    client.release();
    isRunning = false;
  }
}

export function startRentalAutoExtendScheduler(): void {
  cron.schedule("0 2 * * *", async () => {
    await runRentalAutoExtendJob();
  });

  // eslint-disable-next-line no-console
  console.info("[scheduler] Rental auto-extend scheduler started (daily at 02:00)");
}

