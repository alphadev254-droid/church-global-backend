import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/password';

const prisma = new PrismaClient();

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
  { name: 'churches:invite', resource: 'churches', action: 'invite' },
  { name: 'communication:read', resource: 'communication', action: 'read' },
  { name: 'communication:create', resource: 'communication', action: 'create' },
  { name: 'communication:update', resource: 'communication', action: 'update' },
  { name: 'communication:delete', resource: 'communication', action: 'delete' },
  { name: 'resources:read', resource: 'resources', action: 'read' },
  { name: 'resources:create', resource: 'resources', action: 'create' },
  { name: 'reports:read', resource: 'reports', action: 'read' },
  { name: 'reports:create', resource: 'reports', action: 'create' },
  { name: 'reports:update', resource: 'reports', action: 'update' },
  { name: 'reports:delete', resource: 'reports', action: 'delete' },
  { name: 'performance:read', resource: 'performance', action: 'read' },
  { name: 'settings:read', resource: 'settings', action: 'read' },
  { name: 'settings:update', resource: 'settings', action: 'update' },
  { name: 'users:read', resource: 'users', action: 'read' },
  { name: 'users:create', resource: 'users', action: 'create' },
  { name: 'users:update', resource: 'users', action: 'update' },
  { name: 'users:delete', resource: 'users', action: 'delete' },
  { name: 'roles:read', resource: 'roles', action: 'read' },
  { name: 'roles:assign', resource: 'roles', action: 'assign' },
  { name: 'roles:manage', resource: 'roles', action: 'manage' },
  { name: 'packages:read', resource: 'packages', action: 'read' },
  { name: 'packages:manage', resource: 'packages', action: 'manage' },
  { name: 'packages:view', resource: 'packages', action: 'view' },
  { name: 'packages:update', resource: 'packages', action: 'update' },
  { name: 'system_payments:view', resource: 'system_payments', action: 'view' },
  { name: 'payments:read', resource: 'payments', action: 'read' },
  { name: 'payments:create', resource: 'payments', action: 'create' },
  { name: 'payments:pay', resource: 'payments', action: 'pay' },
  { name: 'transactions:read', resource: 'transactions', action: 'read' },
  { name: 'transactions:create', resource: 'transactions', action: 'create' },
  { name: 'transactions:update', resource: 'transactions', action: 'update' },
  { name: 'transactions:delete', resource: 'transactions', action: 'delete' },
  { name: 'withdrawals:read', resource: 'withdrawals', action: 'read' },
  { name: 'withdrawals:create', resource: 'withdrawals', action: 'create' },
  { name: 'tickets:read', resource: 'tickets', action: 'read' },
  { name: 'tickets:create', resource: 'tickets', action: 'create' },
  { name: 'tickets:cancel', resource: 'tickets', action: 'cancel' },
  { name: 'subaccounts:create', resource: 'subaccounts', action: 'create' },
  { name: 'subaccounts:view', resource: 'subaccounts', action: 'view' },
  { name: 'subaccounts:update', resource: 'subaccounts', action: 'update' },
  { name: 'campaigns:read', resource: 'campaigns', action: 'read' },
  { name: 'campaigns:create', resource: 'campaigns', action: 'create' },
  { name: 'campaigns:update', resource: 'campaigns', action: 'update' },
  { name: 'campaigns:delete', resource: 'campaigns', action: 'delete' },
  { name: 'donations:read', resource: 'donations', action: 'read' },
  { name: 'donations:create', resource: 'donations', action: 'create' },
  { name: 'teams:read', resource: 'teams', action: 'read' },
  { name: 'teams:create', resource: 'teams', action: 'create' },
  { name: 'teams:update', resource: 'teams', action: 'update' },
  { name: 'teams:delete', resource: 'teams', action: 'delete' },
  { name: 'teams:assign', resource: 'teams', action: 'assign' },
  { name: 'reminders:read', resource: 'reminders', action: 'read' },
];

