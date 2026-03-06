import { Router } from "express";
import { authenticateJWT, requireRole } from "../../middleware/auth";
import { query } from "../../db/pool";

const router = Router();

router.use(authenticateJWT);
router.use(requireRole("admin", "accountant"));

router.get("/stats", async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }

  try {
    const [driversRes, activeRes, pendingDocsRes, expiredDocsRes] = await Promise.all([
      query<{ count: string }>("SELECT COUNT(*) as count FROM drivers WHERE organization_id = $1", [orgId]),
      query<{ count: string }>(
        "SELECT COUNT(*) as count FROM drivers WHERE organization_id = $1 AND employment_status = 'active'",
        [orgId],
      ),
      query<{ count: string }>(
        `SELECT COUNT(*) as count FROM driver_documents d
         JOIN drivers dr ON d.driver_id = dr.id
         WHERE dr.organization_id = $1 AND d.is_verified = false`,
        [orgId],
      ),
      query<{ count: string }>(
        `SELECT COUNT(*) as count FROM driver_documents d
         JOIN drivers dr ON d.driver_id = dr.id
         WHERE dr.organization_id = $1 AND d.expiry_date IS NOT NULL AND d.expiry_date < CURRENT_DATE`,
        [orgId],
      ),
    ]);

    const totalDrivers = parseInt(driversRes.rows[0]?.count ?? "0", 10);
    const activeDrivers = parseInt(activeRes.rows[0]?.count ?? "0", 10);
    const pendingDocuments = parseInt(pendingDocsRes.rows[0]?.count ?? "0", 10);
    const expiredDocuments = parseInt(expiredDocsRes.rows[0]?.count ?? "0", 10);

    return res.json({
      totalDrivers,
      activeDrivers,
      pendingDocuments,
      expiredDocuments,
      totalCommissionEarned: 0,
      pendingPayments: 0,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Dashboard stats error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/drivers/status", async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }

  try {
    const { rows } = await query<{ employment_status: string; count: string }>(
      `SELECT employment_status, COUNT(*)::text as count
       FROM drivers WHERE organization_id = $1
       GROUP BY employment_status`,
      [orgId],
    );

    return res.json(
      rows.map((r) => ({ status: r.employment_status, count: parseInt(r.count, 10) })),
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Dashboard driver status error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/earnings/monthly", async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }
  try {
    return res.json([]);
  } catch (err) {
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/documents", async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }
  try {
    const { rows } = await query<{ document_type: string; total: string; verified: string }>(
      `SELECT d.document_type,
              COUNT(*)::text as total,
              SUM(CASE WHEN d.is_verified = true THEN 1 ELSE 0 END)::text as verified
       FROM driver_documents d
       JOIN drivers dr ON d.driver_id = dr.id
       WHERE dr.organization_id = $1
       GROUP BY d.document_type`,
      [orgId],
    );
    return res.json(
      rows.map((r) => ({
        documentType: r.document_type,
        total: parseInt(r.total, 10),
        verified: parseInt(r.verified, 10),
        pending: parseInt(r.total, 10) - parseInt(r.verified, 10),
      })),
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Dashboard documents error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/activity", async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }
  try {
    const { rows } = await query(
      `SELECT a.id, a.driver_id, a.activity_type, a.activity_description, a.performed_by, a.created_at
       FROM driver_activities a
       JOIN drivers d ON a.driver_id = d.id
       WHERE d.organization_id = $1
       ORDER BY a.created_at DESC
       LIMIT 10`,
      [orgId],
    );
    return res.json(rows);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Dashboard activity error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

export const dashboardRoutes = router;