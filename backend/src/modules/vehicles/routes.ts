import { Router } from "express";
import { authenticateJWT, requireRole } from "../../middleware/auth";
import { pool, query } from "../../db/pool";

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
    const { rows: vehicleRows } = await query<{ id: string; status: string }>(
      "SELECT id, status FROM vehicles WHERE id = $1 AND organization_id = $2 LIMIT 1",
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

    await client.query("BEGIN");

    const insertResult = await client.query(
      `
      INSERT INTO vehicle_rentals (
        vehicle_id, driver_id, organization_id, rental_start_date, rental_end_date,
        rental_type, total_rent_amount, deposit_amount, payment_status, payment_date,
        payment_method, payment_reference, status, notes, created_by
      )
      VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'daily'), $7, $8, COALESCE($9, 'pending'), $10, $11, $12, COALESCE($13, 'active'), $14, $15)
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
        depositAmount ?? 0,
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
  const { vehicleId, rentalId } = req.params;
  const body = req.body as Record<string, unknown>;
  const { status, paymentStatus, paymentDate, paymentMethod, paymentReference } = body;

  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }

  try {
    const { rows } = await query(
      `
      UPDATE vehicle_rentals
      SET
        status = COALESCE($1, status),
        payment_status = COALESCE($2, payment_status),
        payment_date = COALESCE($3, payment_date),
        payment_method = COALESCE($4, payment_method),
        payment_reference = COALESCE($5, payment_reference),
        updated_at = NOW()
      WHERE id = $6 AND vehicle_id = $7 AND organization_id = $8
      RETURNING *
      `,
      [status ?? null, paymentStatus ?? null, paymentDate ?? null, paymentMethod ?? null, paymentReference ?? null, rentalId, vehicleId, orgId],
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
