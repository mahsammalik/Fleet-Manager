import type { PoolClient } from "pg";
import { Router } from "express";
import { authenticateJWT, requireRole } from "../../middleware/auth";
import { pool, query } from "../../db/pool";
import { logDriverActivity } from "../drivers/activity";

const router = Router();

router.use(authenticateJWT);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RentalDepositSnapshot = {
  id: string;
  vehicle_id: string;
  driver_id: string;
  organization_id: string;
  rental_start_date: string;
  rental_type: "daily" | "weekly" | "monthly" | null;
  completion_date: string;
  daily_rent: string | null;
  weekly_rent: string | null;
  monthly_rent: string | null;
  deposit_amount: string | null;
  deposit_status: "pending" | "paid" | "refunded" | "partial" | null;
  deposit_deduction_amount: string | null;
  deposit_deduction_reason: string | null;
};

type BulkOverdueCompletionItem = {
  rentalId: string;
  completionDate?: string;
  deductionAmount?: number;
  deductionReason?: string;
};

function daysUsedInclusive(startDate: string, endDate: string): number {
  const startMs = Date.parse(`${startDate}T00:00:00Z`);
  const endMs = Date.parse(`${endDate}T00:00:00Z`);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return 1;
  const diffDays = Math.floor((endMs - startMs) / 86400000) + 1;
  return Math.max(1, diffDays);
}

