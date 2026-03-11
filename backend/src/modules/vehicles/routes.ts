import { Router } from "express";
import { authenticateJWT, requireRole } from "../../middleware/auth";
import { pool, query } from "../../db/pool";
import { logDriverActivity } from "../drivers/activity";

const router = Router();

router.use(authenticateJWT);

// --- Vehicles list
router.get("/", async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }

  const { status, limit, offset } = req.query as { status?: string; limit?: string; offset?: string };
  const params: unknown[] = [orgId];
  const conditions = ["v.organization_id = $1"];

  if (status) {
    params.push(status);
    conditions.push(`v.status = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limitNum = limit ? Math.min(Math.max(1, parseInt(limit, 10)), 100) : 50;
  const offsetNum = offset ? Math.max(0, parseInt(offset, 10)) : 0;
  params.push(limitNum, offsetNum);
  const limitIdx = params.length - 1;
  const offsetIdx = params.length;

  try {
    const { rows } = await query(
      `
      SELECT v.id, v.organization_id, v.vehicle_type, v.make, v.model, v.year, v.color,
             v.license_plate, v.vin, v.fuel_type, v.transmission, v.seating_capacity,
             v.daily_rent, v.weekly_rent, v.monthly_rent, v.insurance_expiry, v.registration_expiry,
             v.status, v.current_driver_id, v.notes, v.created_at, v.updated_at,
             d.first_name AS driver_first_name, d.last_name AS driver_last_name
      FROM vehicles v
      LEFT JOIN drivers d ON v.current_driver_id = d.id
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
  } = body;

  if (!driverId || !rentalStartDate || !rentalEndDate) {
    return res.status(400).json({
      message: "driverId, rentalStartDate and rentalEndDate are required",
    });
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

    // Resolve deposit amount: prefer explicit value from payload, otherwise default to 1x selected rental rate
    const vehicle = vehicleRows[0];
    let resolvedDepositAmount: number;
    if (typeof depositAmount === "number") {
      resolvedDepositAmount = Number.isFinite(depositAmount) ? Number(depositAmount) : 0;
    } else {
      const type = (rentalType as string | undefined) ?? "daily";
      if (type === "weekly") {
        resolvedDepositAmount = Number(vehicle.weekly_rent ?? 0);
      } else if (type === "monthly") {
        resolvedDepositAmount = Number(vehicle.monthly_rent ?? 0);
      } else {
        resolvedDepositAmount = Number(vehicle.daily_rent ?? 0);
      }
    }
    if (!Number.isFinite(resolvedDepositAmount) || resolvedDepositAmount < 0) {
      resolvedDepositAmount = 0;
    }

    const initialDepositStatus = resolvedDepositAmount > 0 ? "pending" : null;

    await client.query("BEGIN");

    const insertResult = await client.query(
      `
      INSERT INTO vehicle_rentals (
        vehicle_id, driver_id, organization_id, rental_start_date, rental_end_date,
        rental_type, total_rent_amount,
        deposit_amount, deposit_status, deposit_paid_at, deposit_refunded_at, deposit_deduction_amount, deposit_deduction_reason,
        payment_status, payment_date, payment_method, payment_reference,
        status, notes, created_by
      )
      VALUES (
        $1, $2, $3, $4, $5,
        COALESCE($6, 'daily'),
        $7,
        $8, $9, $10, $11, $12, $13,
        COALESCE($14, 'pending'), $15, $16, $17,
        COALESCE($18, 'active'),
        $19,
        $20
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
        resolvedDepositAmount,
        initialDepositStatus,
        null,
        null,
        0,
        null,
        paymentStatus ?? null,
        paymentDate ?? null,
        paymentMethod ?? null,
        paymentReference ?? null,
        status ?? null,
        notes ?? null,
        userId ?? null,
      ],
    );

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

    // Log deposit due activity for the driver when a deposit is required
    const createdRental = insertResult.rows[0] as { id: string };
    if (resolvedDepositAmount > 0) {
      await logDriverActivity(String(driverId), "deposit_due", {
        description: `Deposit of RON ${resolvedDepositAmount.toFixed(2)} due for vehicle rental`,
        performedBy: userId ?? undefined,
        newValues: {
          rental_id: createdRental.id,
          vehicle_id: vehicleId,
          deposit_amount: resolvedDepositAmount,
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
    paymentStatus,
    paymentDate,
    paymentMethod,
    paymentReference,
    depositStatus,
    depositPaidAt,
    depositRefundedAt,
    depositDeductionAmount,
    depositDeductionReason,
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
  };

  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }

  try {
    // Load current rental for validation and deposit workflow
    const { rows: existingRows } = await query<{
      id: string;
      driver_id: string;
      deposit_amount: string;
      deposit_status: "pending" | "paid" | "refunded" | "partial" | null;
      deposit_paid_at: string | null;
      deposit_refunded_at: string | null;
      deposit_deduction_amount: string | null;
      deposit_deduction_reason: string | null;
    }>(
      `
      SELECT
        id,
        driver_id,
        deposit_amount,
        deposit_status,
        deposit_paid_at,
        deposit_refunded_at,
        deposit_deduction_amount,
        deposit_deduction_reason
      FROM vehicle_rentals
      WHERE id = $1 AND vehicle_id = $2 AND organization_id = $3
      LIMIT 1
      `,
      [rentalId, vehicleId, orgId],
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
        updated_at = NOW()
      WHERE id = $11 AND vehicle_id = $12 AND organization_id = $13
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
