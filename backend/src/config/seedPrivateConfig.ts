/**
 * Private-config seed runner (marinara-71630 P0).
 *
 * Reads seed.private.json (real values, gitignored). If that file is absent,
 * it falls back to seed.example.json and seeds PLACEHOLDER values with a loud
 * warning. For each top-level key it upserts a row into `app_config` with the
 * value JSON-stringified.
 *
 * Run with: `npm run seed:private-config` (from the backend dir).
 *
 * Meta keys beginning with "_" (e.g. "_readme", "_note") are skipped — they
 * document the template and are not real config rows. (Note: nested "_note"
 * fields inside a value object ARE preserved as-is, since the whole object is
 * stored verbatim.)
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { prisma } from './database.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PRIVATE_PATH = join(__dirname, 'seed.private.json');
const EXAMPLE_PATH = join(__dirname, 'seed.example.json');

async function main(): Promise<void> {
  let sourcePath: string;
  let usingPlaceholders: boolean;

  if (existsSync(PRIVATE_PATH)) {
    sourcePath = PRIVATE_PATH;
    usingPlaceholders = false;
  } else {
    sourcePath = EXAMPLE_PATH;
    usingPlaceholders = true;
  }

  if (usingPlaceholders) {
    console.warn(
      '\n*****************************************************************\n' +
        '*  WARNING: seed.private.json not found.                        *\n' +
        '*  Seeding PLACEHOLDER values from seed.example.json.           *\n' +
        '*  These are NOT real production values. Copy seed.example.json *\n' +
        '*  to seed.private.json and fill in real values for prod.       *\n' +
        '*****************************************************************\n'
    );
  }

  const raw = readFileSync(sourcePath, 'utf8');
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  const written: string[] = [];
  const skipped: string[] = [];

  for (const [key, val] of Object.entries(parsed)) {
    if (key.startsWith('_')) {
      skipped.push(key);
      continue;
    }

    const value = JSON.stringify(val);
    await prisma.appConfig.upsert({
      where: { key },
      update: { value, updatedAt: new Date() },
      create: { key, value },
    });
    written.push(key);
  }

  console.log(`\nSeeded ${written.length} app_config key(s) from ${sourcePath}:`);
  for (const k of written) console.log(`  ✓ ${k}`);
  if (skipped.length) {
    console.log(`Skipped ${skipped.length} meta key(s): ${skipped.join(', ')}`);
  }
  if (usingPlaceholders) {
    console.warn('\nReminder: PLACEHOLDER values were seeded. Do NOT run this against prod.');
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error('[seedPrivateConfig] seed failed:', err);
    process.exitCode = 1;
    prisma.$disconnect().catch(() => {});
  });
