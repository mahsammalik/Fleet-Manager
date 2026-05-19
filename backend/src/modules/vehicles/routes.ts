import { Router } from "express";
import { authenticateJWT, requireRole } from "../../middleware/auth";
import { query } from "../../db/pool";
import { handleVehicleDriverHistory } from "./vehicleAssignmentHistoryHandlers";
import {
  runAssignVehicleTransaction,
  runUnassignVehicleTransaction,
} from "./vehicleAssignmentService";
import { parseListSort, type ListSortQuery } from "../../lib/listSort";

const router = Router();

const VEHICLE_LIST_SORT_FIELDS: Record<string, string | readonly string[]> = {
  plate_number: "v.license_plate",
  model: ["v.model", "v.make"],
  status: "v.status",
  weekly_rent: "v.weekly_rent",
  current_driver_id: [
    "(v.current_driver_id IS NOT NULL)",
    "d.last_name",
    "d.first_name",
  ],
  created_at: "v.created_at",
};

function resolveVehicleListOrder(query: ListSortQuery) {
  return parseListSort(query, VEHICLE_LIST_SORT_FIELDS, ["v.created_at"], "desc", "v.id ASC");
}

router.use(authenticateJWT);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

  const { search, status, limit, offset, sort_by, sort_order } = req.query as {
    search?: string;
    status?: string;
    limit?: string;
    offset?: string;
    sort_by?: string;
    sort_order?: string;
  };

  const sortResult = resolveVehicleListOrder({ sort_by, sort_order });
  if (!sortResult.ok) {
    return res.status(sortResult.status).json({ message: sortResult.message });
  }

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
      ${sortResult.orderByClause}
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

  const { q, status, limit, offset, sort_by, sort_order } = req.query as {
    q?: string;
    status?: string;
    limit?: string;
    offset?: string;
    sort_by?: string;
    sort_order?: string;
  };
  if (!q || !String(q).trim()) {
    return res.status(400).json({ message: "q is required" });
  }

  const sortResult = resolveVehicleListOrder({ sort_by, sort_order });
  if (!sortResult.ok) {
    return res.status(sortResult.status).json({ message: sortResult.message });
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
      ${sortResult.orderByClause}
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

const vehicleDriverHistory = [requireRole("admin", "accountant"), handleVehicleDriverHistory];
router.get("/:id/vehicle-assignment-history", ...vehicleDriverHistory);
router.get("/:id/driver-history", ...vehicleDriverHistory);

router.post("/:id/assign-driver", requireRole("admin", "accountant"), async (req, res) => {
  const orgId = req.user?.orgId;
  const vehicleId = String(req.params.id);
  const body = req.body as { driverId?: string };
  const driverId = typeof body.driverId === "string" ? body.driverId.trim() : "";

  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }
  if (!UUID_RE.test(vehicleId) || !UUID_RE.test(driverId)) {
    return res.status(400).json({ message: "Invalid vehicle or driver id" });
  }

  try {
    await runAssignVehicleTransaction({
      orgId,
      driverId,
      vehicleId,
      assignedBy: req.user?.sub ?? null,
      notes: "Assigned via vehicle detail",
    });
    const { rows } = await query(
      `SELECT v.*, d.first_name AS driver_first_name, d.last_name AS driver_last_name
       FROM vehicles v
       LEFT JOIN drivers d ON v.current_driver_id = d.id
       WHERE v.id = $1 AND v.organization_id = $2`,
      [vehicleId, orgId],
    );
    if (!rows[0]) return res.status(404).json({ message: "Vehicle not found" });
    return res.json(rows[0]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Assign failed";
    if (msg === "Driver not found" || msg === "Vehicle not found") {
      return res.status(404).json({ message: msg });
    }
    console.error("Assign driver to vehicle error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/:id/unassign-driver", requireRole("admin", "accountant"), async (req, res) => {
  const orgId = req.user?.orgId;
  const vehicleId = String(req.params.id);

  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }
  if (!UUID_RE.test(vehicleId)) {
    return res.status(400).json({ message: "Invalid vehicle id" });
  }

  try {
    await runUnassignVehicleTransaction({
      orgId,
      vehicleId,
      unassignedBy: req.user?.sub ?? null,
      notes: "Unassigned via vehicle detail",
    });
    const { rows } = await query(
      `SELECT v.*, d.first_name AS driver_first_name, d.last_name AS driver_last_name
       FROM vehicles v
       LEFT JOIN drivers d ON v.current_driver_id = d.id
       WHERE v.id = $1 AND v.organization_id = $2`,
      [vehicleId, orgId],
    );
    if (!rows[0]) return res.status(404).json({ message: "Vehicle not found" });
    return res.json(rows[0]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unassign failed";
    if (msg === "Vehicle not found") {
      return res.status(404).json({ message: msg });
    }
    console.error("Unassign driver from vehicle error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

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
        notes ?? null,
        id,
        orgId,
      ],
    );
    const vehicle = rows[0];
    if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });

    if (typeof currentDriverId !== "undefined") {
      const vehicleIdStr = String(id);
      if (currentDriverId && typeof currentDriverId === "string" && UUID_RE.test(currentDriverId)) {
        await runAssignVehicleTransaction({
          orgId,
          driverId: currentDriverId,
          vehicleId: vehicleIdStr,
          assignedBy: req.user?.sub ?? null,
          notes: "Assigned via edit vehicle",
        });
      } else {
        await runUnassignVehicleTransaction({
          orgId,
          vehicleId: vehicleIdStr,
          unassignedBy: req.user?.sub ?? null,
          notes: "Unassigned via edit vehicle",
        });
      }
    }

    const { rows: refreshed } = await query(
      `SELECT v.*, d.first_name AS driver_first_name, d.last_name AS driver_last_name
       FROM vehicles v
       LEFT JOIN drivers d ON v.current_driver_id = d.id
       WHERE v.id = $1 AND v.organization_id = $2`,
      [id, orgId],
    );
    return res.json(refreshed[0] ?? vehicle);
  } catch (err) {
    console.error("Update vehicle error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

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
