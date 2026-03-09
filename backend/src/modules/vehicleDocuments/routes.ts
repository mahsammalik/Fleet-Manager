import { Router } from "express";
import path from "path";
import fs from "fs";
import { authenticateJWT, requireRole } from "../../middleware/auth";
import { query } from "../../db/pool";
import { vehicleDocumentsUpload } from "../../config/multer";

const router = Router();

router.use(authenticateJWT);

// List all documents for a vehicle
router.get("/:id/documents", async (req, res) => {
  const orgId = req.user?.orgId;
  const { id } = req.params;

  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }

  try {
    const { rows } = await query(
      `
      SELECT d.*
      FROM vehicle_documents d
      JOIN vehicles v ON d.vehicle_id = v.id
      WHERE d.vehicle_id = $1 AND v.organization_id = $2
      ORDER BY d.created_at DESC
      `,
      [id, orgId],
    );

    return res.json(rows);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("List vehicle documents error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// Upload a new vehicle document
router.post(
  "/:id/documents",
  requireRole("admin", "accountant"),
  vehicleDocumentsUpload.single("file"),
  async (req, res) => {
    const orgId = req.user?.orgId;
    const userId = req.user?.sub;
    const { id } = req.params;
    const { documentType, documentNumber, expiryDate, issueDate, notes } = req.body as {
      documentType?: string;
      documentNumber?: string;
      expiryDate?: string;
      issueDate?: string;
      notes?: string;
    };

    if (!orgId) {
      return res.status(400).json({ message: "User is not associated with an organization" });
    }
    if (!req.file) {
      return res.status(400).json({ message: "File is required" });
    }
    if (!documentType) {
      return res.status(400).json({ message: "documentType is required" });
    }

    try {
      const { rows: vehicleRows } = await query(
        "SELECT id FROM vehicles WHERE id = $1 AND organization_id = $2",
        [id, orgId],
      );
      if (!vehicleRows[0]) {
        return res.status(404).json({ message: "Vehicle not found" });
      }

      const file = req.file;
      const relativePath = path.relative(process.cwd(), file.path).replace(/\\\\/g, "/");

      const { rows } = await query(
        `
        INSERT INTO vehicle_documents (
          vehicle_id,
          organization_id,
          document_type,
          document_number,
          file_name,
          file_path,
          file_size,
          expiry_date,
          issue_date,
          is_verified,
          uploaded_by,
          notes
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, $10, $11)
        RETURNING *
        `,
        [
          id,
          orgId,
          documentType,
          documentNumber || null,
          file.originalname,
          relativePath,
          file.size,
          expiryDate || null,
          issueDate || null,
          userId ?? null,
          notes ?? null,
        ],
      );

      return res.status(201).json(rows[0]);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Upload vehicle document error", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  },
);

// Delete a vehicle document
router.delete("/:id/documents/:docId", requireRole("admin", "accountant"), async (req, res) => {
  const orgId = req.user?.orgId;
  const { id: vehicleId, docId } = req.params;

  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }

  try {
    const { rows } = await query<{ id: string; file_path: string }>(
      `
      SELECT d.id, d.file_path
      FROM vehicle_documents d
      JOIN vehicles v ON d.vehicle_id = v.id
      WHERE d.id = $1 AND d.vehicle_id = $2 AND v.organization_id = $3
      LIMIT 1
      `,
      [docId, vehicleId, orgId],
    );

    const doc = rows[0];
    if (!doc) {
      return res.status(404).json({ message: "Document not found" });
    }

    const fullPath = path.join(process.cwd(), doc.file_path);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }

    await query("DELETE FROM vehicle_documents WHERE id = $1", [docId]);

    return res.status(204).send();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Delete vehicle document error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// Verify / unverify a vehicle document
router.put(
  "/:id/documents/:docId/verify",
  requireRole("admin", "accountant"),
  async (req, res) => {
    const orgId = req.user?.orgId;
    const userId = req.user?.sub;
    const { id: vehicleId, docId } = req.params;
    const { verified } = req.body as { verified?: boolean };

    if (!orgId) {
      return res.status(400).json({ message: "User is not associated with an organization" });
    }

    try {
      const { rows } = await query(
        `
        UPDATE vehicle_documents d
        SET is_verified = $1, verified_by = $2, verified_at = CASE WHEN $1 THEN NOW() ELSE NULL END
        FROM vehicles v
        WHERE d.vehicle_id = v.id AND d.id = $3 AND d.vehicle_id = $4 AND v.organization_id = $5
        RETURNING d.*
        `,
        [verified === true, verified === true ? userId : null, docId, vehicleId, orgId],
      );

      const doc = rows[0];
      if (!doc) {
        return res.status(404).json({ message: "Document not found" });
      }

      return res.json(doc);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Verify vehicle document error", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  },
);

// Download a vehicle document file
router.get("/:id/documents/:docId/download", async (req, res) => {
  const orgId = req.user?.orgId;
  const { id: vehicleId, docId } = req.params;

  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }

  try {
    const { rows } = await query<{ file_path: string; file_name: string }>(
      `
      SELECT d.file_path, d.file_name
      FROM vehicle_documents d
      JOIN vehicles v ON d.vehicle_id = v.id
      WHERE d.id = $1 AND d.vehicle_id = $2 AND v.organization_id = $3
      LIMIT 1
      `,
      [docId, vehicleId, orgId],
    );

    const doc = rows[0];
    if (!doc) {
      return res.status(404).json({ message: "Document not found" });
    }

    const fullPath = path.join(process.cwd(), doc.file_path);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ message: "File not found on server" });
    }

    return res.download(fullPath, doc.file_name);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Download vehicle document error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// Expiry warnings for vehicle documents (e.g. next 30 days)
router.get("/documents/expiring", async (req, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }

  try {
    const { rows } = await query(
      `
      SELECT d.*, v.make, v.model, v.license_plate
      FROM vehicle_documents d
      JOIN vehicles v ON d.vehicle_id = v.id
      WHERE d.organization_id = $1
        AND d.expiry_date IS NOT NULL
        AND d.expiry_date <= NOW() + INTERVAL '30 days'
      ORDER BY d.expiry_date ASC
      `,
      [orgId],
    );

    return res.json(rows);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Get expiring vehicle documents error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

export const vehicleDocumentRoutes = router;

