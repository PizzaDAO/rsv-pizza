const path = require('path');
// Load .env from main repo backend (worktrees don't have .env copies)
const envPath = process.env.DOTENV_PATH || path.resolve(__dirname, '..', 'backend', '.env');
require('dotenv').config({ path: envPath });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const fixes = [
    // Russia → eastern-europe
    { id: 'd75e5555-e0fb-475d-9699-a1cde79f1f34', region: 'eastern-europe', name: 'Moscow' },
    { id: '87e180cb-e8f6-4c8d-a277-62e702f07163', region: 'eastern-europe', name: 'Saint Petersburg' },
    { id: '268bbec5-62e0-4f02-b220-1e3dcbff4dff', region: 'eastern-europe', name: 'Sochi' },
    { id: '56b5d713-74a1-42e6-9a15-a83d571c2333', region: 'eastern-europe', name: 'Ufa' },
    { id: '4de3f44d-f0b8-46c8-bd8e-647c94e06cae', region: 'eastern-europe', name: 'Санкт-Петербург' },
    // Burundi → east-africa
    { id: '106fcbfe-bd72-4f2f-acb0-cde25faf31fd', region: 'east-africa', name: 'Bujumbura' },
    { id: '072e6517-43e7-449f-9bc5-3b732c5f030c', region: 'east-africa', name: 'Gitega' },
    // Chile → south-america
    { id: '8af59f3a-9b6c-4201-8a14-09073f8ba85c', region: 'south-america', name: 'Magallanes' },
    { id: 'f3b4b385-5b20-4125-95a9-e6a3fe32a732', region: 'south-america', name: 'Viña del Mar' },
    // Bolivia → south-america
    { id: '80efb404-b8be-4227-92c0-8642159328d7', region: 'south-america', name: 'Santa Cruz' },
    // Spain → western-europe
    { id: 'edcf439e-6226-4f4d-b111-49321fe1db24', region: 'western-europe', name: 'Valencia' },
    // UK → western-europe
    { id: '5a1b6bd6-8219-426a-af18-c74371793dbc', region: 'western-europe', name: 'London' },
    // India → india
    { id: 'ff08499d-56c2-4960-8122-83d379a41b12', region: 'india', name: 'Jammu' },
    // Malaysia → asia
    { id: '9d3a9ec9-f6a3-45a9-90bc-4678cdbf3d19', region: 'asia', name: 'George Town' },
  ];

  for (const fix of fixes) {
    const result = await prisma.party.update({
      where: { id: fix.id },
      data: { region: fix.region },
    });
    console.log(`✓ ${fix.name}: region set to '${fix.region}'`);
  }
  console.log(`\nFixed ${fixes.length} events.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
