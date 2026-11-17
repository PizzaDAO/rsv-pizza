#!/usr/bin/env node
/**
 * Create the two Supabase Storage buckets behind brand image uploads
 * (plans/wl-self-serve-brands.md §2.4 "Uploads", backend/src/lib/brandAssets.ts).
 *
 *   brand-uploads  PRIVATE  10 MB  image/png, image/jpeg, image/webp   tmp uploads (signed upload URLs)
 *   brand-assets   PUBLIC    5 MB  image/png, image/webp               final, server-written only;
 *                                                                      served same-origin as /cdn/brand-assets/*
 *
 * Dry run by default: reads the current state of both buckets (GET only) and prints what --apply
 * would create. `--apply` creates ONLY missing buckets via POST /storage/v1/bucket. An existing
 * bucket is never modified or deleted; if its settings differ from the plan it is reported as DRIFT
 * and left alone (fix it by hand in the dashboard).
 *
 * Credentials (never printed): SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the env. Defaults to
 * the prod URL and reads the key from the login keychain (service/label `pizzadaosupabase`,
 * account `service_role`), per CLAUDE.md. Run with the sandbox disabled so the keychain is reachable.
 *
 *   node backend/scripts/create-brand-asset-buckets.cjs            # dry run
 *   node backend/scripts/create-brand-asset-buckets.cjs --apply    # create missing buckets
 */
const { execFileSync } = require('child_process');

const APPLY = process.argv.includes('--apply');
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://znpiwdvvsqaxuskpfleo.supabase.co').replace(/\/+$/, '');

const MB = 1024 * 1024;
const BUCKETS = [
  { id: 'brand-uploads', name: 'brand-uploads', public: false, file_size_limit: 10 * MB, allowed_mime_types: ['image/png', 'image/jpeg', 'image/webp'] },
  { id: 'brand-assets', name: 'brand-assets', public: true, file_size_limit: 5 * MB, allowed_mime_types: ['image/png', 'image/webp'] },
];

function serviceKey() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    return execFileSync('security', ['find-generic-password', '-l', 'pizzadaosupabase', '-a', 'service_role', '-w'], { encoding: 'utf8' }).trim();
  } catch {
    console.error('Could not read the service_role key (set SUPABASE_SERVICE_ROLE_KEY or run with the sandbox disabled for the keychain).');
    process.exit(2);
  }
}

const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

async function main() {
  const key = serviceKey();
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} against ${SUPABASE_URL}\n`);
  let failed = false;
  for (const b of BUCKETS) {
    const plan = `public=${b.public} file_size_limit=${b.file_size_limit} (${b.file_size_limit / MB} MB) allowed_mime_types=[${b.allowed_mime_types.join(', ')}]`;
    const got = await fetch(`${SUPABASE_URL}/storage/v1/bucket/${b.id}`, { headers });
    if (got.ok) {
      const cur = await got.json();
      const drift = [];
      if (!!cur.public !== b.public) drift.push(`public is ${cur.public}`);
      if (cur.file_size_limit !== b.file_size_limit) drift.push(`file_size_limit is ${cur.file_size_limit}`);
      if (!cur.allowed_mime_types || !same(cur.allowed_mime_types, b.allowed_mime_types)) drift.push(`allowed_mime_types is ${JSON.stringify(cur.allowed_mime_types)}`);
      console.log(`${b.id}: EXISTS${drift.length ? ` - DRIFT (${drift.join('; ')}); not modified` : ' - matches plan'}`);
      if (drift.length) failed = true;
      continue;
    }
    if (got.status !== 404 && got.status !== 400) {
      console.error(`${b.id}: could not read bucket (HTTP ${got.status})`);
      failed = true;
      continue;
    }
    if (!APPLY) {
      console.log(`${b.id}: MISSING - would create: ${plan}`);
      continue;
    }
    const res = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, { method: 'POST', headers, body: JSON.stringify(b) });
    if (res.ok) console.log(`${b.id}: CREATED: ${plan}`);
    else {
      console.error(`${b.id}: create failed (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
      failed = true;
    }
  }
  if (!APPLY) console.log('\nNothing was changed. Re-run with --apply to create the missing buckets.');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
