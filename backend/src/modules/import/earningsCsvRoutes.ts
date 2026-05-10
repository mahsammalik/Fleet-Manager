import { Router } from "express";
import { authenticateJWT, requireRole } from "../../middleware/auth";
import { pool } from "../../db/pool";
import { readOrgGlovoCommissionBase } from "../earnings/orgImportSettings";
import { earningsUpload } from "../../config/multer";
import { parseEarningsFile } from "../earnings/parseFile";
import { buildColumnMap } from "../earnings/romanHeaderMap";
import { rowCellsToNormalized } from "../earnings/normalizeRow";
import { detectPlatformWithMeta, isEarningsPlatform, type EarningsPlatform } from "../earnings/detectPlatform";
import { extractDateFromFilename } from "../earnings/filenameDate";
import { insertEarningsPreviewStaging } from "../earnings/earningsPreviewStage";
import { runEarningsCommitFromStaging } from "../earnings/earningsCommit";

const router = Router();

router.use(authenticateJWT);
router.use(requireRole("admin", "accountant"));

function normalizeDateInput(input?: string): string | null {
  if (!input) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return null;
  const parsed = new Date(`${input}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return input;
}

function normalizeRentalType(input?: string): "daily" | "weekly" | "monthly" | null {
  if (!input) return null;
  const v = input.trim().toLowerCase();
  if (v === "daily" || v === "weekly" || v === "monthly") return v;
  return null;
}

function toNumber(value: string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function rentalDaysInclusive(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 1;
  return Math.max(1, Math.floor((end - start) / 86400000) + 1);
}

/** One-shot: stage + commit in one request (same logic as preview + commit). */
router.post("/earnings-csv", earningsUpload.single("file"), async (req, res) => {
  const orgId = req.user?.orgId;
  const userId = req.user?.sub;
  if (!orgId || !userId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }
  if (!req.file?.buffer) {
    return res.status(400).json({ message: "file is required" });
  }

  const platformRaw = req.body?.platform;
  const weekStart = req.body?.weekStart;
  const weekEnd = req.body?.weekEnd;
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  if (!platformRaw || typeof platformRaw !== "string" || !isEarningsPlatform(platformRaw.trim())) {
    return res.status(400).json({ message: "platform is required and must be a valid earnings provider" });
  }
  if (typeof weekStart !== "string" || typeof weekEnd !== "string" || !isoDate.test(weekStart) || !isoDate.test(weekEnd)) {
    return res.status(400).json({ message: "weekStart and weekEnd are required (YYYY-MM-DD)" });
  }
  if (weekStart > weekEnd) {
    return res.status(400).json({ message: "weekStart must be on or before weekEnd" });
  }

  const platformEff = platformRaw.trim() as EarningsPlatform;

  try {
    const table = await parseEarningsFile(req.file.buffer, req.file.originalname);
    if (!table.headers.length || !table.rows.length) {
      return res.status(400).json({ message: "No data rows found in file" });
    }

    const { confidence: detectionConfidence } = detectPlatformWithMeta(req.file.originalname, table.headers);
    const colMap = buildColumnMap(table.headers);
    const filenameDate = extractDateFromFilename(req.file.originalname);
    const normalizedRows = table.rows.map((cells) =>
      rowCellsToNormalized(cells, colMap, filenameDate, {
        skipInferredPlatformFee: platformEff === "glovo",
      }),
    );

    const glovoCommissionBaseType =
      platformEff === "glovo" ? await readOrgGlovoCommissionBase(orgId) : undefined;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const importId = await insertEarningsPreviewStaging(client, {
        orgId,
        userId,
        fileName: req.file.originalname,
        weekStart,
        weekEnd,
        platform: platformEff,
        detectionConfidence,
        filenameDate,
        headerCount: table.headers.length,
        rowCount: table.rows.length,
        normalizedRows,
        glovoCommissionBaseType,
      });
      const commitResult = await runEarningsCommitFromStaging(client, orgId, importId, platformEff, weekStart, weekEnd);
      await client.query("COMMIT");
      return res.json({
        importId,
        ...commitResult,
      });
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Import failed";
    // eslint-disable-next-line no-console
    console.error("One-shot earnings CSV error", err);
    return res.status(400).json({ message: msg });
  }
});

router.post(["/rentals-csv", "/rentals/import"], earningsUpload.single("file"), async (req, res) => {
  const orgId = req.user?.orgId;
  const userId = req.user?.sub;
  if (!orgId || !userId) {
    return res.status(400).json({ message: "User is not associated with an organization" });
  }
  if (!req.file?.buffer) {
    return res.status(400).json({ message: "file is required" });
  }

  try {
    const table = await parseEarningsFile(req.file.buffer, req.file.originalname);
    if (!table.headers.length || !table.rows.length) {
      return res.status(400).json({ message: "No data rows found in file" });
    }

    const headerIndex = new Map(
      table.headers.map((h, i) => [h.trim().toLowerCase(), i]),
    );
    const plateIdx = headerIndex.get("vehicle_plate");
    const phoneIdx = headerIndex.get("driver_phone");
    const typeIdx = headerIndex.get("rental_type");
    const startIdx = headerIndex.get("start_date");
    const endIdx = headerIndex.get("end_date");
    if (
      typeof plateIdx !== "number" ||
      typeof phoneIdx !== "number" ||
      typeof typeIdx !== "number" ||
      typeof startIdx !== "number" ||
      typeof endIdx !== "number"
    ) {
      return res.status(400).json({
        message:
          "CSV must include columns: vehicle_plate, driver_phone, rental_type, start_date, end_date",
      });
    }

    let created = 0;
    const failed: { row: number; message: string; vehiclePlate?: string; driverPhone?: string }[] = [];

    for (let i = 0; i < table.rows.length; i += 1) {
      const rowNum = i + 2;
      const cells = table.rows[i];
      const vehiclePlate = String(cells[plateIdx] ?? "").trim();
      const driverPhone = String(cells[phoneIdx] ?? "").trim();
      const rentalType = normalizeRentalType(String(cells[typeIdx] ?? ""));
      const startDate = normalizeDateInput(String(cells[startIdx] ?? ""));
      const endDate = normalizeDateInput(String(cells[endIdx] ?? ""));

      if (!vehiclePlate || !driverPhone || !rentalType || !startDate || !endDate) {
        failed.push({
          row: rowNum,
          message: "Invalid row values (vehicle_plate, driver_phone, rental_type, start_date, end_date required)",
          vehiclePlate,
          driverPhone,
        });
        continue;
      }
      if (startDate > endDate) {
        failed.push({
          row: rowNum,
          message: "start_date must be on or before end_date",
          vehiclePlate,
          driverPhone,
        });
        continue;
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const { rows: vehicleRows } = await client.query<{
          id: string;
          status: string;
          daily_rent: string | null;
          weekly_rent: string | null;
          monthly_rent: string | null;
        }>(
          "SELECT id, status, daily_rent, weekly_rent, monthly_rent FROM vehicles WHERE organization_id = $1 AND license_plate = $2 LIMIT 1",
          [orgId, vehiclePlate],
        );
        const vehicle = vehicleRows[0];
        if (!vehicle) {
          await client.query("ROLLBACK");
          failed.push({ row: rowNum, message: "Vehicle not found", vehiclePlate, driverPhone });
          continue;
        }
        if (vehicle.status === "rented") {
          await client.query("ROLLBACK");
          failed.push({ row: rowNum, message: "Vehicle is already rented", vehiclePlate, driverPhone });
          continue;
        }

        const { rows: driverRows } = await client.query<{ id: string }>(
          "SELECT id FROM drivers WHERE organization_id = $1 AND phone = $2 AND (is_deleted = false OR is_deleted IS NULL) LIMIT 1",
          [orgId, driverPhone],
        );
        const driver = driverRows[0];
        if (!driver) {
          await client.query("ROLLBACK");
          failed.push({ row: rowNum, message: "Driver not found", vehiclePlate, driverPhone });
          continue;
        }

        const { rows: activeForDriver } = await client.query<{ id: string }>(
          "SELECT id FROM vehicle_rentals WHERE organization_id = $1 AND driver_id = $2 AND status = 'active' LIMIT 1",
          [orgId, driver.id],
        );
        if (activeForDriver[0]) {
          await client.query("ROLLBACK");
          failed.push({ row: rowNum, message: "Driver already has an active rental", vehiclePlate, driverPhone });
          continue;
        }

        const days = rentalDaysInclusive(startDate, endDate);
        const rate =
          rentalType === "weekly"
            ? toNumber(vehicle.weekly_rent) / 7
            : rentalType === "monthly"
              ? toNumber(vehicle.monthly_rent) / 30
              : toNumber(vehicle.daily_rent);
        const totalRentAmount = Math.max(0, Math.round((rate * days + Number.EPSILON) * 100) / 100);

        await client.query(
          `
          INSERT INTO vehicle_rentals (
            vehicle_id, driver_id, organization_id, rental_start_date, rental_end_date,
            rental_type, total_rent_amount, deposit_amount, deposit_status, deposit_deduction_amount,
            payment_status, status, notes, created_by
          )
          VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, 0, NULL, 0,
            'pending', 'active', $8, $9
          )
          `,
          [
            vehicle.id,
            driver.id,
            orgId,
            startDate,
            endDate,
            rentalType,
            totalRentAmount,
            `Imported via CSV (${req.file.originalname}, row ${rowNum})`,
            userId,
          ],
        );

        await client.query(
          "UPDATE vehicles SET status = 'rented', current_driver_id = $1, updated_at = NOW() WHERE id = $2 AND organization_id = $3",
          [driver.id, vehicle.id, orgId],
        );
        await client.query(
          "UPDATE drivers SET current_vehicle_id = $1, updated_at = NOW() WHERE id = $2 AND organization_id = $3",
          [vehicle.id, driver.id, orgId],
        );

        await client.query("COMMIT");
        created += 1;
      } catch {
        try {
          await client.query("ROLLBACK");
        } catch {
          // ignore rollback errors
        }
        failed.push({ row: rowNum, message: "Failed to create rental", vehiclePlate, driverPhone });
      } finally {
        client.release();
      }
    }

    return res.json({
      totalRows: table.rows.length,
      created,
      failed,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Rental import failed";
    console.error("Rental CSV import error", err);
    return res.status(400).json({ message: msg });
  }
});

export const importEarningsCsvRoutes = router;
