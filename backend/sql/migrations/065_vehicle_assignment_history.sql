-- Audit trail for driver–vehicle assignment (payroll still uses drivers.current_vehicle_id only).
BEGIN;

CREATE TABLE IF NOT EXISTS vehicle_assignment_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unassigned_at TIMESTAMPTZ,
  weekly_rent_at_time NUMERIC(12, 2) NOT NULL,
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  unassigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_vehicle_assignment_history_driver
  ON vehicle_assignment_history (driver_id, assigned_at DESC);

CREATE INDEX IF NOT EXISTS idx_vehicle_assignment_history_vehicle
  ON vehicle_assignment_history (vehicle_id, assigned_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_assignment_history_driver_open
  ON vehicle_assignment_history (driver_id)
  WHERE unassigned_at IS NULL;

COMMENT ON TABLE vehicle_assignment_history IS
  'Audit-only assignment log; not used for payout calculation.';

COMMIT;
