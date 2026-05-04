-- Track last mutation time on payout rows (e.g. manual debt adjust).

ALTER TABLE driver_payouts
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

COMMENT ON COLUMN driver_payouts.updated_at IS 'Last time this payout row was updated (application-maintained).';