const ROLES = [
  { name: 'ministry_admin', displayName: 'Ministry Administrator' },
  { name: 'regional_admin', displayName: 'Regional Administrator' },
  { name: 'district_admin', displayName: 'District Administrator' },
  { name: 'branch_admin', displayName: 'Branch Administrator' },
  { name: 'member', displayName: 'Member' },
];

const MEMBER_PERMISSIONS = [
  'dashboard:read',
  'events:read',
  'giving:read',
  'giving:create',
  'communication:read',
  'communication:create',
  'communication:update',
  'communication:delete',
  'resources:read',
  'transactions:read',
  'payments:pay',
  'tickets:read',
  'campaigns:read',
  'donations:create',
  'donations:read',
  'settings:read',
  'packages:view',
  'teams:read',
  'reminders:read',
];

async function main() {
  console.log('🌱 Starting database seed...\n');

  // 1. Create Permissions
  console.log('📋 Creating permissions...');
  for (const perm of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { name: perm.name },
      update: {},
      create: perm,
    });
  }
  console.log(`✅ Created ${PERMISSIONS.length} permissions\n`);

  // 2. Create Roles
  console.log('👥 Creating roles...');
  for (const role of ROLES) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: {},
      create: role,
    });
  }
  console.log(`✅ Created ${ROLES.length} roles\n`);

  // 3. Create admin user if not exists
  console.log('👤 Creating admin user...');
  const ministryAdminRole = await prisma.role.findUnique({
    where: { name: 'ministry_admin' },
  });

  if (!ministryAdminRole) {
    throw new Error('Ministry admin role not found');
  }

  let adminUser = await prisma.user.findUnique({
    where: { email: 'admin@icims.org' },
  });

  if (!adminUser) {
    const hashedPassword = await hashPassword('Admin@1234');
    adminUser = await prisma.user.create({
      data: {
        email: 'admin@icims.org',
        password: hashedPassword,
        firstName: 'Admin',
        lastName: 'User',
        roleId: ministryAdminRole.id,
      },
    });
    console.log('✅ Created admin user: admin@icims.org\n');
  } else {
    console.log('✅ Admin user already exists: admin@icims.org\n');
  }

  // 4. Link ALL permissions to ministry_admin role (global)
  console.log('🔗 Linking all permissions to ministry_admin role (global)...');
  const allPermissions = await prisma.permission.findMany();
  
  let linked = 0;
  for (const permission of allPermissions) {
    try {
      await prisma.rolePermission.create({
        data: {
          ministryAdminId: 'GLOBAL',
          roleId: ministryAdminRole.id,
          permissionId: permission.id,
        },
      });
      linked++;
    } catch (e) {
      console.log(`Skipping duplicate: ${permission.name}`);
    }
  }

  console.log(`✅ Linked ${linked} permissions to ministry_admin\n`);

  // 5. Assign member permissions to member role (global)
  console.log('🔗 Assigning member permissions to member role (global)...');
  const memberRole = await prisma.role.findUnique({ where: { name: 'member' } });
  
  if (memberRole) {
    const memberPerms = await prisma.permission.findMany({
      where: { name: { in: MEMBER_PERMISSIONS } },
    });
    
    let memberLinked = 0;
    for (const permission of memberPerms) {
      try {
        await prisma.rolePermission.create({
          data: {
            ministryAdminId: 'GLOBAL',
            roleId: memberRole.id,
            permissionId: permission.id,
          },
        });
        memberLinked++;
      } catch (e) {
        console.log(`Skipping duplicate: ${permission.name}`);
      }
    }
    console.log(`✅ Linked ${memberLinked} permissions to member role\n`);
  }

  console.log('🎉 Database seeded successfully!\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📝 Login Credentials:');
  console.log('   Email:    admin@icims.org');
  console.log('   Password: Admin@1234');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
