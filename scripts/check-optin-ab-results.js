/**
 * scripts/check-optin-ab-results.js
 *
 * Reports A/B test results for parmesan-98989 (combined PizzaDAO + SWC opt-in).
 *
 * Scope: events tagged `swc` (US SWC), real RSVP submissions only
 *   (submitted_via = 'link', status != 'INVITED').
 *
 * Primary metric: pizzadao_optin_rate per arm.
 * Secondary metric: swc_optin_rate per arm (variant should ~equal pizzadao rate).
 *
 * Required env vars:
 *   SUPABASE_SERVICE_ROLE_KEY  Supabase service-role key (Dashboard -> API).
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/check-optin-ab-results.js
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://znpiwdvvsqaxuskpfleo.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY env var.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function pct(num, den) {
  if (!den) return '0.00';
  return ((100 * num) / den).toFixed(2);
}

// Two-proportion z-test (two-sided). Returns z-statistic.
function zScore(p1, n1, p2, n2) {
  if (!n1 || !n2) return 0;
  const pPool = (p1 * n1 + p2 * n2) / (n1 + n2);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / n1 + 1 / n2));
  if (!se) return 0;
  return (p1 - p2) / se;
}

// Approximate two-sided p-value from a z-score (normal CDF approximation).
function pValueFromZ(z) {
  const abs = Math.abs(z);
  // Abramowitz & Stegun 7.1.26 approximation of erf.
  const t = 1 / (1 + 0.3275911 * (abs / Math.SQRT2));
  const erf =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-((abs / Math.SQRT2) ** 2));
  const oneSided = 1 - 0.5 * (1 + erf);
  return 2 * oneSided;
}

async function main() {
  // Pull all swc-tagged party IDs first.
  const { data: parties, error: pErr } = await supabase
    .from('parties')
    .select('id, event_tags')
    .contains('event_tags', ['swc']);
  if (pErr) {
    console.error('Failed to fetch parties:', pErr);
    process.exit(1);
  }
  const partyIds = parties.map(p => p.id);
  if (partyIds.length === 0) {
    console.log('No swc-tagged events found.');
    return;
  }

  // Pull guests on those parties with an experiment assignment.
  const { data: guests, error: gErr } = await supabase
    .from('guests')
    .select('id, party_id, optin_ab_variant, mailing_list_opt_in, swc_opt_in, submitted_via, status')
    .in('party_id', partyIds)
    .in('optin_ab_variant', ['control', 'variant'])
    .eq('submitted_via', 'link');
  if (gErr) {
    console.error('Failed to fetch guests:', gErr);
    process.exit(1);
  }

  const eligible = guests.filter(g => g.status !== 'INVITED');

  const arms = { control: [], variant: [] };
  for (const g of eligible) arms[g.optin_ab_variant].push(g);

  console.log('parmesan-98989 — Combined PizzaDAO + SWC opt-in A/B test');
  console.log('Scope: swc-tagged events, submitted_via=link, status!=INVITED');
  console.log('');
  console.log('Arm      |     n | PizzaDAO opt-ins (%)   | SWC opt-ins (%)');
  console.log('---------+-------+------------------------+------------------------');

  const stats = {};
  for (const arm of ['control', 'variant']) {
    const rows = arms[arm];
    const n = rows.length;
    const pdao = rows.filter(r => r.mailing_list_opt_in).length;
    const swc = rows.filter(r => r.swc_opt_in).length;
    stats[arm] = { n, pdao, swc };
    console.log(
      `${arm.padEnd(8)} | ${String(n).padStart(5)} | ${String(pdao).padStart(5)} (${pct(pdao, n).padStart(6)}%)        | ${String(swc).padStart(5)} (${pct(swc, n).padStart(6)}%)`
    );
  }

  if (stats.control.n > 0 && stats.variant.n > 0) {
    const p1 = stats.control.pdao / stats.control.n;
    const p2 = stats.variant.pdao / stats.variant.n;
    const z = zScore(p1, stats.control.n, p2, stats.variant.n);
    const p = pValueFromZ(z);
    console.log('');
    console.log(`Primary metric (PizzaDAO opt-in rate):`);
    console.log(`  control: ${(100 * p1).toFixed(2)}%, variant: ${(100 * p2).toFixed(2)}%`);
    console.log(`  delta (variant - control): ${((100 * (p2 - p1))).toFixed(2)} pp`);
    console.log(`  z = ${z.toFixed(3)}, two-sided p = ${p.toFixed(4)}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
