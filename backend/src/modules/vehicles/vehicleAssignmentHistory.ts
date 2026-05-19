import type { QueryResultRow } from "pg";
import { query as poolQuery } from "../../db/pool";

type Db = {
  query: <T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ) => Promise<{ rows: T[] }>;
};

export type CloseVehicleAssignmentParams = {
  driverId: string;
  unassignedBy?: string | null;
  notes?: string | null;
};

export type RecordVehicleAssignmentParams = {
  driverId: string;
  vehicleId: string;
  orgId: string;
  assignedBy?: string | null;
  notes?: string | null;
};

/** Close the open assignment row for a driver (no-op if none). */
export async function closeOpenVehicleAssignment(
  db: Db,
  params: CloseVehicleAssignmentParams,
): Promise<void> {
  const { driverId, unassignedBy, notes } = params;
  await db.query(
    `UPDATE vehicle_assignment_history
     SET unassigned_at = NOW(),
         unassigned_by = COALESCE($2::uuid, unassigned_by),
         notes = CASE
           WHEN $3::text IS NOT NULL AND TRIM($3::text) <> ''
             THEN TRIM(BOTH ' | ' FROM CONCAT(COALESCE(notes, ''), CASE WHEN notes IS NULL OR notes = '' THEN '' ELSE ' | ' END, $3::text))
           ELSE notes
         END
     WHERE driver_id = $1::uuid
       AND unassigned_at IS NULL`,
    [driverId, unassignedBy ?? null, notes ?? null],
  );
}

/** Close open assignments for all drivers currently linked to a vehicle. */
export async function closeOpenAssignmentsForVehicle(
  db: Db,
  params: { vehicleId: string; orgId: string; unassignedBy?: string | null; notes?: string | null },
): Promise<void> {
  const { rows } = await db.query<{ driver_id: string }>(
    `SELECT id::text AS driver_id
     FROM drivers
     WHERE organization_id = $2::uuid
       AND current_vehicle_id = $1::uuid`,
    [params.vehicleId, params.orgId],
  );
  for (const row of rows) {
    await closeOpenVehicleAssignment(db, {
      driverId: row.driver_id,
      unassignedBy: params.unassignedBy,
      notes: params.notes,
    });
  }
}

/** Record a new assignment; closes any other open row for the driver first. */
export async function recordVehicleAssignment(
  db: Db,
  params: RecordVehicleAssignmentParams,
): Promise<void> {
  const { driverId, vehicleId, orgId, assignedBy, notes } = params;

  const openRes = await db.query<{ vehicle_id: string }>(
    `SELECT vehicle_id::text
     FROM vehicle_assignment_history
     WHERE driver_id = $1::uuid
       AND unassigned_at IS NULL
     LIMIT 1`,
    [driverId],
  );
  if (openRes.rows[0]?.vehicle_id === vehicleId) {
    return;
  }

  const vehicleRes = await db.query<{ weekly_rent: string | null }>(
    `SELECT weekly_rent::text
     FROM vehicles
     WHERE id = $1::uuid AND organization_id = $2::uuid`,
    [vehicleId, orgId],
  );
  if (!vehicleRes.rows[0]) {
    return;
  }

  const weeklyRent = Math.round((Number(vehicleRes.rows[0].weekly_rent ?? 0) || 0) * 100) / 100;

  await closeOpenVehicleAssignment(db, { driverId, unassignedBy: assignedBy, notes: "Reassigned to another vehicle" });

  await db.query(
    `INSERT INTO vehicle_assignment_history (
       driver_id, vehicle_id, weekly_rent_at_time, assigned_by, notes
     ) VALUES ($1::uuid, $2::uuid, $3::numeric, $4::uuid, $5)`,
    [driverId, vehicleId, weeklyRent, assignedBy ?? null, notes ?? null],
  );
}

const poolDb: Db = {
  query: (text, params) => poolQuery(text, params),
};

/** Convenience for routes that use the shared pool without a transaction. */
export async function closeOpenVehicleAssignmentQuery(params: CloseVehicleAssignmentParams): Promise<void> {
  await closeOpenVehicleAssignment(poolDb, params);
}

export async function recordVehicleAssignmentQuery(params: RecordVehicleAssignmentParams): Promise<void> {
  await recordVehicleAssignment(poolDb, params);
}

export async function closeOpenAssignmentsForVehicleQuery(
  params: { vehicleId: string; orgId: string; unassignedBy?: string | null; notes?: string | null },
): Promise<void> {
  await closeOpenAssignmentsForVehicle(poolDb, params);
}
