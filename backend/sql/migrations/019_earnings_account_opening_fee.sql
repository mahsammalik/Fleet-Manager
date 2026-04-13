-- Track "Taxa deschidere cont" per earnings row (informational only; TVT remains net of this fee).
ALTER TABLE earnings_records
  ADD COLUMN IF NOT EXISTS account_opening_fee NUMERIC(10, 2);
