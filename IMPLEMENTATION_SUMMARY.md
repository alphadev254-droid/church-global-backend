# Global Roles & Permissions Implementation Summary

## Changes Made

### 1. Schema Changes (`prisma/schema.prisma`)
- ✅ Removed `roleName` string field from User model
- ✅ User now uses `roleId` (FK to Role table)
- ✅ Added proper relations: User → Role → RolePermission → Permission
- ✅ RolePermission includes `nationalAdminId` for tenant isolation

### 2. Seed Script (`prisma/seed-roles.ts`)
- ✅ Creates 41 global permissions
- ✅ Creates 5 global roles
- ✅ Exports default role-permission mappings
- ✅ Run with: `npm run db:seed-roles`

### 3. Auth Controller (`src/controllers/authController.ts`)
- ✅ Updated to use `roleId` instead of `roleName`
- ✅ Fetches permissions from database via role relations
- ✅ Creates default role-permission mappings on registration
- ✅ Returns `roleName` in response for backward compatibility

### 4. Key Functions

#### `extractPermissions(user)`
- Fetches permissions from `user.role.permissions`
- Returns array of permission names

#### `createDefaultRolePermissions(nationalAdminId)`
- Creates role-permission mappings for all 5 roles
- Called automatically during user registration
- Ensures each national admin has their own permission set

#### `safeUser(user)`
- Strips password
- Adds `roleName` from `user.role.name`
- Adds `permissions` array
- Parses JSON geographic scopes

## Data Flow

### Login
```
1. Find user with email
2. Include: role → permissions → permission
3. Extract permission names
4. Sign JWT with role.name and permissions
5. Return user with roleName and permissions
```

### Registration
```
1. Find national_admin role
2. Create user with roleId
3. Call createDefaultRolePermissions()
4. Refetch user with permissions
5. Sign JWT and return
```

### Permission Check
```
User → Role → RolePermission (filtered by nationalAdminId) → Permission
```

## Migration Commands

```bash
# 1. Generate Prisma client
npm run db:generate

# 2. Push schema changes
npm run db:push

# 3. Seed roles and permissions
npm run db:seed-roles

# 4. Start server
npm run dev
```

## Testing Checklist

- [ ] Register new user → should get national_admin role
- [ ] Login → should receive permissions array
- [ ] Create user → should be able to assign roles
- [ ] Role permissions → should be fetched from database
- [ ] Tenant isolation → each national admin has separate role-permissions

## Next Steps

1. Update user management controller to work with roleId
2. Update roles management to allow permission customization
3. Update frontend to use roleName from API response
4. Test all permission-based features
