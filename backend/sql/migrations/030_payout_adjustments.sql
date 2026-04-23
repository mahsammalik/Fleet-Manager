-- Audit trail for manual debt actions (adjust, forgive, cash received, carry-forward trigger logged)

CREATE TABLE IF NOT EXISTS payout_adjustments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    payout_id UUID NOT NULL REFERENCES driver_payouts(id) ON DELETE CASCADE,
    amount NUMERIC(12, 2) NOT NULL,
    reason TEXT,
    adjustment_type VARCHAR(32) NOT NULL
        CHECK (adjustment_type IN ('adjust', 'forgive', 'cash_received', 'carry_forward')),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payout_adjustments_org_payout
    ON payout_adjustments (organization_id, payout_id);

CREATE INDEX IF NOT EXISTS idx_payout_adjustments_org_created
    ON payout_adjustments (organization_id, created_at DESC);
