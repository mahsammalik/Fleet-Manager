-- Dashboard Statistics View
CREATE VIEW dashboard_stats AS
SELECT 
    (SELECT COUNT(*) FROM drivers WHERE organization_id = (SELECT id FROM organizations LIMIT 1)) as total_drivers,
    (SELECT COUNT(*) FROM drivers WHERE organization_id = (SELECT id FROM organizations LIMIT 1) AND employment_status = 'active') as active_drivers,
    (SELECT COUNT(*) FROM driver_documents WHERE organization_id = (SELECT id FROM organizations LIMIT 1) AND is_verified = false) as pending_documents,
    (SELECT COUNT(*) FROM driver_documents WHERE organization_id = (SELECT id FROM organizations LIMIT 1) AND expiry_date < CURRENT_DATE) as expired_documents,
    (SELECT SUM(commission_rate) FROM drivers WHERE organization_id = (SELECT id FROM organizations LIMIT 1)) as total_commission_rate,
    (SELECT COUNT(*) FROM driver_payments WHERE organization_id = (SELECT id FROM organizations LIMIT 1) AND payment_status = 'pending') as pending_payments;

-- Driver Status Distribution View
CREATE VIEW driver_status_distribution AS
SELECT 
    employment_status,
    COUNT(*) as count
FROM drivers
WHERE organization_id = (SELECT id FROM organizations LIMIT 1)
GROUP BY employment_status;

-- Monthly Earnings View
CREATE VIEW monthly_earnings AS
SELECT 
    DATE_TRUNC('month', created_at) as month,
    SUM(total_gross_earnings) as total_earnings,
    SUM(company_commission) as total_commission
FROM earnings_records
WHERE organization_id = (SELECT id FROM organizations LIMIT 1)
GROUP BY DATE_TRUNC('month', created_at)
ORDER BY month DESC;

-- Document Stats View
CREATE VIEW document_verification_stats AS
SELECT 
    document_type,
    COUNT(*) as total,
    SUM(CASE WHEN is_verified = true THEN 1 ELSE 0 END) as verified,
    SUM(CASE WHEN is_verified = false THEN 1 ELSE 0 END) as pending
FROM driver_documents
WHERE organization_id = (SELECT id FROM organizations LIMIT 1)
GROUP BY document_type;

-- Earnings Records table
CREATE TABLE earnings_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    import_id UUID REFERENCES earnings_imports(id),
    driver_id UUID REFERENCES drivers(id),
    platform VARCHAR(50) NOT NULL,
    trip_date DATE NOT NULL,
    trip_count INTEGER,
    gross_earnings DECIMAL(10, 2),
    platform_fee DECIMAL(10, 2),
    net_earnings DECIMAL(10, 2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Driver Payments table
CREATE TABLE driver_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id),
    driver_id UUID REFERENCES drivers(id),
    payment_period_start DATE NOT NULL,
    payment_period_end DATE NOT NULL,
    total_gross_earnings DECIMAL(12, 2),
    company_commission DECIMAL(10, 2),
    bonuses DECIMAL(10, 2) DEFAULT 0,
    penalties DECIMAL(10, 2) DEFAULT 0,
    adjustments DECIMAL(10, 2) DEFAULT 0,
    net_driver_payout DECIMAL(10, 2),
    payment_status VARCHAR(50) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'approved', 'paid', 'hold')),
    payment_date DATE,
    payment_method VARCHAR(50),
    transaction_ref VARCHAR(100),
    notes TEXT,
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Driver Activities table
CREATE TABLE driver_activities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    driver_id UUID REFERENCES drivers(id) ON DELETE CASCADE,
    activity_type VARCHAR(50) NOT NULL,
    activity_description TEXT,
    performed_by UUID REFERENCES users(id),
    old_values JSONB,
    new_values JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_earnings_records_driver ON earnings_records(driver_id);
CREATE INDEX idx_earnings_records_date ON earnings_records(trip_date);
CREATE INDEX idx_driver_payments_status ON driver_payments(payment_status);
CREATE INDEX idx_driver_activities_driver ON driver_activities(driver_id);
CREATE INDEX idx_driver_activities_created ON driver_activities(created_at DESC);