function roundTo2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeDateInput(input?: string): string | null {
  if (!input) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return null;
  const parsed = new Date(`${input}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return input;
}

function normalizePositiveInt(input: unknown, fallback: number): number | null {
  if (typeof input === "undefined" || input === null || input === "") return fallback;
  const n = Number(input);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function calculateProratedTotalRent(rental: RentalDepositSnapshot): number {
  const actualDays = daysUsedInclusive(rental.rental_start_date, rental.completion_date);
  const type = rental.rental_type ?? "daily";
  const dailyRate = Number(rental.daily_rent ?? 0) || 0;
  const weeklyRate = Number(rental.weekly_rent ?? 0) || 0;
  const monthlyRate = Number(rental.monthly_rent ?? 0) || 0;

  if (type === "weekly") return roundTo2((weeklyRate / 7) * actualDays);
  if (type === "monthly") return roundTo2((monthlyRate / 30) * actualDays);
  return roundTo2(dailyRate * actualDays);
}

/** Full-period contract total for a span using vehicle rate columns (mirrors proration shape). */
function contractTotalForSpanFromVehicleRates(
  rentalType: string | null | undefined,
  spanDays: number,
  dailyRent: string | null | undefined,
  weeklyRent: string | null | undefined,
  monthlyRent: string | null | undefined,
): number | null {
  const type = rentalType ?? "daily";
  const dailyRate = Number(dailyRent ?? 0) || 0;
  const weeklyRate = Number(weeklyRent ?? 0) || 0;
  const monthlyRate = Number(monthlyRent ?? 0) || 0;
  const sd = Math.max(1, spanDays);
  if (type === "weekly") {
    if (weeklyRate <= 0) return null;
    return roundTo2((weeklyRate / 7) * sd);
  }
  if (type === "monthly") {
    if (monthlyRate <= 0) return null;
    return roundTo2((monthlyRate / 30) * sd);
  }
  if (dailyRate <= 0) return null;
  return roundTo2(dailyRate * sd);
}

function addDaysToDateString(dateStr: string, deltaDays: number): string {
  const raw = dateStr.slice(0, 10);
  const [y, m, d] = raw.split("-").map((x) => Number(x));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

async function completeRentalWithDepositRefund(
  rental: RentalDepositSnapshot,
  userId: string | undefined,
  options: { deductionAmount?: number; deductionReason?: string; completionDate?: string } = {},
): Promise<void> {
  const effectiveCompletionDate = options.completionDate ?? rental.completion_date;
  const proratedTotalRentAmount = calculateProratedTotalRent({
    ...rental,
    completion_date: effectiveCompletionDate,
  });
  const depositAmount = Number(rental.deposit_amount ?? 0) || 0;
  let deductionAmount = Number(rental.deposit_deduction_amount ?? 0) || 0;
  let deductionReason = rental.deposit_deduction_reason ?? null;

  if (typeof options.deductionAmount === "number") {
    if (options.deductionAmount < 0 || options.deductionAmount > depositAmount) {
      throw new Error("Invalid deductionAmount");
    }
    deductionAmount = options.deductionAmount;
    deductionReason = options.deductionReason ?? deductionReason ?? "Overdue rental deduction";
  }

  const refundableAmount = Math.max(0, depositAmount - deductionAmount);
  const nowIso = new Date().toISOString();

  if (depositAmount > 0 && typeof options.deductionAmount === "number" && deductionAmount > 0) {
    await query(
      `
      INSERT INTO deposit_transactions (
        rental_id, organization_id, transaction_type, amount, payment_method, payment_status, notes, created_by
      )
      VALUES ($1, $2, 'deduction', $3, 'cash', 'completed', $4, $5)
      `,
      [rental.id, rental.organization_id, deductionAmount, deductionReason, userId ?? null],
    );
    await logDriverActivity(rental.driver_id, "deposit_deducted", {
      description: `RON ${deductionAmount.toFixed(2)} deducted on rental completion`,
      performedBy: userId,
      newValues: { rental_id: rental.id, deduction_amount: deductionAmount, deduction_reason: deductionReason },
    });
  }

  if (depositAmount > 0 && refundableAmount > 0 && (rental.deposit_status === "paid" || rental.deposit_status === "partial")) {
    await query(
      `
      INSERT INTO deposit_transactions (
        rental_id, organization_id, transaction_type, amount, payment_method, payment_status, notes, created_by
      )
      VALUES ($1, $2, 'refund', $3, 'cash', 'completed', $4, $5)
      `,
      [rental.id, rental.organization_id, refundableAmount, "Auto refund on rental completion", userId ?? null],
    );
    await logDriverActivity(rental.driver_id, "deposit_refunded", {
      description: `Deposit auto-refunded: RON ${refundableAmount.toFixed(2)}`,
      performedBy: userId,
      newValues: { rental_id: rental.id, refunded_amount: refundableAmount },
    });
  }

  if (depositAmount > 0) {
    await query(
      `
      UPDATE vehicle_rentals
      SET
        deposit_status = CASE WHEN $1 > 0 THEN 'partial' ELSE 'refunded' END,
        deposit_refunded_at = COALESCE(deposit_refunded_at, $2),
        deposit_deduction_amount = $1,
        deposit_deduction_reason = $3,
        updated_at = NOW()
      WHERE id = $4 AND organization_id = $5
      `,
      [deductionAmount, nowIso, deductionReason, rental.id, rental.organization_id],
    );
  }

  await query(
    `
    UPDATE vehicle_rentals
    SET status = 'completed', rental_end_date = $3, total_rent_amount = $4, updated_at = NOW()
    WHERE id = $1 AND organization_id = $2
    `,
    [rental.id, rental.organization_id, effectiveCompletionDate, proratedTotalRentAmount],
  );

  await query(
    "UPDATE vehicles SET status = 'available', current_driver_id = NULL, updated_at = NOW() WHERE id = $1 AND organization_id = $2",
    [rental.vehicle_id, rental.organization_id],
  );

  await query(
    "UPDATE drivers SET current_vehicle_id = NULL, updated_at = NOW() WHERE id = $1 AND organization_id = $2",
    [rental.driver_id, rental.organization_id],
  );
}

// --- Vehicles list
function appendVehicleSearchCondition(conditions: string[], params: unknown[], rawSearch: string) {
  const term = rawSearch.trim();
  if (!term) return;
  params.push(`%${term}%`);
  const idx = params.length;
  conditions.push(`(
    LOWER(v.license_plate) LIKE LOWER($${idx})
    OR LOWER(COALESCE(v.vin, '')) LIKE LOWER($${idx})
    OR LOWER(v.make) LIKE LOWER($${idx})
    OR LOWER(v.model) LIKE LOWER($${idx})
    OR LOWER(CONCAT(v.make, ' ', v.model)) LIKE LOWER($${idx})
    OR LOWER(COALESCE(v.vehicle_type, '')) LIKE LOWER($${idx})
    OR LOWER(v.status) LIKE LOWER($${idx})
    OR LOWER(COALESCE(v.current_driver_id::text, '')) LIKE LOWER($${idx})
    OR LOWER(CONCAT(COALESCE(d.first_name, ''), ' ', COALESCE(d.last_name, ''))) LIKE LOWER($${idx})
    OR LOWER(COALESCE(d.first_name, '')) LIKE LOWER($${idx})
    OR LOWER(COALESCE(d.last_name, '')) LIKE LOWER($${idx})
    OR LOWER(COALESCE(d.phone, '')) LIKE LOWER($${idx})
  )`);
}

const VEHICLE_LIST_SELECT = `
      SELECT v.id, v.organization_id, v.vehicle_type, v.make, v.model, v.year, v.color,
             v.license_plate, v.vin, v.fuel_type, v.transmission, v.seating_capacity,
             v.daily_rent, v.weekly_rent, v.monthly_rent, v.insurance_expiry, v.registration_expiry,
             v.status, v.current_driver_id, v.notes, v.created_at, v.updated_at,
             d.first_name AS driver_first_name, d.last_name AS driver_last_name, d.phone AS driver_phone
      FROM vehicles v
      LEFT JOIN drivers d ON v.current_driver_id = d.id
`;

router.get("/", async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }

  const { search, status, limit, offset } = req.query as {
    search?: string;
    status?: string;
    limit?: string;
    offset?: string;
  };
  const params: unknown[] = [orgId];
  const conditions = ["v.organization_id = $1"];

  if (status) {
    params.push(status);
    conditions.push(`v.status = $${params.length}`);
  }
  if (search) {
    appendVehicleSearchCondition(conditions, params, search);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limitNum = limit ? Math.min(Math.max(1, parseInt(limit, 10)), 10_000) : 50;
  const offsetNum = offset ? Math.max(0, parseInt(offset, 10)) : 0;
  params.push(limitNum, offsetNum);
  const limitIdx = params.length - 1;
  const offsetIdx = params.length;

  try {
    const { rows } = await query(
      `
      ${VEHICLE_LIST_SELECT}
      ${where}
      ORDER BY v.created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `,
      params,
    );
    return res.json(rows);
  } catch (err) {
    console.error("List vehicles error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/search", async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }

  const { q, status, limit, offset } = req.query as {
    q?: string;
    status?: string;
    limit?: string;
    offset?: string;
  };
  if (!q || !String(q).trim()) {
    return res.status(400).json({ message: "q is required" });
  }

  const params: unknown[] = [orgId];
  const conditions = ["v.organization_id = $1"];

  if (status) {
    params.push(status);
    conditions.push(`v.status = $${params.length}`);
  }
  appendVehicleSearchCondition(conditions, params, String(q));

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limitNum = limit ? Math.min(Math.max(1, parseInt(limit, 10)), 500) : 200;
  const offsetNum = offset ? Math.max(0, parseInt(offset, 10)) : 0;
  params.push(limitNum, offsetNum);
  const limitIdx = params.length - 1;
  const offsetIdx = params.length;

  try {
    const { rows } = await query(
      `
      ${VEHICLE_LIST_SELECT}
      ${where}
      ORDER BY v.created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `,
      params,
    );
    return res.json(rows);
  } catch (err) {
    console.error("Search vehicles error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// --- Overdue rentals list
router.get("/rentals/overdue", requireRole("admin", "accountant"), async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }

  const {
    minOverdueDays,
    maxOverdueDays,
    vehicleId,
    driverId,
    limit,
    offset,
  } = req.query as {
    minOverdueDays?: string;
    maxOverdueDays?: string;
    vehicleId?: string;
    driverId?: string;
    limit?: string;
    offset?: string;
  };

  const params: unknown[] = [orgId];
  const conditions = [
    "r.organization_id = $1",
    "r.status = 'active'",
    "CURRENT_DATE > r.rental_end_date",
  ];

  if (vehicleId) {
    params.push(vehicleId);
    conditions.push(`r.vehicle_id = $${params.length}`);
  }
  if (driverId) {
    params.push(driverId);
    conditions.push(`r.driver_id = $${params.length}`);
  }
  if (minOverdueDays) {
    params.push(Math.max(0, Number(minOverdueDays)));
    conditions.push(`(CURRENT_DATE - r.rental_end_date) >= $${params.length}`);
  }
  if (maxOverdueDays) {
    params.push(Math.max(0, Number(maxOverdueDays)));
    conditions.push(`(CURRENT_DATE - r.rental_end_date) <= $${params.length}`);
  }

  const limitNum = limit ? Math.min(Math.max(1, parseInt(limit, 10)), 200) : 50;
  const offsetNum = offset ? Math.max(0, parseInt(offset, 10)) : 0;
  params.push(limitNum, offsetNum);
  const limitIdx = params.length - 1;
  const offsetIdx = params.length;

  try {
    const { rows } = await query(
      `
      SELECT
        r.id AS rental_id,
        r.vehicle_id,
        r.driver_id,
        r.rental_start_date,
        r.rental_end_date,
        r.rental_type,
        r.deposit_amount,
        r.deposit_status,
        r.deposit_deduction_amount,
        r.deposit_deduction_reason,
        v.make AS vehicle_make,
        v.model AS vehicle_model,
        v.license_plate,
        v.daily_rent,
        d.first_name AS driver_first_name,
        d.last_name AS driver_last_name,
        (CURRENT_DATE - r.rental_end_date) AS overdue_days,
        ((CURRENT_DATE - r.rental_end_date) * COALESCE(v.daily_rent, 0))::numeric(10,2) AS overdue_amount
      FROM vehicle_rentals r
      JOIN vehicles v ON r.vehicle_id = v.id
      JOIN drivers d ON r.driver_id = d.id
      WHERE ${conditions.join(" AND ")}
      ORDER BY overdue_days DESC, r.rental_end_date ASC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `,
      params,
    );
    return res.json(rows);
  } catch (err) {
    console.error("List overdue rentals error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// --- Active rentals (org-wide, for bulk continuation)
router.get("/rentals/active", requireRole("admin", "accountant"), async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }

  const { limit, offset } = req.query as { limit?: string; offset?: string };
  const limitNum = limit ? Math.min(Math.max(1, parseInt(limit, 10)), 500) : 500;
  const offsetNum = offset ? Math.max(0, parseInt(offset, 10)) : 0;

  try {
    const { rows } = await query(
      `
      SELECT
        r.id AS rental_id,
        r.vehicle_id,
        r.driver_id,
        r.rental_start_date::text AS rental_start_date,
        r.rental_end_date::text AS rental_end_date,
        r.rental_type,
        r.status,
        r.total_rent_amount::text AS total_rent_amount,
        v.license_plate,
        d.first_name AS driver_first_name,
        d.last_name AS driver_last_name
      FROM vehicle_rentals r
      JOIN vehicles v ON r.vehicle_id = v.id
      JOIN drivers d ON r.driver_id = d.id
      WHERE r.organization_id = $1 AND r.status = 'active'
      ORDER BY r.rental_end_date ASC NULLS LAST, d.last_name ASC, d.first_name ASC
      LIMIT $2 OFFSET $3
      `,
      [orgId, limitNum, offsetNum],
    );
    return res.json(rows);
  } catch (err) {
    console.error("List active rentals error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

async function rolloverRentalToNextWeek(
  client: PoolClient,
  orgId: string,
  rentalId: string,
  userId: string | undefined,
): Promise<void> {
  const lockRes = await client.query<{
    id: string;
    vehicle_id: string;
    driver_id: string;
    rental_start_date: string;
    rental_end_date: string;
    rental_type: string | null;
    total_rent_amount: string | null;
    deposit_amount: string | null;
    deposit_status: string | null;
    deposit_deduction_amount: string | null;
    deposit_deduction_reason: string | null;
    notes: string | null;
    is_recurring: boolean | null;
    auto_renew_interval: number | null;
    max_renewal_date: string | null;
    daily_rent: string | null;
    weekly_rent: string | null;
    monthly_rent: string | null;
  }>(
    `
    SELECT
      r.id::text,
      r.vehicle_id::text,
      r.driver_id::text,
      r.rental_start_date::text,
      r.rental_end_date::text,
      r.rental_type,
      r.total_rent_amount::text,
      r.deposit_amount::text,
      r.deposit_status,
      r.deposit_deduction_amount::text,
      r.deposit_deduction_reason,
      r.notes,
      r.is_recurring,
      r.auto_renew_interval,
      r.max_renewal_date::text,
      v.daily_rent::text,
      v.weekly_rent::text,
      v.monthly_rent::text
    FROM vehicle_rentals r
    JOIN vehicles v ON v.id = r.vehicle_id AND v.organization_id = r.organization_id
    WHERE r.id = $1::uuid AND r.organization_id = $2::uuid AND r.status = 'active'
    FOR UPDATE OF r
    `,
    [rentalId, orgId],
  );

  const row = lockRes.rows[0];
  if (!row) {
    throw new Error("Active rental not found");
  }

  const completionDate = row.rental_end_date;
  const snapshot: RentalDepositSnapshot = {
    id: row.id,
    vehicle_id: row.vehicle_id,
    driver_id: row.driver_id,
    organization_id: orgId,
    rental_start_date: row.rental_start_date,
    rental_type: (row.rental_type as RentalDepositSnapshot["rental_type"]) ?? null,
    completion_date: completionDate,
    daily_rent: row.daily_rent,
    weekly_rent: row.weekly_rent,
    monthly_rent: row.monthly_rent,
    deposit_amount: row.deposit_amount,
    deposit_status: row.deposit_status as RentalDepositSnapshot["deposit_status"],
    deposit_deduction_amount: row.deposit_deduction_amount,
    deposit_deduction_reason: row.deposit_deduction_reason,
  };
  const proratedClosingTotal = calculateProratedTotalRent(snapshot);

  const spanDays = daysUsedInclusive(row.rental_start_date, row.rental_end_date);
  const nextStart = addDaysToDateString(row.rental_end_date, 1);
  const nextEnd = addDaysToDateString(nextStart, spanDays - 1);

  const storedTotalNum = Number(row.total_rent_amount ?? 0);
  const nextContractTotal =
    Number.isFinite(storedTotalNum) && storedTotalNum > 0
      ? roundTo2(storedTotalNum)
      : contractTotalForSpanFromVehicleRates(
          row.rental_type,
          spanDays,
          row.daily_rent,
          row.weekly_rent,
          row.monthly_rent,
        );

  const recurringEnabled = Boolean(row.is_recurring);
  const resolvedInterval = normalizePositiveInt(row.auto_renew_interval ?? undefined, 7);
  const intervalForInsert = resolvedInterval ?? 7;
  const resolvedMaxRenewalDate = row.max_renewal_date ? normalizeDateInput(row.max_renewal_date) : null;

  await client.query(
    `
    UPDATE vehicle_rentals
    SET
      status = 'completed',
      rental_end_date = $2::date,
      total_rent_amount = $3::numeric,
      updated_at = NOW()
    WHERE id = $1::uuid AND organization_id = $4::uuid
    `,
    [rentalId, completionDate, proratedClosingTotal, orgId],
  );

  await client.query(
    `
    UPDATE vehicles
    SET status = 'available', current_driver_id = NULL, updated_at = NOW()
    WHERE id = $1::uuid AND organization_id = $2::uuid
    `,
    [row.vehicle_id, orgId],
  );

  await client.query(
    `
    UPDATE drivers
    SET current_vehicle_id = NULL, updated_at = NOW()
    WHERE id = $1::uuid AND organization_id = $2::uuid
    `,
    [row.driver_id, orgId],
  );

  const continuationNote = `Continued from rental ${row.id}`;
  const mergedNotes = [row.notes?.trim() ?? "", continuationNote].filter(Boolean).join(" | ") || continuationNote;

  await client.query(
    `
    INSERT INTO vehicle_rentals (
      vehicle_id, driver_id, organization_id, rental_start_date, rental_end_date,
      rental_type, total_rent_amount,
      deposit_amount, deposit_status, deposit_paid_at, deposit_refunded_at, deposit_deduction_amount, deposit_deduction_reason,
      payment_status, payment_date, payment_method, payment_reference, rent_paid_amount,
      status, notes, created_by, is_recurring, auto_renew_interval, max_renewal_date
    )
    VALUES (
      $1, $2, $3, $4::date, $5::date,
      COALESCE($6, 'daily'),
      $7,
      0, NULL, NULL, NULL, 0, NULL,
      'pending', NULL, NULL, NULL, 0,
      'active', $8, $9, $10, $11, $12
    )
    `,
    [
      row.vehicle_id,
      row.driver_id,
      orgId,
      nextStart,
      nextEnd,
      row.rental_type ?? null,
      nextContractTotal,
      mergedNotes,
      userId ?? null,
      recurringEnabled,
      intervalForInsert,
      resolvedMaxRenewalDate,
    ],
  );

  await client.query(
    `
    UPDATE vehicles
    SET status = 'rented', current_driver_id = $1::uuid, updated_at = NOW()
    WHERE id = $2::uuid AND organization_id = $3::uuid
    `,
    [row.driver_id, row.vehicle_id, orgId],
  );

  await client.query(
    `
    UPDATE drivers
    SET current_vehicle_id = $1::uuid, updated_at = NOW()
    WHERE id = $2::uuid AND organization_id = $3::uuid
    `,
    [row.vehicle_id, row.driver_id, orgId],
  );

  await logDriverActivity(row.driver_id, "vehicle_rental_roll_forward", {
    description: `Rental rolled forward to ${nextStart}–${nextEnd}`,
    performedBy: userId ?? undefined,
    newValues: {
      prior_rental_id: row.id,
      vehicle_id: row.vehicle_id,
      next_start: nextStart,
      next_end: nextEnd,
    },
  });
}

router.post("/rentals/bulk-next-week", requireRole("admin", "accountant"), async (req, res) => {
  const orgId = req.user?.orgId;
  const userId = req.user?.sub;
  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }

  const body = req.body as { rental_ids?: unknown };
  const rawIds = Array.isArray(body.rental_ids) ? body.rental_ids : [];
  const rentalIds = [...new Set(rawIds.filter((x): x is string => typeof x === "string" && UUID_RE.test(x)))];
  if (!rentalIds.length) {
    return res.status(400).json({ message: "rental_ids must be a non-empty array of UUIDs" });
  }

  let created = 0;
  const failed: { rentalId: string; message: string }[] = [];

  for (const rid of rentalIds) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await rolloverRentalToNextWeek(client, orgId, rid, userId);
      await client.query("COMMIT");
      created += 1;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      const msg = err instanceof Error ? err.message : "Rollover failed";
      failed.push({ rentalId: rid, message: msg });
      console.error("Bulk next-week rental error", rid, err);
    } finally {
      client.release();
    }
  }

  return res.json({ created, failed });
});

// --- Complete overdue rental (auto-refund deposit)
router.post("/rentals/:rentalId/complete", requireRole("admin", "accountant"), async (req, res) => {
  const orgId = req.user?.orgId;
  const userId = req.user?.sub;
  const { rentalId } = req.params;
  const {
    deductionAmount,
    deductionReason,
    completionDate,
  } = req.body as { deductionAmount?: number; deductionReason?: string; completionDate?: string };
  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }
  const resolvedCompletionDate = completionDate ? normalizeDateInput(completionDate) : new Date().toISOString().split("T")[0];
  if (!resolvedCompletionDate) {
    return res.status(400).json({ message: "completionDate must be in YYYY-MM-DD format" });
  }
  try {
    const { rows } = await query<RentalDepositSnapshot>(
      `
      SELECT
        r.id,
        r.vehicle_id,
        r.driver_id,
        r.organization_id,
        r.rental_start_date::text,
        r.rental_type,
        $3::text AS completion_date,
        v.daily_rent::text,
        v.weekly_rent::text,
        v.monthly_rent::text,
        r.deposit_amount::text,
        r.deposit_status,
        r.deposit_deduction_amount::text,
        r.deposit_deduction_reason
      FROM vehicle_rentals r
      JOIN vehicles v ON r.vehicle_id = v.id
      WHERE r.id = $1 AND r.organization_id = $2 AND r.status = 'active'
      LIMIT 1
      `,
      [rentalId, orgId, resolvedCompletionDate],
    );
    const rental = rows[0];
    if (!rental) {
      return res.status(404).json({ message: "Active rental not found" });
    }
    await completeRentalWithDepositRefund(rental, userId, {
      deductionAmount,
      deductionReason,
      completionDate: resolvedCompletionDate,
    });
    const { rows: updatedRows } = await query("SELECT * FROM vehicle_rentals WHERE id = $1 LIMIT 1", [rentalId]);
    return res.json(updatedRows[0]);
  } catch (err) {
    console.error("Complete overdue rental error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// --- Extend rental period
router.post("/rentals/:rentalId/extend", requireRole("admin", "accountant"), async (req, res) => {
  const orgId = req.user?.orgId;
  const { rentalId } = req.params;
  const { newEndDate } = req.body as { newEndDate?: string };
  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }
  if (!newEndDate) {
    return res.status(400).json({ message: "newEndDate is required" });
  }
  try {
    const { rows } = await query(
      `
      UPDATE vehicle_rentals
      SET rental_end_date = $1, updated_at = NOW()
      WHERE id = $2 AND organization_id = $3 AND status = 'active'
      RETURNING *
      `,
      [newEndDate, rentalId, orgId],
    );
    if (!rows[0]) {
      return res.status(404).json({ message: "Active rental not found" });
    }
    return res.json(rows[0]);
  } catch (err) {
    console.error("Extend rental error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// --- Bulk complete overdue rentals
router.post("/rentals/overdue/bulk-complete", requireRole("admin", "accountant"), async (req, res) => {
  const orgId = req.user?.orgId;
  const userId = req.user?.sub;
  const { rentalIds, completionDate, items } = req.body as {
    rentalIds?: string[];
    completionDate?: string;
    items?: BulkOverdueCompletionItem[];
  };
  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }
  const resolvedItems: BulkOverdueCompletionItem[] =
    Array.isArray(items) && items.length > 0
      ? items
      : Array.isArray(rentalIds)
        ? rentalIds.map((id) => ({
            rentalId: id,
            completionDate,
            deductionAmount: undefined,
            deductionReason: undefined,
          }))
        : [];
  if (!Array.isArray(resolvedItems) || resolvedItems.length === 0) {
    return res.status(400).json({ message: "rentalIds must be a non-empty array" });
  }
  const resolvedCompletionDate = completionDate ? normalizeDateInput(completionDate) : new Date().toISOString().split("T")[0];
  if (!resolvedCompletionDate) {
    return res.status(400).json({ message: "completionDate must be in YYYY-MM-DD format" });
  }
  try {
    let completed = 0;
    let processed = 0;
    let rentPaymentsRecorded = 0;
    const failed: { rentalId: string; message: string }[] = [];
    const seen = new Set<string>();
    for (const item of resolvedItems) {
      const rentalId = item.rentalId;
      if (!rentalId || seen.has(rentalId)) {
        if (rentalId) failed.push({ rentalId, message: "Duplicate rentalId in request" });
        continue;
      }
      seen.add(rentalId);
      processed += 1;
      const itemCompletionDate = item.completionDate ? normalizeDateInput(item.completionDate) : resolvedCompletionDate;
      if (!itemCompletionDate) {
        failed.push({ rentalId, message: "completionDate must be in YYYY-MM-DD format" });
        continue;
      }
      try {
        const { rows } = await query<RentalDepositSnapshot>(
          `
          SELECT
            r.id,
            r.vehicle_id,
            r.driver_id,
            r.organization_id,
            r.rental_start_date::text,
            r.rental_type,
            $3::text AS completion_date,
            v.daily_rent::text,
            v.weekly_rent::text,
            v.monthly_rent::text,
            r.deposit_amount::text,
            r.deposit_status,
            r.deposit_deduction_amount::text,
            r.deposit_deduction_reason
          FROM vehicle_rentals r
          JOIN vehicles v ON r.vehicle_id = v.id
          WHERE r.id = $1 AND r.organization_id = $2 AND r.status = 'active' AND CURRENT_DATE > r.rental_end_date
          LIMIT 1
          `,
          [rentalId, orgId, itemCompletionDate],
        );
        const rental = rows[0];
        if (!rental) {
          failed.push({ rentalId, message: "Overdue active rental not found" });
          continue;
        }
        await completeRentalWithDepositRefund(rental, userId, {
          completionDate: itemCompletionDate,
          deductionAmount: item.deductionAmount,
          deductionReason: item.deductionReason,
        });
        const { rows: completedRows } = await query<{
          id: string;
          driver_id: string;
          total_rent_amount: string | null;
          rent_paid_amount: string | null;
        }>(
          `
          SELECT id::text, driver_id::text, total_rent_amount::text, rent_paid_amount::text
          FROM vehicle_rentals
          WHERE id = $1 AND organization_id = $2
          LIMIT 1
          `,
          [rentalId, orgId],
        );
        const completedRental = completedRows[0];
        if (completedRental) {
          const totalRent = Number(completedRental.total_rent_amount ?? 0) || 0;
          const alreadyPaid = Number(completedRental.rent_paid_amount ?? 0) || 0;
          const remainingDue = Math.max(0, Math.round((totalRent - alreadyPaid + Number.EPSILON) * 100) / 100);
          if (remainingDue > 0) {
            const { rows: payoutRows } = await query<{ id: string }>(
              `
              SELECT id::text
              FROM driver_payouts
              WHERE organization_id = $1
                AND driver_id = $2
                AND payment_status = 'paid'
                AND payment_period_start <= $3::date
                AND payment_period_end >= $3::date
              ORDER BY payment_period_end DESC, created_at DESC
              LIMIT 1
              `,
              [orgId, completedRental.driver_id, itemCompletionDate],
            );
            const payout = payoutRows[0];
            if (payout) {
              const ins = await query<{ amount: string }>(
                `
                INSERT INTO rent_payments (
                  organization_id, vehicle_rental_id, driver_payout_id, amount, payment_method, paid_at
                )
                VALUES ($1, $2, $3, $4, 'payroll_deduction', COALESCE($5::timestamp, NOW()))
                ON CONFLICT (driver_payout_id, vehicle_rental_id) DO NOTHING
                RETURNING amount::text
                `,
                [orgId, rentalId, payout.id, remainingDue, itemCompletionDate],
              );
              if (ins.rows.length > 0) {
                const delta = Number(ins.rows[0].amount ?? 0) || 0;
                await query(
                  `
                  UPDATE vehicle_rentals
                  SET
                    rent_paid_amount = ROUND((COALESCE(rent_paid_amount, 0) + $1)::numeric, 2),
                    payment_status = CASE
                      WHEN total_rent_amount IS NULL OR total_rent_amount = 0 THEN payment_status
                      WHEN (COALESCE(rent_paid_amount, 0) + $1) >= total_rent_amount THEN 'paid'
                      WHEN (COALESCE(rent_paid_amount, 0) + $1) > 0 THEN 'partial'
                      ELSE payment_status
                    END,
                    payment_date = COALESCE(payment_date, $2::date),
                    updated_at = NOW()
                  WHERE id = $3 AND organization_id = $4
                  `,
                  [delta, itemCompletionDate, rentalId, orgId],
                );
                rentPaymentsRecorded += 1;
              }
            }
          }
        }
        completed += 1;
      } catch {
        failed.push({ rentalId, message: "Failed to complete rental" });
      }
    }
    return res.json({
      completed,
      failed,
      processed,
      rentalsTouched: completed,
      rentPaymentsRecorded,
    });
  } catch (err) {
    console.error("Bulk complete overdue rentals error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// --- Transactional bulk complete rentals (new contract)
router.post("/rentals/bulk-complete", requireRole("admin", "accountant"), async (req, res) => {
  const orgId = req.user?.orgId;
  const {
    rental_ids: rentalIds,
    completion_date: completionDate,
    reason,
  } = req.body as {
    rental_ids?: string[];
    completion_date?: string;
    reason?: string;
  };

  if (!orgId) {
    return res.status(400).json({ success: false, message: "User is not associated with an organization" });
  }
  if (!Array.isArray(rentalIds) || rentalIds.length === 0) {
    return res.status(400).json({ success: false, message: "rental_ids must be a non-empty array" });
  }
  const uniqueIds = [...new Set(rentalIds.filter(Boolean))];
  if (uniqueIds.length !== rentalIds.length) {
    return res.status(400).json({ success: false, message: "rental_ids must not contain duplicates" });
  }

  const resolvedCompletionDate = completionDate ? normalizeDateInput(completionDate) : new Date().toISOString().split("T")[0];
  if (!resolvedCompletionDate) {
    return res.status(400).json({ success: false, message: "completion_date must be in YYYY-MM-DD format" });
  }
  const reasonText = typeof reason === "string" ? reason.trim() : "";

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: rentals } = await client.query<{
      id: string;
      driver_id: string;
      vehicle_id: string;
      status: string;
      rental_start_date: string;
      rental_type: "daily" | "weekly" | "monthly" | null;
      total_rent_amount: string | null;
      rent_paid_amount: string | null;
      notes: string | null;
      daily_rent: string | null;
      weekly_rent: string | null;
      monthly_rent: string | null;
    }>(
      `
      SELECT
        r.id::text,
        r.driver_id::text,
        r.vehicle_id::text,
        r.status,
        r.rental_start_date::text,
        r.rental_type,
        r.total_rent_amount::text,
        r.rent_paid_amount::text,
        r.notes,
        v.daily_rent::text,
        v.weekly_rent::text,
        v.monthly_rent::text
      FROM vehicle_rentals r
      JOIN vehicles v ON v.id = r.vehicle_id
      WHERE r.organization_id = $1 AND r.id = ANY($2::uuid[])
      FOR UPDATE
      `,
      [orgId, uniqueIds],
    );

    if (rentals.length !== uniqueIds.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "One or more rentals were not found" });
    }
    const notActive = rentals.find((r) => r.status !== "active");
    if (notActive) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: `Rental ${notActive.id} is not active` });
    }

    let rentPaymentsCreated = 0;
    const updatedRentals: Record<string, unknown>[] = [];

    for (const rental of rentals) {
      const days = daysUsedInclusive(rental.rental_start_date, resolvedCompletionDate);
      const type = rental.rental_type ?? "daily";
      const dailyRate = Number(rental.daily_rent ?? 0) || 0;
      const weeklyRate = Number(rental.weekly_rent ?? 0) || 0;
      const monthlyRate = Number(rental.monthly_rent ?? 0) || 0;
      const proratedTotal =
        type === "weekly"
          ? roundTo2((weeklyRate / 7) * days)
          : type === "monthly"
            ? roundTo2((monthlyRate / 30) * days)
            : roundTo2(dailyRate * days);

      const nextNotes = [rental.notes?.trim() ?? "", reasonText].filter(Boolean).join(" | ") || null;
      const updateRes = await client.query<Record<string, unknown>>(
        `
        UPDATE vehicle_rentals
        SET
          status = 'completed',
          rental_end_date = $1,
          total_rent_amount = $2,
          notes = $3,
          updated_at = NOW()
        WHERE id = $4 AND organization_id = $5
        RETURNING *
        `,
        [resolvedCompletionDate, proratedTotal, nextNotes, rental.id, orgId],
      );

      await client.query(
        "UPDATE vehicles SET status = 'available', current_driver_id = NULL, updated_at = NOW() WHERE id = $1 AND organization_id = $2",
        [rental.vehicle_id, orgId],
      );
      await client.query(
        "UPDATE drivers SET current_vehicle_id = NULL, updated_at = NOW() WHERE id = $1 AND organization_id = $2",
        [rental.driver_id, orgId],
      );

      const alreadyPaid = Number(rental.rent_paid_amount ?? 0) || 0;
      const remainingDue = Math.max(0, roundTo2(proratedTotal - alreadyPaid));
      if (remainingDue > 0) {
        const { rows: payoutRows } = await client.query<{ id: string }>(
          `
          SELECT id::text
          FROM driver_payouts
          WHERE organization_id = $1
            AND driver_id = $2
            AND payment_status = 'paid'
            AND payment_period_start <= $3::date
            AND payment_period_end >= $3::date
          ORDER BY payment_period_end DESC, created_at DESC
          LIMIT 1
          `,
          [orgId, rental.driver_id, resolvedCompletionDate],
        );
        const payout = payoutRows[0];
        if (payout) {
          const ins = await client.query<{ amount: string }>(
            `
            INSERT INTO rent_payments (
              organization_id, vehicle_rental_id, driver_payout_id, amount, payment_method, paid_at
            )
            VALUES ($1, $2, $3, $4, 'payroll_deduction', COALESCE($5::timestamp, NOW()))
            ON CONFLICT (driver_payout_id, vehicle_rental_id) DO NOTHING
            RETURNING amount::text
            `,
            [orgId, rental.id, payout.id, remainingDue, resolvedCompletionDate],
          );
          if (ins.rows.length > 0) {
            const delta = Number(ins.rows[0].amount ?? 0) || 0;
            await client.query(
              `
              UPDATE vehicle_rentals
              SET
                rent_paid_amount = ROUND((COALESCE(rent_paid_amount, 0) + $1)::numeric, 2),
                payment_status = CASE
                  WHEN total_rent_amount IS NULL OR total_rent_amount = 0 THEN payment_status
                  WHEN (COALESCE(rent_paid_amount, 0) + $1) >= total_rent_amount THEN 'paid'
                  WHEN (COALESCE(rent_paid_amount, 0) + $1) > 0 THEN 'partial'
                  ELSE payment_status
                END,
                payment_date = COALESCE(payment_date, $2::date),
                updated_at = NOW()
              WHERE id = $3 AND organization_id = $4
              `,
              [delta, resolvedCompletionDate, rental.id, orgId],
            );
            rentPaymentsCreated += 1;
          }
        }
      }

      const { rows: finalRows } = await client.query<Record<string, unknown>>(
        "SELECT * FROM vehicle_rentals WHERE id = $1 AND organization_id = $2 LIMIT 1",
        [rental.id, orgId],
      );
      if (finalRows[0]) updatedRentals.push(finalRows[0]);
      else if (updateRes.rows[0]) updatedRentals.push(updateRes.rows[0]);
    }

    await client.query("COMMIT");
    return res.json({
      success: true,
      count: updatedRentals.length,
      rentals: updatedRentals,
      rentPaymentsCreated,
    });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback errors
    }
    console.error("Bulk complete rentals error", err);
    return res.status(500).json({ success: false, message: "Bulk completion failed" });
  } finally {
    client.release();
  }
});

// --- Vehicle by id
router.get("/:id", async (req, res) => {
  const orgId = req.user?.orgId;
  const { id } = req.params;
  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }

  try {
    const { rows } = await query(
      `
      SELECT v.*, d.first_name AS driver_first_name, d.last_name AS driver_last_name
      FROM vehicles v
      LEFT JOIN drivers d ON v.current_driver_id = d.id
      WHERE v.id = $1 AND v.organization_id = $2
      LIMIT 1
      `,
      [id, orgId],
    );
    const vehicle = rows[0];
    if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });
    return res.json(vehicle);
  } catch (err) {
    console.error("Get vehicle error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// --- Create vehicle
router.post("/", requireRole("admin", "accountant"), async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }

  const body = req.body as Record<string, unknown>;
  const {
    vehicleType,
    make,
    model,
    year,
    color,
    licensePlate,
    vin,
    fuelType,
    transmission,
    seatingCapacity,
    dailyRent,
    weeklyRent,
    monthlyRent,
    insuranceExpiry,
    registrationExpiry,
    status,
    notes,
  } = body;

  if (!vehicleType || !make || !model || !licensePlate) {
    return res.status(400).json({
      message: "vehicleType, make, model and licensePlate are required",
    });
  }

  try {
    const { rows: existing } = await query<{ id: string }>(
      "SELECT id FROM vehicles WHERE organization_id = $1 AND license_plate = $2 LIMIT 1",
      [orgId, String(licensePlate).trim()],
    );
    if (existing[0]) {
      return res.status(409).json({ message: "A vehicle with this license plate already exists" });
    }

    const { rows } = await query(
      `
      INSERT INTO vehicles (
        organization_id, vehicle_type, make, model, year, color, license_plate, vin,
        fuel_type, transmission, seating_capacity, daily_rent, weekly_rent, monthly_rent,
        insurance_expiry, registration_expiry, status, notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, COALESCE($17, 'available'), $18)
      RETURNING *
      `,
      [
        orgId,
        vehicleType,
        make,
        model,
        year ?? null,
        color ?? null,
        String(licensePlate).trim(),
        vin ?? null,
        fuelType ?? null,
        transmission ?? null,
        seatingCapacity ?? null,
        dailyRent ?? 0,
        weeklyRent ?? 0,
        monthlyRent ?? 0,
        insuranceExpiry ?? null,
        registrationExpiry ?? null,
        status ?? null,
        notes ?? null,
      ],
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error("Create vehicle error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// --- Update vehicle
router.put("/:id", requireRole("admin", "accountant"), async (req, res) => {
  const orgId = req.user?.orgId;
  const { id } = req.params;
  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }

  const body = req.body as Record<string, unknown>;
  const {
    vehicleType,
    make,
    model,
    year,
    color,
    licensePlate,
    vin,
    fuelType,
    transmission,
    seatingCapacity,
    dailyRent,
    weeklyRent,
    monthlyRent,
    insuranceExpiry,
    registrationExpiry,
    status,
    currentDriverId,
    notes,
  } = body;

  if (licensePlate) {
    const { rows: existing } = await query<{ id: string }>(
      "SELECT id FROM vehicles WHERE organization_id = $1 AND license_plate = $2 AND id != $3 LIMIT 1",
      [orgId, String(licensePlate).trim(), id],
    );
    if (existing[0]) {
      return res.status(409).json({ message: "A vehicle with this license plate already exists" });
    }
  }

  try {
    const { rows } = await query(
      `
      UPDATE vehicles
      SET
        vehicle_type = COALESCE($1, vehicle_type),
        make = COALESCE($2, make),
        model = COALESCE($3, model),
        year = $4,
        color = $5,
        license_plate = COALESCE($6, license_plate),
        vin = $7,
        fuel_type = $8,
        transmission = $9,
        seating_capacity = $10,
        daily_rent = COALESCE($11, daily_rent),
        weekly_rent = COALESCE($12, weekly_rent),
        monthly_rent = COALESCE($13, monthly_rent),
        insurance_expiry = $14,
        registration_expiry = $15,
        status = COALESCE($16, status),
        current_driver_id = $17,
        notes = $18,
        updated_at = NOW()
      WHERE id = $19 AND organization_id = $20
      RETURNING *
      `,
      [
        vehicleType ?? null,
        make ?? null,
        model ?? null,
        year ?? null,
        color ?? null,
        licensePlate ?? null,
        vin ?? null,
        fuelType ?? null,
        transmission ?? null,
        seatingCapacity ?? null,
        dailyRent ?? null,
        weeklyRent ?? null,
        monthlyRent ?? null,
        insuranceExpiry ?? null,
        registrationExpiry ?? null,
        status ?? null,
        currentDriverId ?? null,
        notes ?? null,
        id,
        orgId,
      ],
    );
    const vehicle = rows[0];
    if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });

    // Keep drivers.current_vehicle_id in sync when currentDriverId is changed via Edit Vehicle page
    if (typeof currentDriverId !== "undefined") {
      // Clear any existing driver link to this vehicle in the same organization
      await query(
        "UPDATE drivers SET current_vehicle_id = NULL, updated_at = NOW() WHERE current_vehicle_id = $1 AND organization_id = $2",
        [id, orgId],
      );

      // If a new currentDriverId is provided (not null), link that driver to this vehicle
      if (currentDriverId) {
        await query(
          "UPDATE drivers SET current_vehicle_id = $1, updated_at = NOW() WHERE id = $2 AND organization_id = $3",
          [id, currentDriverId, orgId],
        );
      }
    }

    return res.json(vehicle);
  } catch (err) {
    console.error("Update vehicle error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// --- Delete vehicle
router.delete("/:id", requireRole("admin", "accountant"), async (req, res) => {
  const orgId = req.user?.orgId;
  const { id } = req.params;
  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }

  try {
    const { rows } = await query(
      "DELETE FROM vehicles WHERE id = $1 AND organization_id = $2 RETURNING id",
      [id, orgId],
    );
    if (!rows[0]) return res.status(404).json({ message: "Vehicle not found" });
    return res.json({ id: rows[0].id });
  } catch (err) {
    console.error("Delete vehicle error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// --- Rentals for a vehicle
router.get("/:id/rentals", async (req, res) => {
  const orgId = req.user?.orgId;
  const { id } = req.params;
  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }

  try {
    const { rows } = await query(
      `
      SELECT r.*, d.first_name AS driver_first_name, d.last_name AS driver_last_name
      FROM vehicle_rentals r
      JOIN drivers d ON r.driver_id = d.id
      WHERE r.vehicle_id = $1 AND r.organization_id = $2
      ORDER BY r.rental_start_date DESC
      `,
      [id, orgId],
    );
    return res.json(rows);
  } catch (err) {
    console.error("List vehicle rentals error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// --- Create rental
router.post("/:id/rentals", requireRole("admin", "accountant"), async (req, res) => {
  const orgId = req.user?.orgId;
  const userId = req.user?.sub;
  const { id: vehicleId } = req.params;
  const body = req.body as Record<string, unknown>;
  const {
    driverId,
    rentalStartDate,
    rentalEndDate,
    rentalType,
    totalRentAmount,
    depositAmount,
    paymentStatus,
    paymentDate,
    paymentMethod,
    paymentReference,
    status,
    notes,
    isRecurring,
    autoRenewInterval,
    maxRenewalDate,
  } = body;

  if (!driverId || !rentalStartDate || !rentalEndDate) {
    return res.status(400).json({
      message: "driverId, rentalStartDate and rentalEndDate are required",
    });
  }
  const recurringEnabled = Boolean(isRecurring);
  const resolvedInterval = normalizePositiveInt(autoRenewInterval, 7);
  if (resolvedInterval === null) {
    return res.status(400).json({ message: "autoRenewInterval must be a positive integer" });
  }
  const resolvedMaxRenewalDate = maxRenewalDate ? normalizeDateInput(String(maxRenewalDate)) : null;
  if (maxRenewalDate && !resolvedMaxRenewalDate) {
    return res.status(400).json({ message: "maxRenewalDate must be in YYYY-MM-DD format" });
  }
  if (resolvedMaxRenewalDate && String(rentalStartDate) > resolvedMaxRenewalDate) {
    return res.status(400).json({ message: "maxRenewalDate must be on or after rentalStartDate" });
  }

  const client = await pool.connect();
  try {
    // Validate vehicle and driver using shared query helper (outside transaction is okay for read-only checks)
    const { rows: vehicleRows } = await query<{ id: string; status: string; daily_rent: string; weekly_rent: string; monthly_rent: string }>(
      "SELECT id, status, daily_rent, weekly_rent, monthly_rent FROM vehicles WHERE id = $1 AND organization_id = $2 LIMIT 1",
      [vehicleId, orgId],
    );
    if (!vehicleRows[0]) {
      client.release();
      return res.status(404).json({ message: "Vehicle not found" });
    }
    if (vehicleRows[0].status === "rented") {
      client.release();
      return res.status(400).json({ message: "Vehicle is already rented" });
    }

    const { rows: driverRows } = await query<{ id: string }>(
      "SELECT id FROM drivers WHERE id = $1 AND organization_id = $2 AND (is_deleted = false OR is_deleted IS NULL) LIMIT 1",
      [driverId, orgId],
    );
    if (!driverRows[0]) {
      client.release();
      return res.status(404).json({ message: "Driver not found" });
    }

    // Resolve requested deposit amount from payload only.
    // If not provided (or invalid), rental is treated as "no deposit required".
    const vehicle = vehicleRows[0];
    let resolvedDepositAmount = 0;
    const hasExplicitDepositAmount = typeof depositAmount === "number";
    const rentalRateType = (rentalType as string | undefined) ?? "daily";
    let fallbackRateAmount = Number(vehicle.daily_rent ?? 0) || 0;
    if (rentalRateType === "weekly") {
      fallbackRateAmount = Number(vehicle.weekly_rent ?? 0) || 0;
    } else if (rentalRateType === "monthly") {
      fallbackRateAmount = Number(vehicle.monthly_rent ?? 0) || 0;
    }

    if (hasExplicitDepositAmount) {
      resolvedDepositAmount = Number.isFinite(Number(depositAmount)) ? Number(depositAmount) : 0;
    }
    if (!Number.isFinite(resolvedDepositAmount) || resolvedDepositAmount < 0) {
      resolvedDepositAmount = 0;
    }
    const noDepositRequested = !hasExplicitDepositAmount || resolvedDepositAmount === 0;

    const { rows: activeRentalRows } = await query<{ id: string }>(
      `
      SELECT id
      FROM vehicle_rentals
      WHERE driver_id = $1 AND organization_id = $2 AND status = 'active'
      LIMIT 1
      `,
      [driverId, orgId],
    );

    const { rows: latestCompletedRentalRows } = await query<{
      id: string;
      deposit_status: "pending" | "paid" | "refunded" | "partial" | null;
      deposit_amount: string | null;
      deposit_deduction_amount: string | null;
      notes: string | null;
    }>(
      `
      SELECT id, deposit_status, deposit_amount::text, deposit_deduction_amount::text, notes
      FROM vehicle_rentals
      WHERE driver_id = $1 AND organization_id = $2 AND status = 'completed'
      ORDER BY rental_end_date DESC NULLS LAST, created_at DESC
      LIMIT 1
      `,
      [driverId, orgId],
    );

    const hasActiveRental = Boolean(activeRentalRows[0]);
    const latestCompletedRental = latestCompletedRentalRows[0];
    const latestDepositAmount = Number(latestCompletedRental?.deposit_amount ?? 0) || 0;
    const latestDeductionAmount = Number(latestCompletedRental?.deposit_deduction_amount ?? 0) || 0;
    const latestRemainingCredit = Math.max(0, latestDepositAmount - latestDeductionAmount);
    const hasUnrefundedLatestCredit =
      latestCompletedRental &&
      (latestCompletedRental.deposit_status === "paid" || latestCompletedRental.deposit_status === "partial") &&
      latestRemainingCredit > 0;
    const canConsumeDepositCredit = Boolean(!noDepositRequested && !hasActiveRental && hasUnrefundedLatestCredit);

    const finalDepositAmount = canConsumeDepositCredit ? 0 : resolvedDepositAmount;
    const initialDepositStatus = finalDepositAmount > 0 ? "pending" : null;
    const initialDepositPaidAt = null;
    const creditAuditNote = canConsumeDepositCredit
      ? `Deposit credit consumed from rental ${latestCompletedRental?.id} (RON ${latestRemainingCredit.toFixed(2)})`
      : null;

    const resolvedNotes = [
      typeof notes === "string" ? notes.trim() : "",
      creditAuditNote ?? "",
    ]
      .filter(Boolean)
      .join(" | ");

    await client.query("BEGIN");

    const insertResult = await client.query(
      `
      INSERT INTO vehicle_rentals (
        vehicle_id, driver_id, organization_id, rental_start_date, rental_end_date,
        rental_type, total_rent_amount,
        deposit_amount, deposit_status, deposit_paid_at, deposit_refunded_at, deposit_deduction_amount, deposit_deduction_reason,
        payment_status, payment_date, payment_method, payment_reference,
        status, notes, created_by, is_recurring, auto_renew_interval, max_renewal_date
      )
      VALUES (
        $1, $2, $3, $4, $5,
        COALESCE($6, 'daily'),
        $7,
        $8, $9, $10, $11, $12, $13,
        COALESCE($14, 'pending'), $15, $16, $17,
        COALESCE($18, 'active'),
        $19, $20, $21, $22, $23
      )
      RETURNING *
      `,
      [
        vehicleId,
        driverId,
        orgId,
        rentalStartDate,
        rentalEndDate,
        rentalType ?? null,
        totalRentAmount ?? null,
        finalDepositAmount,
        initialDepositStatus,
        initialDepositPaidAt,
        null,
        0,
        null,
        paymentStatus ?? null,
        paymentDate ?? null,
        paymentMethod ?? null,
        paymentReference ?? null,
        status ?? null,
        resolvedNotes || null,
        userId ?? null,
        recurringEnabled,
        resolvedInterval,
        resolvedMaxRenewalDate,
      ],
    );

    if (canConsumeDepositCredit && latestCompletedRental) {
      const sourceCreditNote = [
        latestCompletedRental.notes?.trim() ?? "",
        `Deposit credit consumed by rental ${(insertResult.rows[0] as { id: string }).id} (RON ${latestRemainingCredit.toFixed(2)})`,
      ]
        .filter(Boolean)
        .join(" | ");
      await client.query(
        `
        UPDATE vehicle_rentals
        SET deposit_status = 'refunded', deposit_refunded_at = COALESCE(deposit_refunded_at, NOW()), notes = $1, updated_at = NOW()
        WHERE id = $2 AND organization_id = $3
        `,
        [sourceCreditNote, latestCompletedRental.id, orgId],
      );
    }

    const updateVehicleResult = await client.query(
      "UPDATE vehicles SET status = 'rented', current_driver_id = $1, updated_at = NOW() WHERE id = $2 AND organization_id = $3",
      [driverId, vehicleId, orgId],
    );
    if (updateVehicleResult.rowCount === 0) {
      await client.query("ROLLBACK");
      client.release();
      return res.status(404).json({ message: "Vehicle not found for this organization" });
    }

    const updateDriverResult = await client.query(
      "UPDATE drivers SET current_vehicle_id = $1, updated_at = NOW() WHERE id = $2 AND organization_id = $3",
      [vehicleId, driverId, orgId],
    );
    if (updateDriverResult.rowCount === 0) {
      await client.query("ROLLBACK");
      client.release();
      return res.status(404).json({ message: "Driver not found for this organization" });
    }

    // Log deposit state for the driver when deposit is required/credit-consumed/no-deposit
    const createdRental = insertResult.rows[0] as { id: string };
    if (canConsumeDepositCredit && latestCompletedRental) {
      await logDriverActivity(String(driverId), "deposit_credit_consumed", {
        description: `Deposit credit applied from rental ${latestCompletedRental.id}: RON ${latestRemainingCredit.toFixed(2)}`,
        performedBy: userId ?? undefined,
        newValues: {
          source_rental_id: latestCompletedRental.id,
          rental_id: createdRental.id,
          vehicle_id: vehicleId,
          credit_used_amount: latestRemainingCredit,
          deposit_amount: 0,
          deposit_status: null,
        },
      });
    } else if (finalDepositAmount > 0) {
      await logDriverActivity(String(driverId), "deposit_due", {
        description: `Deposit of RON ${finalDepositAmount.toFixed(2)} due for vehicle rental`,
        performedBy: userId ?? undefined,
        newValues: {
          rental_id: createdRental.id,
          vehicle_id: vehicleId,
          deposit_amount: finalDepositAmount,
        },
      });
    } else {
      const noDepositReason = noDepositRequested
        ? "No deposit requested for this rental"
        : `Deposit credit blocked (active rental exists: ${hasActiveRental}, latestStatus: ${latestCompletedRental?.deposit_status ?? "none"})`;
      await logDriverActivity(String(driverId), "deposit_not_required", {
        description: noDepositReason,
        performedBy: userId ?? undefined,
        newValues: {
          rental_id: createdRental.id,
          vehicle_id: vehicleId,
          deposit_amount: 0,
          fallback_rate_amount: fallbackRateAmount,
        },
      });
    }

    await client.query("COMMIT");
    client.release();

    return res.status(201).json(insertResult.rows[0]);
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback errors
    }
    client.release();
    console.error("Create rental error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// --- Update rental (e.g. complete, payment)
router.patch("/:vehicleId/rentals/:rentalId", requireRole("admin", "accountant"), async (req, res) => {
  const orgId = req.user?.orgId;
  const userId = req.user?.sub;
  const { vehicleId, rentalId } = req.params;
  const body = req.body as Record<string, unknown>;
  const {
    status,
    completionDate,
    paymentStatus,
    paymentDate,
    paymentMethod,
    paymentReference,
    depositStatus,
    depositPaidAt,
    depositRefundedAt,
    depositDeductionAmount,
    depositDeductionReason,
    isRecurring,
    autoRenewInterval,
    maxRenewalDate,
  } = body as {
    status?: string;
    paymentStatus?: string;
    paymentDate?: string;
    paymentMethod?: string;
    paymentReference?: string;
    depositStatus?: "pending" | "paid" | "refunded" | "partial";
    depositPaidAt?: string;
    depositRefundedAt?: string;
    depositDeductionAmount?: number;
    depositDeductionReason?: string;
    completionDate?: string;
    isRecurring?: boolean;
    autoRenewInterval?: number;
    maxRenewalDate?: string | null;
  };

  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }

  const resolvedCompletionDate = completionDate ? normalizeDateInput(completionDate) : new Date().toISOString().split("T")[0];
  if (!resolvedCompletionDate) {
    return res.status(400).json({ message: "completionDate must be in YYYY-MM-DD format" });
  }
  const resolvedInterval = normalizePositiveInt(autoRenewInterval, 7);
  if (resolvedInterval === null) {
    return res.status(400).json({ message: "autoRenewInterval must be a positive integer" });
  }
  let resolvedMaxRenewalDate: string | null | undefined;
  if (typeof maxRenewalDate === "undefined") {
    resolvedMaxRenewalDate = undefined;
  } else if (maxRenewalDate === null || maxRenewalDate === "") {
    resolvedMaxRenewalDate = null;
  } else {
    resolvedMaxRenewalDate = normalizeDateInput(String(maxRenewalDate));
    if (!resolvedMaxRenewalDate) {
      return res.status(400).json({ message: "maxRenewalDate must be in YYYY-MM-DD format" });
    }
  }

  try {
    // Load current rental for validation and deposit workflow
    const { rows: existingRows } = await query<{
      id: string;
      rental_start_date: string;
      rental_type: "daily" | "weekly" | "monthly" | null;
      completion_date: string;
      driver_id: string;
      daily_rent: string | null;
      weekly_rent: string | null;
      monthly_rent: string | null;
      deposit_amount: string;
      deposit_status: "pending" | "paid" | "refunded" | "partial" | null;
      deposit_paid_at: string | null;
      deposit_refunded_at: string | null;
      deposit_deduction_amount: string | null;
      deposit_deduction_reason: string | null;
    }>(
      `
      SELECT
        r.id,
        r.rental_start_date::text,
        r.rental_type,
        $4::text AS completion_date,
        r.driver_id,
        v.daily_rent::text,
        v.weekly_rent::text,
        v.monthly_rent::text,
        r.deposit_amount::text,
        r.deposit_status,
        r.deposit_paid_at::text,
        r.deposit_refunded_at::text,
        r.deposit_deduction_amount::text,
        r.deposit_deduction_reason
      FROM vehicle_rentals r
      JOIN vehicles v ON r.vehicle_id = v.id
      WHERE r.id = $1 AND r.vehicle_id = $2 AND r.organization_id = $3
      LIMIT 1
      `,
      [rentalId, vehicleId, orgId, resolvedCompletionDate],
    );

    const current = existingRows[0];
    if (!current) {
      return res.status(404).json({ message: "Rental not found" });
    }

    const currentDepositAmount = Number(current.deposit_amount ?? 0) || 0;
    const currentDeductionAmount = Number(current.deposit_deduction_amount ?? 0) || 0;

    let nextDepositStatus: "pending" | "paid" | "refunded" | "partial" | null | undefined = depositStatus;
    let nextDepositPaidAt: string | null | undefined = depositPaidAt ?? null;
    let nextDepositRefundedAt: string | null | undefined = depositRefundedAt ?? null;
    let nextDepositDeductionAmount: number | null | undefined =
      typeof depositDeductionAmount === "number" ? depositDeductionAmount : null;
    let nextDepositDeductionReason: string | null | undefined =
      typeof depositDeductionReason === "string" ? depositDeductionReason : null;
    const nextTotalRentAmount =
      status === "completed"
        ? calculateProratedTotalRent({
            id: current.id,
            vehicle_id: String(vehicleId),
            driver_id: current.driver_id,
            organization_id: orgId,
            rental_start_date: current.rental_start_date,
            rental_type: current.rental_type,
            completion_date: resolvedCompletionDate,
            daily_rent: current.daily_rent,
            weekly_rent: current.weekly_rent,
            monthly_rent: current.monthly_rent,
            deposit_amount: current.deposit_amount,
            deposit_status: current.deposit_status,
            deposit_deduction_amount: current.deposit_deduction_amount,
            deposit_deduction_reason: current.deposit_deduction_reason,
          })
        : null;

    // Apply simple business rules for deposit transitions
    if (depositStatus === "paid") {
      if (currentDepositAmount <= 0) {
        return res.status(400).json({ message: "Cannot mark deposit as paid when deposit amount is zero" });
      }
      if (!nextDepositPaidAt) {
        nextDepositPaidAt = new Date().toISOString();
      }
      // Keep refunded_at/deduction as-is when just marking paid
      nextDepositRefundedAt = current.deposit_refunded_at;
      nextDepositDeductionAmount = Number.isFinite(currentDeductionAmount) ? currentDeductionAmount : 0;
      nextDepositDeductionReason = current.deposit_deduction_reason;

      // Log driver activity and deposit transaction
      await query(
        `
        INSERT INTO deposit_transactions (
          rental_id, organization_id, transaction_type, amount, payment_method, payment_status, notes, created_by
        )
        VALUES ($1, $2, 'payment', $3, COALESCE($4, 'cash'), 'completed', $5, $6)
        `,
        [
          rentalId,
          orgId,
          currentDepositAmount,
          paymentMethod ?? null,
          paymentReference ?? null,
          userId ?? null,
        ],
      );

      await logDriverActivity(current.driver_id, "deposit_paid", {
        description: `Deposit of RON ${currentDepositAmount.toFixed(2)} marked as paid`,
        performedBy: userId ?? undefined,
        newValues: {
          rental_id: rentalId,
          vehicle_id: vehicleId,
          deposit_amount: currentDepositAmount,
        },
      });
    }

    if (depositStatus === "partial") {
      const requestedDeduction = typeof depositDeductionAmount === "number" ? depositDeductionAmount : 0;
      if (requestedDeduction <= 0) {
        return res.status(400).json({ message: "Deduction amount must be greater than zero" });
      }
      if (requestedDeduction > currentDepositAmount) {
        return res.status(400).json({ message: "Deduction amount cannot exceed deposit amount" });
      }
      if (!depositDeductionReason || typeof depositDeductionReason !== "string") {
        return res.status(400).json({ message: "Deduction reason is required for partial refunds" });
      }

      const finalDeduction = requestedDeduction;
      nextDepositDeductionAmount = finalDeduction;
      nextDepositDeductionReason = depositDeductionReason;
      if (!nextDepositRefundedAt) {
        nextDepositRefundedAt = new Date().toISOString();
      }

      await query(
        `
        INSERT INTO deposit_transactions (
          rental_id, organization_id, transaction_type, amount, payment_method, payment_status, notes, created_by
        )
        VALUES ($1, $2, 'deduction', $3, COALESCE($4, 'cash'), 'completed', $5, $6)
        `,
        [
          rentalId,
          orgId,
          finalDeduction,
          paymentMethod ?? null,
          depositDeductionReason,
          userId ?? null,
        ],
      );

      await logDriverActivity(current.driver_id, "deposit_deducted", {
        description: `RON ${finalDeduction.toFixed(2)} deducted from deposit`,
        performedBy: userId ?? undefined,
        newValues: {
          rental_id: rentalId,
          vehicle_id: vehicleId,
          deduction_amount: finalDeduction,
          deduction_reason: depositDeductionReason,
        },
      });
    }

    if (depositStatus === "refunded") {
      if (currentDepositAmount <= 0) {
        return res.status(400).json({ message: "No deposit to refund" });
      }
      const effectiveDeduction =
        typeof nextDepositDeductionAmount === "number"
          ? nextDepositDeductionAmount
          : Number(current.deposit_deduction_amount ?? 0) || 0;
      const refundable = Math.max(0, currentDepositAmount - effectiveDeduction);
      if (!nextDepositRefundedAt) {
        nextDepositRefundedAt = new Date().toISOString();
      }

      if (refundable > 0) {
        await query(
          `
          INSERT INTO deposit_transactions (
            rental_id, organization_id, transaction_type, amount, payment_method, payment_status, notes, created_by
          )
          VALUES ($1, $2, 'refund', $3, COALESCE($4, 'cash'), 'completed', $5, $6)
          `,
          [
            rentalId,
            orgId,
            refundable,
            paymentMethod ?? null,
            paymentReference ?? null,
            userId ?? null,
          ],
        );
      }

      await logDriverActivity(current.driver_id, "deposit_refunded", {
        description: refundable > 0 ? `Deposit refunded: RON ${refundable.toFixed(2)}` : "Deposit fully retained",
        performedBy: userId ?? undefined,
        newValues: {
          rental_id: rentalId,
          vehicle_id: vehicleId,
          refunded_amount: refundable,
          total_deposit: currentDepositAmount,
          deduction_amount: effectiveDeduction,
        },
      });
    }

    const { rows } = await query(
      `
      UPDATE vehicle_rentals
      SET
        status = COALESCE($1, status),
        payment_status = COALESCE($2, payment_status),
        payment_date = COALESCE($3, payment_date),
        payment_method = COALESCE($4, payment_method),
        payment_reference = COALESCE($5, payment_reference),
        deposit_status = COALESCE($6, deposit_status),
        deposit_paid_at = COALESCE($7, deposit_paid_at),
        deposit_refunded_at = COALESCE($8, deposit_refunded_at),
        deposit_deduction_amount = COALESCE($9, deposit_deduction_amount),
        deposit_deduction_reason = COALESCE($10, deposit_deduction_reason),
        total_rent_amount = COALESCE($11, total_rent_amount),
        rental_end_date = COALESCE($12, rental_end_date),
        is_recurring = CASE WHEN $13::boolean IS NULL THEN is_recurring ELSE $13::boolean END,
        auto_renew_interval = COALESCE($14, auto_renew_interval),
        max_renewal_date = CASE WHEN $15::date IS NULL AND $16::boolean THEN NULL ELSE COALESCE($15::date, max_renewal_date) END,
        updated_at = NOW()
      WHERE id = $17 AND vehicle_id = $18 AND organization_id = $19
      RETURNING *
      `,
      [
        status ?? null,
        paymentStatus ?? null,
        paymentDate ?? null,
        paymentMethod ?? null,
        paymentReference ?? null,
        nextDepositStatus ?? null,
        nextDepositPaidAt,
        nextDepositRefundedAt,
        nextDepositDeductionAmount ?? null,
        nextDepositDeductionReason ?? null,
        nextTotalRentAmount,
        status === "completed" ? resolvedCompletionDate : null,
        typeof isRecurring === "boolean" ? isRecurring : null,
        typeof autoRenewInterval === "undefined" ? null : resolvedInterval,
        resolvedMaxRenewalDate ?? null,
        typeof maxRenewalDate !== "undefined" && (maxRenewalDate === null || maxRenewalDate === ""),
        rentalId,
        vehicleId,
        orgId,
      ],
    );
    const rental = rows[0];
    if (!rental) return res.status(404).json({ message: "Rental not found" });

    if (status === "completed") {
      const driverId = (rental as { driver_id: string }).driver_id;
      await query(
        "UPDATE vehicles SET status = 'available', current_driver_id = NULL, updated_at = NOW() WHERE id = $1 AND organization_id = $2",
        [vehicleId, orgId],
      );
      await query(
        "UPDATE drivers SET current_vehicle_id = NULL, updated_at = NOW() WHERE id = $1",
        [driverId],
      );
    }

    return res.json(rental);
  } catch (err) {
    console.error("Update rental error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// --- Maintenance list for vehicle
router.get("/:id/maintenance", async (req, res) => {
  const orgId = req.user?.orgId;
  const { id } = req.params;
  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }

  try {
    const { rows: vehicleRows } = await query<{ id: string }>(
      "SELECT id FROM vehicles WHERE id = $1 AND organization_id = $2 LIMIT 1",
      [id, orgId],
    );
    if (!vehicleRows[0]) return res.status(404).json({ message: "Vehicle not found" });

    const { rows } = await query(
      "SELECT * FROM vehicle_maintenance WHERE vehicle_id = $1 ORDER BY scheduled_date DESC NULLS LAST, created_at DESC",
      [id],
    );
    return res.json(rows);
  } catch (err) {
    console.error("List vehicle maintenance error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// --- Create maintenance
router.post("/:id/maintenance", requireRole("admin", "accountant"), async (req, res) => {
  const orgId = req.user?.orgId;
  const { id: vehicleId } = req.params;
  const body = req.body as Record<string, unknown>;
  const {
    maintenanceType,
    description,
    cost,
    scheduledDate,
    completedDate,
    status,
    mechanicName,
    notes,
  } = body;

  if (!maintenanceType) {
    return res.status(400).json({ message: "maintenanceType is required" });
  }

  try {
    const { rows: vehicleRows } = await query<{ id: string }>(
      "SELECT id FROM vehicles WHERE id = $1 AND organization_id = $2 LIMIT 1",
      [vehicleId, orgId],
    );
    if (!vehicleRows[0]) return res.status(404).json({ message: "Vehicle not found" });

    const { rows } = await query(
      `
      INSERT INTO vehicle_maintenance (
        vehicle_id, maintenance_type, description, cost, scheduled_date, completed_date, status, mechanic_name, notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'pending'), $8, $9)
      RETURNING *
      `,
      [
        vehicleId,
        maintenanceType,
        description ?? null,
        cost ?? null,
        scheduledDate ?? null,
        completedDate ?? null,
        status ?? null,
        mechanicName ?? null,
        notes ?? null,
      ],
    );

    if (status === "in_progress" || status === "completed") {
      await query(
        "UPDATE vehicles SET status = 'maintenance', updated_at = NOW() WHERE id = $1",
        [vehicleId],
      );
    }

    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error("Create maintenance error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// --- Update maintenance
router.patch("/:vehicleId/maintenance/:maintenanceId", requireRole("admin", "accountant"), async (req, res) => {
  const orgId = req.user?.orgId;
  const { vehicleId, maintenanceId } = req.params;
  const body = req.body as Record<string, unknown>;
  const { maintenanceType, description, cost, scheduledDate, completedDate, status, mechanicName, notes } = body;

  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }

  try {
    const { rows } = await query(
      `
      UPDATE vehicle_maintenance
      SET
        maintenance_type = COALESCE($1, maintenance_type),
        description = COALESCE($2, description),
        cost = COALESCE($3, cost),
        scheduled_date = COALESCE($4, scheduled_date),
        completed_date = COALESCE($5, completed_date),
        status = COALESCE($6, status),
        mechanic_name = COALESCE($7, mechanic_name),
        notes = COALESCE($8, notes),
        updated_at = NOW()
      WHERE id = $9 AND vehicle_id = $10
      RETURNING *
      `,
      [
        maintenanceType ?? null,
        description ?? null,
        cost ?? null,
        scheduledDate ?? null,
        completedDate ?? null,
        status ?? null,
        mechanicName ?? null,
        notes ?? null,
        maintenanceId,
        vehicleId,
      ],
    );
    const maintenance = rows[0];
    if (!maintenance) return res.status(404).json({ message: "Maintenance record not found" });

    const { rows: vehicleRows } = await query<{ id: string }>(
      "SELECT id FROM vehicles WHERE id = $1 AND organization_id = $2 LIMIT 1",
      [vehicleId, orgId],
    );
    if (vehicleRows[0]) {
      const allCompleted = await query(
        "SELECT COUNT(*) AS cnt FROM vehicle_maintenance WHERE vehicle_id = $1 AND status NOT IN ('completed', 'cancelled')",
        [vehicleId],
      );
      const pending = Number((allCompleted.rows[0] as { cnt: string }).cnt) > 0;
      await query(
        "UPDATE vehicles SET status = $1, updated_at = NOW() WHERE id = $2",
        [pending ? "maintenance" : "available", vehicleId],
      );
    }

    return res.json(maintenance);
  } catch (err) {
    console.error("Update maintenance error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

export const vehicleRoutes = router;
