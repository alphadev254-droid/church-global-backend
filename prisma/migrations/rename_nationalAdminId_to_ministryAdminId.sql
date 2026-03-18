-- ============================================================================
-- Column Rename Migration Script: nationalAdminId -> ministryAdminId
-- ============================================================================
-- Run this in phpMyAdmin SQL tab
-- ============================================================================

-- 1. Update role_permissions table
ALTER TABLE role_permissions 
CHANGE COLUMN nationalAdminId ministryAdminId VARCHAR(191) NOT NULL DEFAULT 'GLOBAL';

-- 2. Update users table
ALTER TABLE users 
CHANGE COLUMN nationalAdminId ministryAdminId VARCHAR(191) NULL;

-- 3. Update churches table
ALTER TABLE churches 
CHANGE COLUMN nationalAdminId ministryAdminId VARCHAR(191) NULL;

-- 4. Update subaccounts table
ALTER TABLE subaccounts 
CHANGE COLUMN nationalAdminId ministryAdminId VARCHAR(191) NOT NULL;

-- 5. Update subscriptions table
ALTER TABLE subscriptions 
CHANGE COLUMN nationalAdminId ministryAdminId VARCHAR(191) NOT NULL;

-- 6. Update payments table
ALTER TABLE payments 
CHANGE COLUMN nationalAdminId ministryAdminId VARCHAR(191) NOT NULL;

-- 7. Update wallets table
ALTER TABLE wallets 
CHANGE COLUMN nationalAdminId ministryAdminId VARCHAR(191) NOT NULL;

-- 8. Update withdrawals table
ALTER TABLE withdrawals 
CHANGE COLUMN nationalAdminId ministryAdminId VARCHAR(191) NOT NULL;

-- 9. Update kpis table
ALTER TABLE kpis 
CHANGE COLUMN nationalAdminId ministryAdminId VARCHAR(191) NOT NULL;

-- 10. Update reminder_cache table
ALTER TABLE reminder_cache 
CHANGE COLUMN nationalAdminId ministryAdminId VARCHAR(191) NULL;

-- ============================================================================
-- Verify the changes
-- ============================================================================

-- Check all tables to confirm column rename
SELECT 'role_permissions' as table_name, COUNT(*) as count FROM role_permissions WHERE ministryAdminId IS NOT NULL
UNION ALL
SELECT 'users', COUNT(*) FROM users WHERE ministryAdminId IS NOT NULL
UNION ALL
SELECT 'churches', COUNT(*) FROM churches WHERE ministryAdminId IS NOT NULL
UNION ALL
SELECT 'subaccounts', COUNT(*) FROM subaccounts WHERE ministryAdminId IS NOT NULL
UNION ALL
SELECT 'subscriptions', COUNT(*) FROM subscriptions WHERE ministryAdminId IS NOT NULL
UNION ALL
SELECT 'payments', COUNT(*) FROM payments WHERE ministryAdminId IS NOT NULL
UNION ALL
SELECT 'wallets', COUNT(*) FROM wallets WHERE ministryAdminId IS NOT NULL
UNION ALL
SELECT 'withdrawals', COUNT(*) FROM withdrawals WHERE ministryAdminId IS NOT NULL
UNION ALL
SELECT 'kpis', COUNT(*) FROM kpis WHERE ministryAdminId IS NOT NULL
UNION ALL
SELECT 'reminder_cache', COUNT(*) FROM reminder_cache WHERE ministryAdminId IS NOT NULL;

-- ============================================================================
-- IMPORTANT: After running this migration, update your Prisma schema file
-- and run: npx prisma db pull
-- Then: npx prisma generate
-- ============================================================================
