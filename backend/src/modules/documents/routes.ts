import { Router } from "express";
import path from "path";
import fs from "fs";
import { authenticateJWT, requireRole } from "../../middleware/auth";
import { query } from "../../db/pool";
import { driverDocumentsUpload } from "../../config/multer";
import { logDriverActivity } from "../drivers/activity";

const router = Router();

router.use(authenticateJWT);

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
      FROM driver_documents d
      JOIN drivers dr ON d.driver_id = dr.id
      WHERE d.driver_id = $1 AND dr.organization_id = $2
      ORDER BY d.created_at DESC
      `,
      [id, orgId],
    );

    return res.json(rows);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("List documents error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.post(
  "/:id/documents",
  requireRole("admin", "accountant"),
  driverDocumentsUpload.single("file"),
  async (req, res) => {
    const orgId = req.user?.orgId;
    const userId = req.user?.sub;
    const { id } = req.params;
    const { documentType, expiryDate, notes } = req.body as {
      documentType?: string;
      expiryDate?: string;
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
      const { rows: driverRows } = await query(
        "SELECT id FROM drivers WHERE id = $1 AND organization_id = $2",
        [id, orgId],
      );
      if (!driverRows[0]) {
        return res.status(404).json({ message: "Driver not found" });
      }

      const file = req.file;
      const relativePath = path.relative(process.cwd(), file.path);

      const { rows } = await query(
        `
        INSERT INTO driver_documents (
          driver_id,
          organization_id,
          document_type,
          file_name,
          file_path,
          file_size,
          mime_type,
          expiry_date,
          uploaded_by,
          notes
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
        `,
        [
          id,
          orgId,
          documentType,
          file.originalname,
          relativePath,
          file.size,
          file.mimetype,
          expiryDate || null,
          userId ?? null,
          notes ?? null,
        ],
      );

      await logDriverActivity(String(id), "document_upload", {
        description: `Document uploaded: ${file.originalname} (${documentType})`,
        performedBy: userId ?? undefined,
        newValues: { file_name: file.originalname, document_type: documentType },
      });

      return res.status(201).json(rows[0]);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Upload document error", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  },
);

router.delete("/:id/documents/:docId", requireRole("admin", "accountant"), async (req, res) => {
  const orgId = req.user?.orgId;
  const { id: driverId, docId } = req.params;

  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }

  try {
    const { rows } = await query<{ id: string; file_path: string }>(
      `
      SELECT d.id, d.file_path
      FROM driver_documents d
      JOIN drivers dr ON d.driver_id = dr.id
      WHERE d.id = $1 AND d.driver_id = $2 AND dr.organization_id = $3
      LIMIT 1
      `,
      [docId, driverId, orgId],
    );

    const doc = rows[0];
    if (!doc) {
      return res.status(404).json({ message: "Document not found" });
    }

    const fullPath = path.join(process.cwd(), doc.file_path);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }

    await query("DELETE FROM driver_documents WHERE id = $1", [docId]);

    await logDriverActivity(String(driverId), "document_delete", {
      description: `Document deleted: ${doc.file_path}`,
      performedBy: req.user?.sub,
    });

    return res.status(204).send();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Delete document error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.put("/:id/documents/:docId/verify", requireRole("admin", "accountant"), async (req, res) => {
  const orgId = req.user?.orgId;
  const userId = req.user?.sub;
  const { id: driverId, docId } = req.params;
  const { verified } = req.body as { verified?: boolean };

  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }

  try {
    const { rows } = await query(
      `
      UPDATE driver_documents d
      SET is_verified = $1, verified_by = $2, verified_at = CASE WHEN $1 THEN NOW() ELSE NULL END
      FROM drivers dr
      WHERE d.driver_id = dr.id AND d.id = $3 AND d.driver_id = $4 AND dr.organization_id = $5
      RETURNING d.*
      `,
      [verified === true, verified === true ? userId : null, docId, driverId, orgId],
    );

    const doc = rows[0];
    if (!doc) {
      return res.status(404).json({ message: "Document not found" });
    }

    await logDriverActivity(String(driverId), "document_verify", {
      description: `Document ${verified ? "verified" : "unverified"}: ${doc.file_name}`,
      performedBy: userId ?? undefined,
      newValues: { is_verified: verified },
    });

    return res.json(doc);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Verify document error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/:id/documents/:docId/download", async (req, res) => {
  const orgId = req.user?.orgId;
  const { id: driverId, docId } = req.params;

  if (!orgId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }

  try {
    const { rows } = await query<{ file_path: string; file_name: string }>(
      `
      SELECT d.file_path, d.file_name
      FROM driver_documents d
      JOIN drivers dr ON d.driver_id = dr.id
      WHERE d.id = $1 AND d.driver_id = $2 AND dr.organization_id = $3
      LIMIT 1
      `,
      [docId, driverId, orgId],
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
    console.error("Download document error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

export const documentRoutes = router;
