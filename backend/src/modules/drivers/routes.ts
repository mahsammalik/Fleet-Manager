import { Router } from "express";
import { authenticateJWT, requireRole } from "../../middleware/auth";
import { query } from "../../db/pool";
import { logDriverActivity } from "./activity";

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
  const conditions = ["organization_id = $1", "(is_deleted = false OR is_deleted IS NULL)"];

  if (status) {
    params.push(status);
    conditions.push(`employment_status = $${params.length}`);
  }

  if (search) {
    params.push(`%${search}%`);
    const idx = params.length;
    conditions.push(`(LOWER(first_name) LIKE LOWER($${idx}) OR LOWER(last_name) LIKE LOWER($${idx}))`);
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
      SELECT id, first_name, last_name, phone, email, employment_status, commission_rate, uber_driver_id, bolt_driver_id
      FROM drivers
      ${where}
      ORDER BY created_at DESC
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

router.get("/:id", async (req, res) => {
  const orgId = req.user?.orgId;
  const { id } = req.params;

  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }

  try {
    const { rows } = await query(
      `
      SELECT *
      FROM drivers
      WHERE id = $1 AND organization_id = $2 AND (is_deleted = false OR is_deleted IS NULL)
      LIMIT 1
      `,
      [id, orgId],
    );

    const driver = rows[0];
    if (!driver) {
      return res.status(404).json({ message: "Driver not found" });
    }

    return res.json(driver);
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
        notes
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, COALESCE($12, 'active'),
        COALESCE($13, 20.0), COALESCE($14, 20.0),
        COALESCE($15, 'percentage'), COALESCE($16, 0), COALESCE($17, 0),
        $18, $19, $20
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
        notes = $19,
        updated_at = NOW()
      WHERE id = $20 AND organization_id = $21
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

