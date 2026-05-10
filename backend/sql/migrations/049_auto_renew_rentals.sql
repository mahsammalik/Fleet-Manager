ALTER TABLE vehicle_rentals
ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS auto_renew_interval INTEGER DEFAULT 7,
ADD COLUMN IF NOT EXISTS max_renewal_date DATE,
ADD COLUMN IF NOT EXISTS renewed_from_id UUID REFERENCES vehicle_rentals(id);

CREATE INDEX IF NOT EXISTS idx_vehicle_rentals_renewal
ON vehicle_rentals(rental_end_date, is_recurring, status)
WHERE is_recurring = true AND status = 'active';
