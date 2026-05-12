const path = require('path');
// Load .env from main repo backend (worktrees don't have .env copies)
const envPath = process.env.DOTENV_PATH || path.resolve(__dirname, '..', 'backend', '.env');
require('dotenv').config({ path: envPath });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// These 21 kit records have country=USA but are clearly NOT shipping to US addresses.
// Update their country to match their event's actual country.
const fixes = [
  { kitId: '54da34b4-66fd-4e26-a8b4-97f4831b4f1a', country: 'Nigeria' },     // Kwara
  { kitId: '0ae2b508-9439-4f94-918d-08ac45e0b513', country: 'India' },        // Kalyani
  { kitId: '379d4b95-9d9b-4be3-ab3a-270e50b3e2d0', country: 'India' },        // Dehradun
  { kitId: 'eb7c48c7-5cab-474b-ab51-d5a44f8c878a', country: 'Russia' },       // Санкт-Петербург
  { kitId: 'a6af234d-783c-4dd7-b294-013c294cd733', country: 'Tanzania' },     // Ilemela
  { kitId: '4c5240bd-fdb4-4a94-98eb-067bb859026e', country: 'Nigeria' },      // Ijoko
  { kitId: '2a90be7b-b1a8-41d2-8ca4-f01e87f2ffeb', country: 'Kenya' },       // Nairobi
  { kitId: 'e2efec81-bfaa-4510-a4d6-14c6b45f1742', country: 'Zambia' },      // Kitwe
  { kitId: '0f5175e1-7de1-46e4-9a5f-734c73c7d2d0', country: 'Kenya' },       // Kericho
  { kitId: '3822305c-010c-42c8-a3c0-f8e765cd82bc', country: 'Kenya' },       // Migori
  { kitId: '5f27ada1-7f71-44bc-9663-dbabeac2953c', country: 'Rwanda' },      // Kigali
  { kitId: 'd02b815c-099e-4da2-83d7-743ad0970f0c', country: 'Kenya' },       // Nakuru
  { kitId: '127e8f89-06f3-4a08-ab22-e19c202ff86e', country: 'Nigeria' },     // Warri
  { kitId: '9db194a9-dc53-4409-bb69-26fd705601f3', country: 'Tanzania' },    // Ilemela #2
  { kitId: 'c463f2f8-ce4e-4f1b-a39b-2b5fcf4232aa', country: 'Kenya' },      // Tatu City
  { kitId: 'a512bcf8-6d58-4697-a221-4fca7cc96d68', country: 'Uganda' },     // Hoima
  { kitId: 'cad5984a-bf59-4919-b08f-221f350c9449', country: 'Uganda' },     // Iganga
  { kitId: '4f4a21c8-b5a9-4636-a637-dbb297ed2618', country: 'Malawi' },     // Blantyre
  { kitId: '43403689-3940-4cfb-b821-499ac6c97b78', country: 'Colombia' },   // Bogotá
  { kitId: 'e83302f4-b8ac-4b33-ad43-30e3b7535884', country: 'Uganda' },     // Rukungiri
  { kitId: '54dcccfc-809f-47b9-ba94-b7eb778ac0b8', country: 'India' },      // Bharuch
];

async function main() {
  console.log(`Fixing ${fixes.length} kit records with incorrect country=USA...\n`);

  for (const fix of fixes) {
    const result = await prisma.partyKit.update({
      where: { id: fix.kitId },
      data: { country: fix.country },
    });
    console.log(`✓ Kit ${fix.kitId}: country set to '${fix.country}' (city: ${result.city})`);
  }

  console.log(`\nDone! ${fixes.length} kit records updated.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
