import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const FEATURES = [
  // Core Features
  { name: 'members_management', displayName: 'Members Management', category: 'core', sortOrder: 1 },
  { name: 'events_management', displayName: 'Events Management', category: 'core', sortOrder: 2 },
  { name: 'giving_tracking', displayName: 'Giving & Donations', category: 'core', sortOrder: 3 },
  { name: 'attendance_tracking', displayName: 'Attendance Tracking', category: 'core', sortOrder: 4 },
  { name: 'resources_library', displayName: 'Resources Library', category: 'core', sortOrder: 5 },
  { name: 'churches_management', displayName: 'Churches Management', category: 'core', sortOrder: 6 },
  { name: 'transactions_view', displayName: 'Transactions View', category: 'core', sortOrder: 7 },
  
  // Management Features
  { name: 'users_management', displayName: 'Users Management', category: 'management', sortOrder: 8 },
  { name: 'roles_permissions', displayName: 'Roles & Permissions', category: 'management', sortOrder: 9 },
  
  // Communication Features
  { name: 'communication', displayName: 'Communication & Announcements', category: 'communication', sortOrder: 10 },
  { name: 'teams_management', displayName: 'Teams Management', category: 'communication', sortOrder: 11 },
  { name: 'reminders_management', displayName: 'Reminders Management', category: 'communication', sortOrder: 12 },
  
  // Reporting Features
  { name: 'reports_analytics', displayName: 'Reports & Analytics', category: 'reporting', sortOrder: 13 },
  { name: 'performance_dashboard', displayName: 'Performance Dashboard', category: 'reporting', sortOrder: 14 },
  { name: 'advanced_reports', displayName: 'Advanced Reports', category: 'reporting', sortOrder: 15 },
  
  // Event Features
  { name: 'event_ticketing', displayName: 'Event Ticketing', category: 'events', sortOrder: 16 },
  { name: 'event_attendance', displayName: 'Event Attendance Tracking', category: 'events', sortOrder: 17 },
  
  // Limits
  { name: 'max_members', displayName: 'Maximum Members', category: 'limit', sortOrder: 18 },
  { name: 'max_churches', displayName: 'Maximum Churches', category: 'limit', sortOrder: 19 },
  { name: 'max_events_per_month', displayName: 'Maximum Events Per Month', category: 'limit', sortOrder: 20 },
];

const PACKAGES = [
  {
    name: 'basic',
    displayName: 'Basic',
    description: 'Essential features for small churches',
    priceMonthly: 50,
    priceYearly: 500,
    sortOrder: 1,
    features: [
      { name: 'members_management', limit: null },
      { name: 'events_management', limit: null },
      { name: 'giving_tracking', limit: null },
      { name: 'attendance_tracking', limit: null },
      { name: 'churches_management', limit: null },
      { name: 'transactions_view', limit: null },
      { name: 'max_members', limit: 100 },
      { name: 'max_churches', limit: 1 },
      { name: 'max_events_per_month', limit: 10 },
    ]
  },
  {
    name: 'standard',
    displayName: 'Standard',
    description: 'Advanced features for growing churches',
    priceMonthly: 500,
    priceYearly: 5000,
    sortOrder: 2,
    features: [
      { name: 'members_management', limit: null },
      { name: 'events_management', limit: null },
      { name: 'giving_tracking', limit: null },
      { name: 'attendance_tracking', limit: null },
      { name: 'resources_library', limit: null },
      { name: 'churches_management', limit: null },
      { name: 'transactions_view', limit: null },
      { name: 'communication', limit: null },
      { name: 'teams_management', limit: null },
      { name: 'reminders_management', limit: null },
      { name: 'reports_analytics', limit: null },
      { name: 'event_ticketing', limit: null },
      { name: 'event_attendance', limit: null },
      { name: 'max_members', limit: 500 },
      { name: 'max_churches', limit: 5 },
      { name: 'max_events_per_month', limit: 50 },
    ]
  },
  {
    name: 'premium',
    displayName: 'Premium',
    description: 'Complete solution for large church networks',
    priceMonthly: 1000,
    priceYearly: 10000,
    sortOrder: 3,
    features: [
      { name: 'members_management', limit: null },
      { name: 'events_management', limit: null },
      { name: 'giving_tracking', limit: null },
      { name: 'attendance_tracking', limit: null },
      { name: 'resources_library', limit: null },
      { name: 'churches_management', limit: null },
      { name: 'transactions_view', limit: null },
      { name: 'users_management', limit: null },
      { name: 'roles_permissions', limit: null },
      { name: 'communication', limit: null },
      { name: 'teams_management', limit: null },
      { name: 'reminders_management', limit: null },
      { name: 'reports_analytics', limit: null },
      { name: 'performance_dashboard', limit: null },
      { name: 'advanced_reports', limit: null },
      { name: 'event_ticketing', limit: null },
      { name: 'event_attendance', limit: null },
      { name: 'max_members', limit: 999999 },
      { name: 'max_churches', limit: 999 },
      { name: 'max_events_per_month', limit: 999999 },
    ]
  }
];

async function main() {
  console.log('🌱 Seeding packages and features...\n');

  // 1. Create Features
  console.log('📦 Creating package features...');
  for (const feature of FEATURES) {
    await prisma.packageFeature.upsert({
      where: { name: feature.name },
      update: {},
      create: feature,
    });
  }
  console.log(`✅ Created ${FEATURES.length} features\n`);

  // 2. Create Packages
  console.log('📦 Creating packages...');
  for (const pkg of PACKAGES) {
    const { features, ...packageData } = pkg;
    
    const createdPackage = await prisma.package.upsert({
      where: { name: pkg.name },
      update: packageData,
      create: packageData,
    });

    // Link features to package with limits
    for (const featureConfig of features) {
      const feature = await prisma.packageFeature.findUnique({
        where: { name: featureConfig.name },
      });

      if (feature) {
        await prisma.packageFeatureLink.upsert({
          where: {
            packageId_featureId: {
              packageId: createdPackage.id,
              featureId: feature.id,
            },
          },
          update: { limitValue: featureConfig.limit },
          create: {
            packageId: createdPackage.id,
            featureId: feature.id,
            limitValue: featureConfig.limit,
          },
        });
      }
    }
  }
  console.log(`✅ Created ${PACKAGES.length} packages\n`);

  console.log('🎉 Packages seeded successfully!\n');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding packages:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
