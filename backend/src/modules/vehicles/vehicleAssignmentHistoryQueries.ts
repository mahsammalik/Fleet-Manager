import type { Request } from "express";
import { query } from "../../db/pool";

export type AssignmentHistoryFilters = {
  status: "all" | "active" | "returned";
  from: string | null;
  to: string | null;
  q: string | null;
};

export function parseAssignmentHistoryFilters(req: Request): AssignmentHistoryFilters {
  const statusRaw = typeof req.query.status === "string" ? req.query.status.trim().toLowerCase() : "all";
  const status =
    statusRaw === "active" || statusRaw === "returned" ? statusRaw : "all";

  const from =
    typeof req.query.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from.slice(0, 10))
      ? req.query.from.slice(0, 10)
      : null;
  const to =
    typeof req.query.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to.slice(0, 10))
      ? req.query.to.slice(0, 10)
      : null;

  const q = typeof req.query.q === "string" && req.query.q.trim() ? req.query.q.trim() : null;

  return { status, from, to, q };
}

function appendFilterClauses(
  filters: AssignmentHistoryFilters,
  params: unknown[],
  conditions: string[],
): void {
  if (filters.status === "active") {
    conditions.push("h.unassigned_at IS NULL");
  } else if (filters.status === "returned") {
    conditions.push("h.unassigned_at IS NOT NULL");
  }

  if (filters.from) {
    params.push(filters.from);
    conditions.push(`h.assigned_at::date >= $${params.length}::date`);
  }
  if (filters.to) {
    params.push(filters.to);
    conditions.push(`h.assigned_at::date <= $${params.length}::date`);
  }

  if (filters.q) {
    params.push(`%${filters.q}%`);
    const p = params.length;
    conditions.push(`(
      TRIM(COALESCE(d.first_name, '') || ' ' || COALESCE(d.last_name, '')) ILIKE $${p}
      OR COALESCE(d.phone, '') ILIKE $${p}
      OR COALESCE(v.license_plate, '') ILIKE $${p}
      OR COALESCE(v.make, '') ILIKE $${p}
      OR COALESCE(v.model, '') ILIKE $${p}
    )`);
  }
}

const BASE_SELECT = `
  h.id::text,
  h.driver_id::text,
  h.vehicle_id::text,
  h.assigned_at::text,
  h.unassigned_at::text,
  h.weekly_rent_at_time::text,
  h.notes,
  TRIM(COALESCE(v.make, '') || ' ' || COALESCE(v.model, '')) AS vehicle_name,
  v.license_plate,
  v.make,
  v.model,
  TRIM(COALESCE(d.first_name, '') || ' ' || COALESCE(d.last_name, '')) AS driver_name,
  d.phone::text AS driver_phone,
  GREATEST(
    1,
    (COALESCE(h.unassigned_at::date, CURRENT_DATE) - h.assigned_at::date + 1)
  )::int AS days_held,
  (
    SELECT ROUND(COALESCE(SUM(dp.vehicle_rental_fee), 0)::numeric, 2)
    FROM driver_payouts dp
    WHERE dp.organization_id = $2::uuid
      AND dp.driver_id = h.driver_id
      AND dp.payment_period_start <= COALESCE(h.unassigned_at::date, CURRENT_DATE)
      AND dp.payment_period_end >= h.assigned_at::date
  )::text AS total_rent_paid,
  TRIM(COALESCE(ua.first_name, '') || ' ' || COALESCE(ua.last_name, '')) AS assigned_by_name,
  TRIM(COALESCE(uu.first_name, '') || ' ' || COALESCE(uu.last_name, '')) AS unassigned_by_name,
  (h.unassigned_at IS NULL) AS is_active`;

export async function listAssignmentHistoryByDriver(
  orgId: string,
  driverId: string,
  filters: AssignmentHistoryFilters,
) {
  const params: unknown[] = [driverId, orgId];
  const conditions = ["h.driver_id = $1::uuid", "d.organization_id = $2::uuid"];
  appendFilterClauses(filters, params, conditions);

  const { rows } = await query(
    `SELECT ${BASE_SELECT}
     FROM vehicle_assignment_history h
     INNER JOIN drivers d ON d.id = h.driver_id AND d.organization_id = $2::uuid
     INNER JOIN vehicles v ON v.id = h.vehicle_id AND v.organization_id = $2::uuid
     LEFT JOIN users ua ON ua.id = h.assigned_by
     LEFT JOIN users uu ON uu.id = h.unassigned_by
     WHERE ${conditions.join(" AND ")}
     ORDER BY h.assigned_at DESC
     LIMIT 200`,
    params,
  );
  return rows;
}

export async function listAssignmentHistoryByVehicle(
  orgId: string,
  vehicleId: string,
  filters: AssignmentHistoryFilters,
) {
  const params: unknown[] = [vehicleId, orgId];
  const conditions = ["h.vehicle_id = $1::uuid", "d.organization_id = $2::uuid"];
  appendFilterClauses(filters, params, conditions);

  const { rows } = await query(
    `SELECT ${BASE_SELECT}
     FROM vehicle_assignment_history h
     INNER JOIN drivers d ON d.id = h.driver_id AND d.organization_id = $2::uuid
     INNER JOIN vehicles v ON v.id = h.vehicle_id AND v.organization_id = $2::uuid
     LEFT JOIN users ua ON ua.id = h.assigned_by
     LEFT JOIN users uu ON uu.id = h.unassigned_by
     WHERE ${conditions.join(" AND ")}
     ORDER BY h.assigned_at DESC
     LIMIT 200`,
    params,
  );
  return rows;
}

export async function listRecentAssignments(orgId: string, limit: number) {
  const safeLimit = Math.min(Math.max(limit, 1), 50);
  const { rows } = await query(
    `SELECT h.id::text,
            h.driver_id::text,
            h.vehicle_id::text,
            h.assigned_at::text,
            h.unassigned_at::text,
            h.weekly_rent_at_time::text,
            TRIM(COALESCE(d.first_name, '') || ' ' || COALESCE(d.last_name, '')) AS driver_name,
            v.license_plate,
            TRIM(COALESCE(v.make, '') || ' ' || COALESCE(v.model, '')) AS vehicle_name,
            (h.unassigned_at IS NULL) AS is_active,
            GREATEST(h.assigned_at, COALESCE(h.unassigned_at, h.assigned_at))::text AS sort_at
     FROM vehicle_assignment_history h
     INNER JOIN drivers d ON d.id = h.driver_id AND d.organization_id = $1::uuid
     INNER JOIN vehicles v ON v.id = h.vehicle_id AND v.organization_id = $1::uuid
     ORDER BY sort_at DESC
     LIMIT $2::int`,
    [orgId, safeLimit],
  );
  return rows;
}
