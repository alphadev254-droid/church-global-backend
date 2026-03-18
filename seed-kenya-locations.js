/**
 * Seed Kenya locations from Excel file into the locations table.
 * Mapping:
 *   county name       → region
 *   constituency name → district
 *   ward name         → traditionalAuthority
 *   village           → '' (not in source data)
 *   country           → 'Kenya'
 *
 * Run: node seed-kenya-locations.js
 */

const XLSX = require('xlsx');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const wb = XLSX.readFile('xlsx-Kenya-Counties-Constituencies-Wards.xlsx');
  const ws = wb.Sheets[wb.SheetNames[0]];
  // Skip header row (header:1 gives raw arrays)
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }).slice(1);

  console.log(`Total rows to process: ${rows.length}`);

  // Check existing Kenya records to allow re-running safely
  const existing = await prisma.location.count({ where: { country: 'Kenya' } });
  if (existing > 0) {
    console.log(`Found ${existing} existing Kenya locations. Deleting before re-seeding...`);
    await prisma.location.deleteMany({ where: { country: 'Kenya' } });
    console.log('Deleted existing Kenya locations.');
  }

  // Build records — columns: [COUNTY ID, COUNTY NAME, CONSTITUENCY ID, CONSTITUENCY NAME, WARD ID, WARD]
  const records = rows
    .filter(row => row[1] && row[3] && row[5]) // skip any blank rows
    .map(row => ({
      country: 'Kenya',
      region: String(row[1]).trim(),
      district: String(row[3]).trim(),
      traditionalAuthority: String(row[5]).trim(),
      village: '',
    }));

  console.log(`Inserting ${records.length} location records...`);

  // Insert in batches of 200 for performance
  const BATCH = 200;
  for (let i = 0; i < records.length; i += BATCH) {
    await prisma.location.createMany({ data: records.slice(i, i + BATCH) });
    process.stdout.write(`\r  ${Math.min(i + BATCH, records.length)} / ${records.length}`);
  }

  console.log('\nDone!');
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
