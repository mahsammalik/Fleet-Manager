-- Migration 051 added calculate_rental_fee(..., boolean DEFAULT false). The legacy
-- 4-argument function from migration 047 remains a separate overload, so calls with
-- four arguments error with: function calculate_rental_fee(uuid, uuid, date, date) is not unique (42725).
-- Keep only the 5-argument implementation; four-argument calls then resolve via the default fifth argument.
DROP FUNCTION IF EXISTS calculate_rental_fee(uuid, uuid, date, date);
