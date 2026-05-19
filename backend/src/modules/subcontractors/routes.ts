import { Router } from "express";
import { authenticateJWT, requireRole } from "../../middleware/auth";
import { query } from "../../db/pool";

const router = Router();

router.use(authenticateJWT);
router.use(requireRole("admin", "accountant"));

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

router.get("/", async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) return res.status(400).json({ message: "User is not associated with an organization" });
  try {
    const { rows } = await query(
      `SELECT s.*,
              (SELECT COUNT(*)::int FROM drivers d WHERE d.subcontractor_id = s.id AND d.organization_id = s.organization_id
                 AND (d.is_deleted = false OR d.is_deleted IS NULL)) AS driver_count
       FROM subcontractors s
       WHERE s.organization_id = $1
       ORDER BY s.legal_name ASC`,
      [orgId],
    );
    return res.json(rows);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("List subcontractors error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/:id", async (req, res) => {
  const orgId = req.user?.orgId;
  const { id } = req.params;
  if (!orgId) return res.status(400).json({ message: "User is not associated with an organization" });
  if (!UUID_RE.test(id)) return res.status(400).json({ message: "Invalid id" });
  try {
    const { rows } = await query(
      `SELECT s.*,
              (SELECT COUNT(*)::int FROM drivers d WHERE d.subcontractor_id = s.id AND d.organization_id = s.organization_id
                 AND (d.is_deleted = false OR d.is_deleted IS NULL)) AS driver_count
       FROM subcontractors s
       WHERE s.id = $1::uuid AND s.organization_id = $2::uuid
       LIMIT 1`,
      [id, orgId],
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ message: "Subcontractor not found" });
    const { rows: drivers } = await query(
      `SELECT d.id, d.first_name, d.last_name, d.phone, d.employment_status
       FROM drivers d
       WHERE d.subcontractor_id = $1::uuid AND d.organization_id = $2::uuid
         AND (d.is_deleted = false OR d.is_deleted IS NULL)
       ORDER BY d.last_name, d.first_name`,
      [id, orgId],
    );
    return res.json({ ...row, drivers });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Get subcontractor error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/", async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) return res.status(400).json({ message: "User is not associated with an organization" });
  const b = req.body as Record<string, unknown>;
  const legalName = typeof b.legalName === "string" ? b.legalName.trim() : "";
  if (!legalName) return res.status(400).json({ message: "legalName is required" });
  const registrationType =
    b.registrationType === "sa" || b.registrationType === "other" || b.registrationType === "srl"
      ? b.registrationType
      : "srl";
  try {
    const { rows } = await query(
      `INSERT INTO subcontractors (
          organization_id, legal_name, registration_type, registration_number, tax_id,
          email, phone, address, bank_name, bank_account_iban, status,
          contract_start_date, contract_end_date, notes
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          COALESCE($11, 'active'),
          $12, $13, $14
        )
        RETURNING *`,
      [
        orgId,
        legalName,
        registrationType,
        b.registrationNumber ?? null,
        b.taxId ?? null,
        b.email ?? null,
        b.phone ?? null,
        b.address ?? null,
        b.bankName ?? null,
        b.bankAccountIban ?? null,
        b.status ?? "active",
        b.contractStartDate ?? null,
        b.contractEndDate ?? null,
        b.notes ?? null,
      ],
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Create subcontractor error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.put("/:id", async (req, res) => {
  const orgId = req.user?.orgId;
  const { id } = req.params;
  if (!orgId) return res.status(400).json({ message: "User is not associated with an organization" });
  if (!UUID_RE.test(id)) return res.status(400).json({ message: "Invalid id" });
  const b = req.body as Record<string, unknown>;
  const legalName = typeof b.legalName === "string" ? b.legalName.trim() : "";
  if (!legalName) return res.status(400).json({ message: "legalName is required" });
  const registrationType =
    b.registrationType === "sa" || b.registrationType === "other" || b.registrationType === "srl"
      ? b.registrationType
      : "srl";
  try {
    const { rows } = await query(
      `UPDATE subcontractors SET
          legal_name = $1,
          registration_type = $2,
          registration_number = $3,
          tax_id = $4,
          email = $5,
          phone = $6,
          address = $7,
          bank_name = $8,
          bank_account_iban = $9,
          status = COALESCE($10, status),
          contract_start_date = $11,
          contract_end_date = $12,
          notes = $13,
          updated_at = NOW()
        WHERE id = $14::uuid AND organization_id = $15::uuid
        RETURNING *`,
      [
        legalName,
        registrationType,
        b.registrationNumber ?? null,
        b.taxId ?? null,
        b.email ?? null,
        b.phone ?? null,
        b.address ?? null,
        b.bankName ?? null,
        b.bankAccountIban ?? null,
        b.status ?? null,
        b.contractStartDate ?? null,
        b.contractEndDate ?? null,
        b.notes ?? null,
        id,
        orgId,
      ],
    );
    if (!rows[0]) return res.status(404).json({ message: "Subcontractor not found" });
    return res.json(rows[0]);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Update subcontractor error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

export const subcontractorRoutes = router;
