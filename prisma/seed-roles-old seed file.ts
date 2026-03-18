import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// All available permissions
const PERMISSIONS = [
  { name: 'dashboard:read', resource: 'dashboard', action: 'read' },
  { name: 'members:read', resource: 'members', action: 'read' },
  { name: 'members:create', resource: 'members', action: 'create' },
  { name: 'members:update', resource: 'members', action: 'update' },
  { name: 'members:delete', resource: 'members', action: 'delete' },
  { name: 'events:read', resource: 'events', action: 'read' },
  { name: 'events:create', resource: 'events', action: 'create' },
  { name: 'events:update', resource: 'events', action: 'update' },
  { name: 'events:delete', resource: 'events', action: 'delete' },
  { name: 'giving:read', resource: 'giving', action: 'read' },
  { name: 'giving:create', resource: 'giving', action: 'create' },
  { name: 'giving:update', resource: 'giving', action: 'update' },
  { name: 'giving:delete', resource: 'giving', action: 'delete' },
  { name: 'attendance:read', resource: 'attendance', action: 'read' },
  { name: 'attendance:create', resource: 'attendance', action: 'create' },
  { name: 'attendance:update', resource: 'attendance', action: 'update' },
  { name: 'attendance:delete', resource: 'attendance', action: 'delete' },
  { name: 'churches:read', resource: 'churches', action: 'read' },
  { name: 'churches:create', resource: 'churches', action: 'create' },
  { name: 'churches:update', resource: 'churches', action: 'update' },
  { name: 'churches:delete', resource: 'churches', action: 'delete' },
  { name: 'communication:read', resource: 'communication', action: 'read' },
  { name: 'communication:create', resource: 'communication', action: 'create' },
  { name: 'communication:update', resource: 'communication', action: 'update' },
  { name: 'communication:delete', resource: 'communication', action: 'delete' },
  { name: 'resources:read', resource: 'resources', action: 'read' },
  { name: 'resources:create', resource: 'resources', action: 'create' },
  { name: 'reports:read', resource: 'reports', action: 'read' },
  { name: 'performance:read', resource: 'performance', action: 'read' },
  { name: 'settings:read', resource: 'settings', action: 'read' },
  { name: 'settings:update', resource: 'settings', action: 'update' },
  { name: 'users:read', resource: 'users', action: 'read' },
  { name: 'users:create', resource: 'users', action: 'create' },
  { name: 'users:update', resource: 'users', action: 'update' },
  { name: 'users:delete', resource: 'users', action: 'delete' },
  { name: 'transactions:read', resource: 'transactions', action: 'read' },
  { name: 'transactions:create', resource: 'transactions', action: 'create' },
  { name: 'roles:read', resource: 'roles', action: 'read' },
  { name: 'roles:assign', resource: 'roles', action: 'assign' },
  { name: 'roles:manage', resource: 'roles', action: 'manage' },
  { name: 'packages:read', resource: 'packages', action: 'read' },
  { name: 'packages:manage', resource: 'packages', action: 'manage' },
  { name: 'payments:read', resource: 'payments', action: 'read' },
  { name: 'payments:create', resource: 'payments', action: 'create' },
];

// Global roles
const ROLES = [
  { name: 'national_admin', displayName: 'National Administrator' },
  { name: 'regional_leader', displayName: 'Regional Leader' },
  { name: 'district_overseer', displayName: 'District Overseer' },
  { name: 'local_admin', displayName: 'Local Administrator' },
  { name: 'member', displayName: 'Member' },
];

// Default role-permission mappings (will be created for each national admin)
const ROLE_PERMISSIONS_MAP: Record<string, string[]> = {
  national_admin: PERMISSIONS.map(p => p.name), // All permissions
  regional_leader: [
    'dashboard:read', 'members:read', 'members:create', 'members:update',
    'events:read', 'events:create', 'events:update',
    'giving:read', 'attendance:read', 'attendance:create',
    'churches:read', 'churches:update',
    'communication:read', 'communication:create',
    'resources:read', 'resources:create',
    'reports:read', 'performance:read',
  ],
  district_overseer: [
    'dashboard:read', 'members:read', 'members:create', 'members:update',
    'events:read', 'events:create', 'events:update',
    'giving:read', 'attendance:read', 'attendance:create',
    'churches:read',
    'communication:read', 'communication:create',
    'resources:read',
    'reports:read',
  ],
  local_admin: [
    'dashboard:read', 'members:read', 'members:create', 'members:update',
    'events:read', 'events:create', 'events:update',
    'giving:read', 'giving:create',
    'attendance:read', 'attendance:create',
    'communication:read', 'communication:create',
    'resources:read',
    'reports:read',
  ],
  member: [
    'dashboard:read',
    'events:read',
    'giving:read', 'giving:create',
    'communication:read',
    'resources:read',
    'transactions:read',
    'settings:read',
  ],
};

async function main() {
  console.log('🌱 Seeding roles and permissions...');

  // 1. Create all permissions
  console.log('Creating permissions...');
  for (const perm of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { name: perm.name },
      update: {},
      create: perm,
    });
  }
  console.log(`✅ Created ${PERMISSIONS.length} permissions`);

  // 2. Create all roles
  console.log('Creating roles...');
  for (const role of ROLES) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: {},
      create: role,
    });
  }
  console.log(`✅ Created ${ROLES.length} roles`);

  console.log('✅ Roles and permissions seeded successfully!');
  console.log('Note: Role-permission mappings will be created per national admin user');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

export { ROLE_PERMISSIONS_MAP };
