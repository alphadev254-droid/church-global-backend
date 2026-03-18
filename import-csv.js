require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function importLocationsFromCSV() {
  const DATABASE_URL = process.env.DATABASE_URL;
  
  if (!DATABASE_URL) {
    console.error('❌ DATABASE_URL not found in .env file');
    process.exit(1);
  }

  const match = DATABASE_URL.match(/mysql:\/\/([^:]+):([^@]*)@([^:]+):(\d+)\/(.+)/);
  if (!match) {
    console.error('❌ Invalid DATABASE_URL format');
    process.exit(1);
  }

  const [, user, password, host, port, database] = match;

  console.log('📦 Connecting to database...');
  const connection = await mysql.createConnection({
    host,
    port: parseInt(port),
    user,
    password,
    database
  });
  console.log('✅ Connected');

  const csvFile = path.join(__dirname, 'locations.csv');
  if (!fs.existsSync(csvFile)) {
    console.error('❌ CSV file not found:', csvFile);
    process.exit(1);
  }

  console.log('📄 Reading CSV file...');
  const csv = fs.readFileSync(csvFile, 'utf8');
  const lines = csv.split('\n').filter(line => line.trim());
  
  console.log(`Found ${lines.length} lines`);
  
  // Skip header row
  const dataLines = lines.slice(1);
  
  console.log('🚀 Importing locations...');
  
  let imported = 0;
  for (const line of dataLines) {
    const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    
    if (values.length >= 5) {
      const [id, region, district, traditional_authority, village, createdAt, updatedAt, country] = values;
      
      await connection.query(
        'INSERT INTO locations (id, region, district, traditional_authority, village, createdAt, updatedAt, country) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, region, district, traditional_authority, village, createdAt || new Date(), updatedAt || new Date(), country || 'Malawi']
      );
      
      imported++;
      if (imported % 100 === 0) {
        console.log(`✅ Imported ${imported}/${dataLines.length}...`);
      }
    }
  }

  console.log(`✅ Successfully imported ${imported} locations!`);
  await connection.end();
}

importLocationsFromCSV().catch(console.error);
