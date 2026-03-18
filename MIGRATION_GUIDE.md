# Role & Permission System Migration Guide

## Overview
The system now uses a global roles and permissions architecture where:
- **Roles** are global (shared across all tenants)
- **Permissions** are global (seeded once)
- **RolePermission** links roles to permissions per national admin
- **Users** reference roles via `roleId` instead of `roleName` string

## Migration Steps

### 1. Generate Prisma Client
```bash
cd icims-backend
npm run db:generate
```

### 2. Push Schema Changes
```bash
npm run db:push
```

### 3. Seed Roles and Permissions
```bash
npm run db:seed-roles
```

This will create:
- 5 global roles (national_admin, regional_leader, district_overseer, local_admin, member)
- 41 permissions covering all system resources

### 4. Migrate Existing Users (if any)
If you have existing users with `roleName`, run this SQL:

```sql
-- Update existing users to use roleId
UPDATE users u
JOIN roles r ON r.name = u.roleName
SET u.roleId = r.id
WHERE u.roleName IS NOT NULL;

-- Create role-permission mappings for existing national admins
-- This will be done automatically for new registrations
```

### 5. Restart Backend
```bash
npm run dev
```

## How It Works

### Registration Flow
1. User registers → assigned `national_admin` role
2. System creates default role-permission mappings for all 5 roles
3. User can now assign roles to other users with their custom permissions

### Permission Fetching
- Permissions are fetched from database via `role.permissions`
- No hardcoded permission lists in code
- Each national admin can customize role permissions

### Role Assignment
- When creating users, select from available roles
- Permissions are automatically loaded from `role_permissions` table
- Filtered by `nationalAdminId` to ensure tenant isolation

## Database Structure

```
Permission (global)
  ├─ id, name, resource, action
  
Role (global)
  ├─ id, name, displayName
  
RolePermission (per national admin)
  ├─ nationalAdminId (FK → User)
  ├─ roleId (FK → Role)
  ├─ permissionId (FK → Permission)
  
User
  ├─ roleId (FK → Role)
  └─ Fetches permissions via: role.permissions
```

## Benefits
✅ Permissions stored in database (not hardcoded)
✅ Each national admin can customize role permissions
✅ Global roles ensure consistency
✅ Easy to add new permissions
✅ Tenant isolation via nationalAdminId
