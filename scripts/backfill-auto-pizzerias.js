#!/usr/bin/env node
/**
 * scripts/backfill-auto-pizzerias.js — backfill parties.selected_pizzerias
 * by calling the search-pizzerias edge function for each event with an
 * address and an empty list. Idempotent. Dry-run by default.
 *
 * prosciutto-58472: pairs with backend auto-populate so existing events
 * get the same pre-populated rank widget that new events get on creation.
 *
 * Env:
 *   SUPABASE_URL (default: https://znpiwdvvsqaxuskpfleo.supabase.co)
 *   SUPABASE_SERVICE_ROLE_KEY (required)
 *
 * Usage:
 *   node scripts/backfill-auto-pizzerias.js                 # dry-run
 *   node scripts/backfill-auto-pizzerias.js --limit 1       # 1-row smoke test
 *   node scripts/backfill-auto-pizzerias.js --apply         # full apply
 *   node scripts/backfill-auto-pizzerias.js --apply --delay-ms 2000
 */
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://znpiwdvvsqaxuskpfleo.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_SERVICE_ROLE_KEY env var');
  process.exit(1);
}

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const limitArg = args.indexOf('--limit');
const LIMIT = limitArg >= 0 ? parseInt(args[limitArg + 1], 10) : Infinity;
const delayArg = args.indexOf('--delay-ms');
const DELAY_MS = delayArg >= 0 ? parseInt(args[delayArg + 1], 10) : 1500;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function nominatim(address) {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 5000);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`,
      {
        headers: { 'User-Agent': 'rsv.pizza-backfill/1.0 (samgold24@gmail.com)' },
        signal: ac.signal,
      }
    );
    clearTimeout(t);
    if (!res.ok) return null;
    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const lat = parseFloat(arr[0].lat);
    const lng = parseFloat(arr[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

async function callEdge(lat, lng) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/search-pizzerias`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
    },
    body: JSON.stringify({ lat, lng, radius: 5000 }),
  });
  if (!res.ok) throw new Error(`edge ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.pizzerias) ? data.pizzerias.slice(0, 20) : [];
}

(async () => {
  console.log(APPLY ? 'APPLY mode — writes enabled' : 'DRY RUN — no writes');
  console.log(`delay between rows: ${DELAY_MS}ms`);

  const { data: rows, error } = await supabase
    .from('parties')
    .select('id, custom_url, invite_code, address, latitude, longitude, selected_pizzerias')
    .not('address', 'is', null)
    .or('selected_pizzerias.is.null,selected_pizzerias.eq.[]')
    .order('created_at', { ascending: true });

  if (error) {
    console.error(error);
    process.exit(1);
  }

  // Belt-and-suspenders client-side filter (some Supabase versions don't
  // reliably evaluate `.eq.[]` against jsonb null vs. empty).
  const candidates = rows.filter(r =>
    !r.selected_pizzerias ||
    (Array.isArray(r.selected_pizzerias) && r.selected_pizzerias.length === 0)
  );
  const slice = Number.isFinite(LIMIT) ? candidates.slice(0, LIMIT) : candidates;
  console.log(`Found ${candidates.length} candidates; processing ${slice.length}`);

  let ok = 0, skip = 0, fail = 0;
  for (let i = 0; i < slice.length; i++) {
    const row = slice[i];
    const slug = row.custom_url || row.invite_code || row.id;
    try {
      let lat = row.latitude;
      let lng = row.longitude;
      if (lat == null || lng == null) {
        const geo = await nominatim(row.address);
        if (!geo) {
          console.log(`[${i + 1}/${slice.length}] ${slug} — skip (no geocode)`);
          skip++;
          // Nominatim asks for ≥1s between requests
          await sleep(DELAY_MS + 1000);
          continue;
        }
        lat = geo.lat;
        lng = geo.lng;
        if (APPLY) {
          await supabase.from('parties').update({ latitude: lat, longitude: lng }).eq('id', row.id);
        }
        // Respect Nominatim usage policy (≥1s between requests).
        await sleep(1000);
      }
      const pizzerias = await callEdge(lat, lng);
      if (pizzerias.length === 0) {
        console.log(`[${i + 1}/${slice.length}] ${slug} — skip (0 results)`);
        skip++;
        await sleep(DELAY_MS);
        continue;
      }
      if (APPLY) {
        // Race-safe: only write if still empty.
        const { error: upErr } = await supabase
          .from('parties')
          .update({ selected_pizzerias: pizzerias })
          .eq('id', row.id)
          .or('selected_pizzerias.is.null,selected_pizzerias.eq.[]');
        if (upErr) throw upErr;
      }
      console.log(
        `[${i + 1}/${slice.length}] ${slug} — ${pizzerias.length} pizzerias — ${APPLY ? 'ok' : 'dry-ok'}`
      );
      ok++;
    } catch (e) {
      console.log(`[${i + 1}/${slice.length}] ${slug} — fail: ${e.message}`);
      fail++;
    }
    await sleep(DELAY_MS);
  }

  console.log(`\nSummary: ok=${ok} skip=${skip} fail=${fail}`);
})();
