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
    DATE_TRUNC('month', er.created_at) as month,
    SUM(er.gross_earnings) as total_earnings,
    SUM(er.platform_fee) as total_platform_fees,
    SUM(er.net_earnings) as total_net_earnings,
    SUM(er.company_commission) as total_commission,
    SUM(er.driver_payout) as total_driver_payout
FROM earnings_records er
JOIN drivers d ON er.driver_id = d.id
WHERE d.organization_id = (SELECT id FROM organizations LIMIT 1)
GROUP BY DATE_TRUNC('month', er.created_at)
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