/**
 * Backfill: For each GPP event whose primary host has a `users.telegram`
 * value, set the matching cohost entry's `telegram` field in
 * `parties.co_hosts` (jsonb). The matching cohost is found by joining
 * `users.email` to `co_hosts[].email` (case-insensitive). NOTE: index 0
 * in `co_hosts` is the "PizzaDAO" placeholder (hello@rarepizzas.com), so
 * we must match by email, not by index.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-cohost-telegram-from-host.js          (dry-run)
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-cohost-telegram-from-host.js --apply  (writes)
 *
 * Modeled on scripts/backfill-avatar-proxy.js (same iterate-and-patch
 * pattern). Service-role key handling matches the existing convention
 * (read from env; refuse to run without it).
 */
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://znpiwdvvsqaxuskpfleo.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_SERVICE_ROLE_KEY env var');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const dryRun = !process.argv.includes('--apply');

async function main() {
  console.log(dryRun ? 'DRY RUN — pass --apply to execute' : 'APPLYING changes...');

  // PostgREST embed: only GPP events that have an associated user
  const { data: parties, error } = await supabase
    .from('parties')
    .select('id, name, co_hosts, user_id, user:users(email, telegram)')
    .eq('event_type', 'gpp')
    .not('user_id', 'is', null);

  if (error) {
    console.error('Error fetching parties:', error);
    process.exit(1);
  }

  let scanned = 0;
  let affected = 0;
  let cohostsUpdated = 0;
  let skippedNoUserTelegram = 0;
  let skippedNoMatchingCohost = 0;
  let skippedAlreadyHasTelegram = 0;

  for (const party of parties) {
    scanned++;

    const userTelegram = party.user && party.user.telegram ? String(party.user.telegram).trim() : '';
    const userEmail = party.user && party.user.email ? String(party.user.email).trim().toLowerCase() : '';

    if (!userTelegram) {
      skippedNoUserTelegram++;
      continue;
    }

    const coHosts = party.co_hosts;
    if (!Array.isArray(coHosts) || coHosts.length === 0) {
      skippedNoMatchingCohost++;
      continue;
    }

    // Match the primary host cohost by email (case-insensitive). Skip
    // index 0 implicitly by email-matching — the host's user.email won't
    // match the "PizzaDAO" placeholder's hello@rarepizzas.com.
    const matchIdx = coHosts.findIndex((h) => {
      if (!h || typeof h !== 'object') return false;
      if (!h.email) return false;
      return String(h.email).trim().toLowerCase() === userEmail;
    });

    if (matchIdx === -1) {
      skippedNoMatchingCohost++;
      continue;
    }

    const existing = coHosts[matchIdx];
    if (existing.telegram) {
      skippedAlreadyHasTelegram++;
      continue;
    }

    const updatedHosts = coHosts.map((h, i) =>
      i === matchIdx ? { ...h, telegram: userTelegram } : h
    );

    console.log(
      `  Party ${party.id} (${party.name || '(no name)'}): cohost[${matchIdx}] ${existing.name || existing.email} -> telegram="${userTelegram}"`
    );

    affected++;
    cohostsUpdated++;

    if (!dryRun) {
      const { error: updateError } = await supabase
        .from('parties')
        .update({ co_hosts: updatedHosts })
        .eq('id', party.id);

      if (updateError) {
        console.error(`    Error updating party ${party.id}:`, updateError.message);
        affected--;
        cohostsUpdated--;
      }
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Parties scanned:                  ${scanned}`);
  console.log(`Parties ${dryRun ? 'that would be' : ''} affected:        ${affected}`);
  console.log(`Cohosts ${dryRun ? 'that would be' : ''} updated:        ${cohostsUpdated}`);
  console.log(`Skipped (no user.telegram):       ${skippedNoUserTelegram}`);
  console.log(`Skipped (no matching cohost):     ${skippedNoMatchingCohost}`);
  console.log(`Skipped (cohost already had tg):  ${skippedAlreadyHasTelegram}`);
  if (dryRun) {
    console.log('\nRe-run with --apply to write changes.');
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
