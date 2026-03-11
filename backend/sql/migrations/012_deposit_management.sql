-- Migration: Deposit management for vehicle rentals
-- Adds deposit lifecycle fields to vehicle_rentals and introduces deposit_transactions ledger.

-- Add deposit columns to vehicle_rentals
ALTER TABLE vehicle_rentals
ADD COLUMN IF NOT EXISTS deposit_amount DECIMAL(10, 2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS deposit_status VARCHAR(50) DEFAULT 'pending'
    CHECK (deposit_status IN ('pending', 'paid', 'refunded', 'partial')),
ADD COLUMN IF NOT EXISTS deposit_paid_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS deposit_refunded_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS deposit_deduction_amount DECIMAL(10, 2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS deposit_deduction_reason TEXT;

-- Deposit transactions table
CREATE TABLE IF NOT EXISTS deposit_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rental_id UUID REFERENCES vehicle_rentals(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    transaction_type VARCHAR(50) NOT NULL
        CHECK (transaction_type IN ('payment', 'refund', 'deduction')),
    amount DECIMAL(10, 2) NOT NULL,
    payment_method VARCHAR(50) DEFAULT 'cash',
    payment_status VARCHAR(50) DEFAULT 'completed'
        CHECK (payment_status IN ('pending', 'completed', 'failed')),
    transaction_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for deposit_transactions
CREATE INDEX IF NOT EXISTS idx_deposit_transactions_rental ON deposit_transactions(rental_id);
CREATE INDEX IF NOT EXISTS idx_deposit_transactions_status ON deposit_transactions(payment_status);
CREATE INDEX IF NOT EXISTS idx_deposit_transactions_date ON deposit_transactions(transaction_date);

