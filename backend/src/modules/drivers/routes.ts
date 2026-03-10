import { Router } from "express";
import path from "path";
import fs from "fs";
import { authenticateJWT, requireRole } from "../../middleware/auth";
import { query } from "../../db/pool";
import { logDriverActivity } from "./activity";
import { driverProfilePhotoUpload } from "../../config/multer";

const router = Router();

router.use(authenticateJWT);

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
  const conditions = ["d.organization_id = $1", "(d.is_deleted = false OR d.is_deleted IS NULL)"];

  if (status) {
    params.push(status);
    conditions.push(`d.employment_status = $${params.length}`);
  }

  if (search) {
    params.push(`%${search}%`);
    const idx = params.length;
    conditions.push(`(LOWER(d.first_name) LIKE LOWER($${idx}) OR LOWER(d.last_name) LIKE LOWER($${idx}))`);
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
      SELECT d.id, d.first_name, d.last_name, d.phone, d.email, d.employment_status, d.commission_rate, d.profile_photo_url,
             d.uber_driver_id, d.bolt_driver_id, d.glovo_courier_id, d.bolt_courier_id, d.wolt_courier_id,
             d.current_vehicle_id,
             v.license_plate AS current_vehicle_license_plate, v.make AS current_vehicle_make, v.model AS current_vehicle_model
      FROM drivers d
      LEFT JOIN vehicles v ON d.current_vehicle_id = v.id
      ${where}
      ORDER BY d.created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `,
      params,
    );

    return res.json(rows);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("List drivers error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/:id/active-rental", async (req, res) => {
  const orgId = req.user?.orgId;
  const { id } = req.params;

  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }

  try {
    const { rows } = await query(
      `
      SELECT r.id AS rental_id, r.vehicle_id, r.rental_start_date, r.rental_end_date, r.status
      FROM vehicle_rentals r
      WHERE r.driver_id = $1 AND r.organization_id = $2 AND r.status = 'active'
      ORDER BY r.rental_start_date DESC
      LIMIT 1
      `,
      [id, orgId],
    );

    const rental = rows[0];
    if (!rental) {
      return res.json(null);
    }
    return res.json(rental);
  } catch (err) {
    console.error("Get driver active rental error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.patch(
  "/:id/photo",
  requireRole("admin", "accountant"),
  driverProfilePhotoUpload.single("photo"),
  async (req, res) => {
    const orgId = req.user?.orgId;
    const userId = req.user?.sub;
    const { id } = req.params;

    if (!orgId) {
      return res.status(400).json({ message: "User is not associated with an organization" });
    }
    if (!req.file) {
      return res.status(400).json({ message: "Photo file is required" });
    }

    try {
      const { rows: existing } = await query<{ profile_photo_url: string | null }>(
        "SELECT profile_photo_url FROM drivers WHERE id = $1 AND organization_id = $2 LIMIT 1",
        [id, orgId],
      );
      if (!existing[0]) {
        return res.status(404).json({ message: "Driver not found" });
      }

      const relativePath = path.relative(process.cwd(), req.file.path).replace(/\\/g, "/");

      const { rows } = await query(
        `UPDATE drivers
         SET profile_photo_url = $1, profile_photo_updated_at = NOW(), updated_at = NOW()
         WHERE id = $2 AND organization_id = $3
         RETURNING *`,
        [relativePath, id, orgId],
      );

      const oldPath = existing[0].profile_photo_url;
      if (oldPath) {
        const absoluteOld = path.join(process.cwd(), oldPath);
        if (fs.existsSync(absoluteOld)) {
          try {
            fs.unlinkSync(absoluteOld);
          } catch {
            // ignore
          }
        }
      }

      await logDriverActivity(String(id), "profile_photo_update", {
        description: "Profile photo updated",
        performedBy: userId ?? undefined,
        newValues: { profile_photo_url: relativePath },
      });

      return res.json(rows[0]);
    } catch (err) {
      console.error("Update driver photo error", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  },
);

router.get("/:id", async (req, res) => {
  const orgId = req.user?.orgId;
  const { id } = req.params;

  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }

  try {
    const { rows } = await query(
      `
      SELECT d.*,
             v.id AS current_vehicle_id,
             v.make AS current_vehicle_make,
             v.model AS current_vehicle_model,
             v.license_plate AS current_vehicle_license_plate,
             v.year AS current_vehicle_year,
             v.status AS current_vehicle_status
      FROM drivers d
      LEFT JOIN vehicles v ON d.current_vehicle_id = v.id
      WHERE d.id = $1 AND d.organization_id = $2 AND (d.is_deleted = false OR d.is_deleted IS NULL)
      LIMIT 1
      `,
      [id, orgId],
    );

    const driver = rows[0];
    if (!driver) {
      return res.status(404).json({ message: "Driver not found" });
    }

    const payload = { ...driver };
    if (driver.current_vehicle_id) {
      payload.vehicle = {
        id: driver.current_vehicle_id,
        license_plate: driver.current_vehicle_license_plate ?? "",
        make: driver.current_vehicle_make ?? "",
        model: driver.current_vehicle_model ?? "",
        status: driver.current_vehicle_status ?? "available",
      };
    }
    return res.json(payload);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Get driver error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/:id/activity", async (req, res) => {
  const orgId = req.user?.orgId;
  const { id } = req.params;

  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }

  try {
    const { rows } = await query(
      `
      SELECT a.*
      FROM driver_activities a
      JOIN drivers d ON a.driver_id = d.id
      WHERE a.driver_id = $1 AND d.organization_id = $2
      ORDER BY a.created_at DESC
      LIMIT 100
      `,
      [id, orgId],
    );

    return res.json(rows);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Get driver activity error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.patch("/:id/notes", requireRole("admin", "accountant"), async (req, res) => {
  const orgId = req.user?.orgId;
  const userId = req.user?.sub;
  const { id } = req.params;
  const { notes } = req.body as { notes?: string };

  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }

  try {
    const { rows: existing } = await query<{ notes: string | null }>(
      "SELECT notes FROM drivers WHERE id = $1 AND organization_id = $2 LIMIT 1",
      [id, orgId],
    );
    if (!existing[0]) {
      return res.status(404).json({ message: "Driver not found" });
    }

    const { rows } = await query(
      `
      UPDATE drivers SET notes = $1, updated_at = NOW()
      WHERE id = $2 AND organization_id = $3
      RETURNING *
      `,
      [notes ?? null, id, orgId],
    );

    await logDriverActivity(String(id), "notes_update", {
      description: "Driver notes updated",
      performedBy: userId ?? undefined,
      oldValues: { notes: existing[0].notes },
      newValues: { notes: notes ?? null },
    });

    return res.json(rows[0]);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Update driver notes error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/", requireRole("admin", "accountant"), async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }

  const {
    firstName,
    lastName,
    email,
    phone,
    dateOfBirth,
    address,
    licenseNumber,
    licenseExpiry,
    licenseClass,
    hireDate,
    employmentStatus,
    commissionRate,
    baseCommissionRate,
    commissionType,
    fixedCommissionAmount,
    minimumCommission,
    uberDriverId,
    boltDriverId,
    glovoCourierId,
    boltCourierId,
    woltCourierId,
    notes,
  } = req.body as Record<string, unknown>;

  if (!firstName || !lastName || !phone) {
    return res.status(400).json({ message: "firstName, lastName and phone are required" });
  }

  if (licenseNumber) {
    const { rows: existing } = await query<{ id: string }>(
      "SELECT id FROM drivers WHERE organization_id = $1 AND license_number = $2 LIMIT 1",
      [orgId, licenseNumber],
    );
    if (existing[0]) {
      return res.status(409).json({ message: "A driver with this license number already exists" });
    }
  }

  try {
    const { rows } = await query(
      `
      INSERT INTO drivers (
        organization_id,
        first_name,
        last_name,
        email,
        phone,
        date_of_birth,
        address,
        license_number,
        license_expiry,
        license_class,
        hire_date,
        employment_status,
        commission_rate,
        base_commission_rate,
        commission_type,
        fixed_commission_amount,
        minimum_commission,
        uber_driver_id,
        bolt_driver_id,
        glovo_courier_id,
        bolt_courier_id,
        wolt_courier_id,
        notes
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, COALESCE($12, 'active'),
        COALESCE($13, 20.0), COALESCE($14, 20.0),
        COALESCE($15, 'percentage'), COALESCE($16, 0), COALESCE($17, 0),
        $18, $19, $20, $21, $22, $23
      )
      RETURNING *
      `,
      [
        orgId,
        firstName,
        lastName,
        email,
        phone,
        dateOfBirth,
        address,
        licenseNumber,
        licenseExpiry,
        licenseClass,
        hireDate,
        employmentStatus,
        commissionRate,
        baseCommissionRate,
        commissionType,
        fixedCommissionAmount,
        minimumCommission,
        uberDriverId,
        boltDriverId,
        glovoCourierId,
        boltCourierId,
        woltCourierId,
        notes,
      ],
    );

    return res.status(201).json(rows[0]);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Create driver error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.put("/:id", requireRole("admin", "accountant"), async (req, res) => {
  const orgId = req.user?.orgId;
  const { id } = req.params;

  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }

  const {
    firstName,
    lastName,
    email,
    phone,
    dateOfBirth,
    address,
    licenseNumber,
    licenseExpiry,
    licenseClass,
    hireDate,
    employmentStatus,
    commissionRate,
    baseCommissionRate,
    commissionType,
    fixedCommissionAmount,
    minimumCommission,
    uberDriverId,
    boltDriverId,
    glovoCourierId,
    boltCourierId,
    woltCourierId,
    notes,
  } = req.body as Record<string, unknown>;

  if (licenseNumber) {
    const { rows: existing } = await query<{ id: string }>(
      "SELECT id FROM drivers WHERE organization_id = $1 AND license_number = $2 AND id != $3 LIMIT 1",
      [orgId, licenseNumber, id],
    );
    if (existing[0]) {
      return res.status(409).json({ message: "A driver with this license number already exists" });
    }
  }

  try {
    const { rows } = await query(
      `
      UPDATE drivers
      SET
        first_name = $1,
        last_name = $2,
        email = $3,
        phone = $4,
        date_of_birth = $5,
        address = $6,
        license_number = $7,
        license_expiry = $8,
        license_class = $9,
        hire_date = $10,
        employment_status = $11,
        commission_rate = $12,
        base_commission_rate = $13,
        commission_type = COALESCE($14, commission_type),
        fixed_commission_amount = COALESCE($15, fixed_commission_amount),
        minimum_commission = COALESCE($16, minimum_commission),
        uber_driver_id = $17,
        bolt_driver_id = $18,
        wolt_courier_id = $19,
        glovo_courier_id = $20,
        bolt_courier_id = $21,
        notes = $22,
        updated_at = NOW()
      WHERE id = $23 AND organization_id = $24
      RETURNING *
      `,
      [
        firstName,
        lastName,
        email,
        phone,
        dateOfBirth,
        address,
        licenseNumber,
        licenseExpiry,
        licenseClass,
        hireDate,
        employmentStatus,
        commissionRate,
        baseCommissionRate,
        commissionType,
        fixedCommissionAmount,
        minimumCommission,
        uberDriverId,
        boltDriverId,
        woltCourierId,
        glovoCourierId,
        boltCourierId,
        notes,
        id,
        orgId,
      ],
    );

    const driver = rows[0];
    if (!driver) {
      return res.status(404).json({ message: "Driver not found" });
    }

    await logDriverActivity(String(id), "profile_update", {
      description: "Driver profile updated",
      performedBy: req.user?.sub,
    });

    return res.json(driver);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Update driver error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.patch("/:id/status", requireRole("admin", "accountant"), async (req, res) => {
  const orgId = req.user?.orgId;
  const { id } = req.params;
  const { status } = req.body as { status?: string };

  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }
  if (!status) {
    return res.status(400).json({ message: "status is required" });
  }

  try {
    const { rows } = await query(
      `
      UPDATE drivers
      SET employment_status = $1, updated_at = NOW()
      WHERE id = $2 AND organization_id = $3
      RETURNING *
      `,
      [status, id, orgId],
    );

    const driver = rows[0];
    if (!driver) {
      return res.status(404).json({ message: "Driver not found" });
    }

    await logDriverActivity(String(id), "status_change", {
      description: `Employment status set to ${status}`,
      performedBy: req.user?.sub,
      newValues: { employment_status: status },
    });

    return res.json(driver);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Update driver status error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.delete("/:id", requireRole("admin", "accountant"), async (req, res) => {
  const orgId = req.user?.orgId;
  const userId = req.user?.sub;
  const { id } = req.params;

  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }

  try {
    const { rows } = await query(
      `
      UPDATE drivers
      SET is_deleted = true, deleted_at = NOW(), deleted_by = $3, employment_status = 'terminated', updated_at = NOW()
      WHERE id = $1 AND organization_id = $2 AND (is_deleted = false OR is_deleted IS NULL)
      RETURNING *
      `,
      [id, orgId, userId ?? null],
    );

    const driver = rows[0];
    if (!driver) {
      return res.status(404).json({ message: "Driver not found" });
    }

    await logDriverActivity(String(id), "driver_delete", {
      description: "Driver soft deleted",
      performedBy: userId ?? undefined,
      newValues: { is_deleted: true, employment_status: "terminated" },
    });

    return res.json(driver);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Delete driver error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

export const driverRoutes = router;

