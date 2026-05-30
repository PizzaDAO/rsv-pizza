#!/usr/bin/env node
/**
 * mortadella-92103: backfill receipts that were mis-stamped as USD.
 *
 * Background: pre-mortadella-92103, OCR defaulted to currency='USD' when it
 * couldn't read a currency symbol. For receipts from non-US events (e.g.
 * Mexico City), the raw MXN amount got persisted as `ocr_amount` (USD) and
 * the payout's `final_amount_usd` was wildly over-stated (often ~20×).
 *
 * Production symptom: Mexico City had a $2,330.56 pending payout where the
 * receipts were `1624 MXN + 706.56 MXN` (~$120 USD).
 *
 * Strategy:
 *   - Find payout_documents where:
 *       ocr_currency = 'USD'
 *       AND parties.country IS NOT NULL AND parties.country != 'US'
 *       AND parties.country != 'EC' (Ecuador uses USD natively)
 *       AND parties.country != 'PA' (Panama uses USD natively)
 *       AND parties.country != 'SV' (El Salvador uses USD natively)
 *       AND createdAt >= --since (default: 90 days ago, conservative)
 *       AND original_amount IS NULL  (don't re-touch already-backfilled rows)
 *   - For each, look up the party's primary currency from the static map.
 *   - Convert `ocr_amount` (the raw foreign-currency figure) → USD via the
 *     FX cascade, locked to the receipt creation date.
 *   - Write `original_amount = old ocr_amount`, `original_currency = primary`,
 *     `exchange_rate = rate`, `ocr_amount = new USD value`.
 *   - Recompute parent payout's `final_amount_usd` as the sum of doc
 *     ocr_amount where status != 'paid' (paid history is immutable).
 *
 * Dry-run by default. `--apply` to mutate.
 *
 * Usage:
 *   node backend/scripts/backfill-misclassified-usd-receipts.cjs [--apply] [--since=2026-01-01] [--country=MX]
 */

const path = require('path');
const fs = require('fs');
const envCandidates = [
  path.join(__dirname, '..', '.env'),
  'C:/Users/samgo/OneDrive/Documents/PizzaDAO/Code/rsvpizza/backend/.env',
];
for (const p of envCandidates) {
  if (fs.existsSync(p)) {
    require('dotenv').config({ path: p });
    if (process.env.DATABASE_URL) break;
  }
}

const { Client } = require('pg');

// IMPORTANT: parties.country is stored as the FULL English name (e.g.
// "Mexico", "Nigeria"), not the ISO-2 code. The runtime path uses the
// frontend's country dropdown which now writes ISO-2, but historical rows
// pre-date that. So the script must normalize both shapes. Map of common
// full-name → ISO-2 (case-insensitive, locale-folded). Anything that
// doesn't map gets skipped + counted in skipped_no_mapping.
const COUNTRY_NAME_TO_ISO2 = {
  'argentina': 'AR', 'armenia': 'AM', 'australia': 'AU', 'austria': 'AT',
  'bangladesh': 'BD', 'belgium': 'BE', 'bolivia': 'BO', 'botswana': 'BW',
  'brazil': 'BR', 'brasil': 'BR', 'bulgaria': 'BG',
  'cambodia': 'KH', 'canada': 'CA', 'chile': 'CL', 'china': 'CN',
  'colombia': 'CO', 'costa rica': 'CR', "côte d'ivoire": 'CI',
  'cote d ivoire': 'CI', 'czechia': 'CZ', 'czech republic': 'CZ',
  'denmark': 'DK', 'danmark': 'DK', 'dominican republic': 'DO',
  'ecuador': 'EC', 'egypt': 'EG', 'el salvador': 'SV', 'estonia': 'EE',
  'ethiopia': 'ET', 'finland': 'FI', 'france': 'FR', 'germany': 'DE',
  'ghana': 'GH', 'greece': 'GR', 'guatemala': 'GT', 'honduras': 'HN',
  'hong kong': 'HK', 'hungary': 'HU', 'iceland': 'IS', 'india': 'IN',
  'indonesia': 'ID', 'ireland': 'IE', 'israel': 'IL', 'italy': 'IT',
  'japan': 'JP', 'kenya': 'KE', 'kuwait': 'KW', 'latvia': 'LV',
  'lithuania': 'LT', 'luxembourg': 'LU', 'malaysia': 'MY', 'malta': 'MT',
  'mexico': 'MX', 'méxico': 'MX', 'morocco': 'MA', 'netherlands': 'NL',
  'new zealand': 'NZ', 'nicaragua': 'NI', 'nigeria': 'NG', 'norway': 'NO',
  'pakistan': 'PK', 'panama': 'PA', 'paraguay': 'PY', 'peru': 'PE',
  'philippines': 'PH', 'poland': 'PL', 'portugal': 'PT', 'qatar': 'QA',
  'romania': 'RO', 'russia': 'RU', 'saudi arabia': 'SA', 'serbia': 'RS',
  'singapore': 'SG', 'slovakia': 'SK', 'slovenia': 'SI', 'south africa': 'ZA',
  'spain': 'ES', 'sri lanka': 'LK', 'sweden': 'SE', 'switzerland': 'CH',
  'taiwan': 'TW', 'tanzania': 'TZ', 'thailand': 'TH', 'tunisia': 'TN',
  'turkey': 'TR', 'türkiye': 'TR', 'uganda': 'UG', 'ukraine': 'UA',
  'united arab emirates': 'AE', 'united kingdom': 'GB', 'uk': 'GB',
  'united states': 'US', 'usa': 'US', 'united states of america': 'US',
  'uruguay': 'UY', 'venezuela': 'VE', 'vietnam': 'VN', 'zambia': 'ZM',
  'zimbabwe': 'ZW', 'puerto rico': 'PR', 'antigua and barbuda': 'AG',
  'bahrain': 'BH',
  // salame-92107: MWK + XOF (UEMOA) + XAF (CEMAC) country members.
  // (Côte d'Ivoire is already mapped above.)
  'malawi': 'MW',
  'togo': 'TG', 'benin': 'BJ', 'burkina faso': 'BF', 'ivory coast': 'CI',
  'mali': 'ML', 'senegal': 'SN',
  'guinea-bissau': 'GW', 'guinea bissau': 'GW', 'niger': 'NE',
  'cameroon': 'CM', 'gabon': 'GA', 'chad': 'TD',
  'central african republic': 'CF', 'equatorial guinea': 'GQ',
  'republic of the congo': 'CG', 'congo-brazzaville': 'CG', 'congo': 'CG',
};

function normalizeCountryToIso2(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 2 && /^[A-Z]{2}$/.test(trimmed)) return trimmed;
  if (trimmed.length === 2 && /^[a-zA-Z]{2}$/.test(trimmed)) return trimmed.toUpperCase();
  const lc = trimmed.toLowerCase();
  if (COUNTRY_NAME_TO_ISO2[lc]) return COUNTRY_NAME_TO_ISO2[lc];
  return null;
}

// Mirror of backend/src/services/ocr.service.ts COUNTRY_TO_PRIMARY_CURRENCY.
// Keep in sync — this script is one-shot ops, not part of the runtime path.
const COUNTRY_TO_PRIMARY_CURRENCY = {
  US: 'USD', CA: 'CAD', MX: 'MXN',
  AR: 'ARS', BO: 'BOB', BR: 'BRL', CL: 'CLP', CO: 'COP', CR: 'CRC',
  DO: 'DOP', EC: 'USD', GT: 'GTQ', HN: 'HNL', NI: 'NIO', PA: 'USD',
  PE: 'PEN', PY: 'PYG', SV: 'USD', UY: 'UYU', VE: 'VES',
  AT: 'EUR', BE: 'EUR', CY: 'EUR', DE: 'EUR', EE: 'EUR', ES: 'EUR',
  FI: 'EUR', FR: 'EUR', GR: 'EUR', HR: 'EUR', IE: 'EUR', IT: 'EUR',
  LT: 'EUR', LU: 'EUR', LV: 'EUR', MT: 'EUR', NL: 'EUR', PT: 'EUR',
  SI: 'EUR', SK: 'EUR',
  GB: 'GBP', CH: 'CHF', NO: 'NOK', SE: 'SEK', DK: 'DKK', IS: 'ISK',
  PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', BG: 'BGN', RS: 'RSD',
  UA: 'UAH', TR: 'TRY',
  CN: 'CNY', JP: 'JPY', KR: 'KRW', IN: 'INR', ID: 'IDR', MY: 'MYR',
  PH: 'PHP', SG: 'SGD', TH: 'THB', VN: 'VND', TW: 'TWD', HK: 'HKD',
  AU: 'AUD', NZ: 'NZD', PK: 'PKR', BD: 'BDT', LK: 'LKR',
  AE: 'AED', SA: 'SAR', IL: 'ILS', QA: 'QAR', KW: 'KWD', BH: 'BHD',
  EG: 'EGP', NG: 'NGN', ZA: 'ZAR', KE: 'KES', GH: 'GHS', MA: 'MAD',
  TN: 'TND', ET: 'ETB', UG: 'UGX', TZ: 'TZS', MW: 'MWK',
  // salame-92107: XOF (UEMOA) + XAF (CEMAC).
  BJ: 'XOF', BF: 'XOF', CI: 'XOF', GW: 'XOF', ML: 'XOF', NE: 'XOF',
  SN: 'XOF', TG: 'XOF',
  CM: 'XAF', CF: 'XAF', TD: 'XAF', GQ: 'XAF', GA: 'XAF', CG: 'XAF',
};

// Minimal FX fallback rates (mirrored from fx.service.ts). Kept here so the
// backfill runs even if external FX providers fail. Roughly correct as of
// 2026-05; admins can re-run with --apply once jsdelivr/frankfurter are up.
const FALLBACK_RATES_TO_USD = {
  NGN: 0.00063, EUR: 1.08, GBP: 1.27, JPY: 0.0067, INR: 0.012,
  BRL: 0.20, PHP: 0.018, THB: 0.029, SEK: 0.096, PLN: 0.25,
  CHF: 1.13, AUD: 0.66, CAD: 0.74, MXN: 0.058, KRW: 0.00075,
  CNY: 0.14, ZAR: 0.055, ARS: 0.0011, CLP: 0.0011, COP: 0.00024,
  UYU: 0.025, PEN: 0.27, BOB: 0.14, CRC: 0.0019, DOP: 0.017,
  GTQ: 0.13, HNL: 0.040, NIO: 0.027, PYG: 0.00013, VES: 0.027,
  CZK: 0.043, HUF: 0.0027, RON: 0.22, BGN: 0.55, DKK: 0.145,
  NOK: 0.094, ISK: 0.0072, RSD: 0.0092, UAH: 0.024, TRY: 0.029,
  IDR: 0.000063, MYR: 0.21, SGD: 0.74, VND: 0.000041, TWD: 0.031,
  HKD: 0.13, NZD: 0.61, PKR: 0.0036, BDT: 0.0084, LKR: 0.0033,
  AED: 0.27, SAR: 0.27, ILS: 0.27, QAR: 0.27, KWD: 3.25, BHD: 2.65,
  EGP: 0.020, KES: 0.0078, GHS: 0.063, MAD: 0.10, TND: 0.32,
  ETB: 0.018, UGX: 0.00027, TZS: 0.00039,
  // salame-92107: MWK + XOF/XAF (both pegged to EUR via 655.957/€1).
  MWK: 0.00058, XOF: 0.0016, XAF: 0.0016,
};

async function fetchRate(currency) {
  // 1. jsdelivr
  try {
    const r = await fetch(
      `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${currency.toLowerCase()}.json`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (r.ok) {
      const d = await r.json();
      const rate = d[currency.toLowerCase()]?.usd;
      if (rate) return { rate, source: 'jsdelivr' };
    }
  } catch (_) {}
  // 2. frankfurter
  try {
    const r = await fetch(
      `https://api.frankfurter.app/latest?from=${currency}&to=USD`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (r.ok) {
      const d = await r.json();
      if (d.rates?.USD) return { rate: d.rates.USD, source: 'frankfurter' };
    }
  } catch (_) {}
  // 3. fallback
  const fb = FALLBACK_RATES_TO_USD[currency];
  if (fb) return { rate: fb, source: 'fallback' };
  return null;
}

function parseArgs(argv) {
  const args = { apply: false, since: null, country: null, limit: null };
  for (const a of argv.slice(2)) {
    if (a === '--apply') args.apply = true;
    else if (a.startsWith('--since=')) args.since = a.slice('--since='.length);
    else if (a.startsWith('--country=')) args.country = a.slice('--country='.length).toUpperCase();
    else if (a.startsWith('--limit=')) args.limit = Number(a.slice('--limit='.length));
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL not set.');
    process.exit(1);
  }

  // Default to a conservative 90-day window. Snax can re-run with a wider
  // --since after verifying the first batch looks right.
  const since = args.since || new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  const client = new Client({ connectionString: url });
  await client.connect();

  console.log(`[backfill] mode=${args.apply ? 'APPLY' : 'DRY-RUN'} since=${since}${args.country ? ` country=${args.country}` : ''}${args.limit ? ` limit=${args.limit}` : ''}`);

  try {
    // Candidate select. Note: country normalization happens in JS — the column
    // stores a mix of full names ("Mexico") and ISO-2 codes ("MX"), so we
    // can't reliably filter to "non-US" in SQL. We pull all USD-stamped
    // non-null-country rows and filter in JS via normalizeCountryToIso2.
    //
    // Skip:
    //   - already-paid payouts (don't rewrite history)
    //   - rows that already have original_amount set (already-backfilled)
    const params = [since];
    let limitClause = '';
    if (args.limit) {
      params.push(args.limit * 3);  // over-fetch since JS filter will drop some
      limitClause = `LIMIT $${params.length}`;
    }

    const sql = `
      SELECT
        pd.id            AS doc_id,
        pd.payout_id     AS payout_id,
        pd.ocr_amount    AS ocr_amount,
        pd.ocr_currency  AS ocr_currency,
        pd.created_at    AS doc_created_at,
        p.id             AS party_id,
        p.name           AS party_name,
        p.country        AS country,
        po.status        AS payout_status,
        po.final_amount_usd AS final_amount_usd
      FROM payout_documents pd
      JOIN parties p   ON p.id = pd.party_id
      LEFT JOIN payouts po ON po.id = pd.payout_id
      WHERE pd.kind = 'receipt'
        AND pd.ocr_currency = 'USD'
        AND pd.ocr_amount IS NOT NULL
        AND pd.original_amount IS NULL
        AND p.country IS NOT NULL
        AND pd.created_at >= $1
        AND (po.id IS NULL OR po.status NOT IN ('paid'))
      ORDER BY pd.created_at DESC
      ${limitClause}
    `;
    const { rows: allRows } = await client.query(sql, params);

    // JS-side filter: normalize country, optional --country=XX filter, skip
    // dollarized countries (US/EC/PA/SV), and apply the post-normalize limit.
    const rows = [];
    let skippedDollarized = 0;
    let skippedUnmappedCountry = 0;
    for (const r of allRows) {
      const iso = normalizeCountryToIso2(r.country);
      if (!iso) { skippedUnmappedCountry++; continue; }
      if (args.country && iso !== args.country) continue;
      if (['US', 'EC', 'PA', 'SV'].includes(iso)) { skippedDollarized++; continue; }
      r.iso2 = iso;
      rows.push(r);
      if (args.limit && rows.length >= args.limit) break;
    }
    console.log(
      `[backfill] ${rows.length} candidate receipts after country normalize `
      + `(dropped: ${skippedDollarized} dollarized, ${skippedUnmappedCountry} unmapped country)`,
    );

    const rateCache = new Map();
    const changesByPayout = new Map(); // payoutId -> touched-doc-count
    // payoutId -> { oldSum: <sum of old USD-stamped values for touched docs>,
    //               newSum: <sum of new USD values for touched docs> }
    const projectedDocChanges = new Map();
    const summaryByCountry = new Map();
    let skippedNoMapping = 0;
    let appliedDocs = 0;

    for (const row of rows) {
      const cc = row.iso2;
      const primary = COUNTRY_TO_PRIMARY_CURRENCY[cc];
      if (!primary || primary === 'USD') {
        skippedNoMapping++;
        continue;
      }

      let fx = rateCache.get(primary);
      if (!fx) {
        fx = await fetchRate(primary);
        if (!fx) {
          console.warn(`[backfill] no rate for ${primary} (${cc}); skipping doc=${row.doc_id}`);
          continue;
        }
        rateCache.set(primary, fx);
      }

      const originalAmount = Number(row.ocr_amount);
      const newUsd = Math.round(originalAmount * fx.rate * 100) / 100;

      const countryAcc = summaryByCountry.get(cc) || { docs: 0, oldUsdSum: 0, newUsdSum: 0 };
      countryAcc.docs += 1;
      countryAcc.oldUsdSum += originalAmount;
      countryAcc.newUsdSum += newUsd;
      summaryByCountry.set(cc, countryAcc);

      console.log(
        `[backfill] doc=${row.doc_id} party=${row.party_name} (${cc}) `
        + `orig=${originalAmount} ${primary} → $${newUsd} USD (rate=${fx.rate}, source=${fx.source}, was-USD=${originalAmount})`,
      );

      if (args.apply) {
        await client.query(
          `UPDATE payout_documents
              SET ocr_amount        = $2,
                  ocr_currency      = $3,
                  original_amount   = $4,
                  original_currency = $3,
                  exchange_rate     = $5
            WHERE id = $1`,
          [row.doc_id, newUsd, primary, originalAmount, fx.rate],
        );
        appliedDocs++;
      }

      if (row.payout_id) {
        const acc = changesByPayout.get(row.payout_id) || 0;
        changesByPayout.set(row.payout_id, acc + 1);
        const proj = projectedDocChanges.get(row.payout_id) || { oldSum: 0, newSum: 0 };
        proj.oldSum += originalAmount;
        proj.newSum += newUsd;
        projectedDocChanges.set(row.payout_id, proj);
      }
    }

    // Recompute parent payouts' final_amount_usd. ONLY when the new sum is
    // LOWER than the old final — that's the "we over-stated USD because the
    // raw foreign-currency amount was stamped as USD" case we want to fix.
    // When the new sum is HIGHER than the old final, that means the old
    // final was clamped to a per-party cap at submission time — leave the
    // clamp in place; the corrected receipts are still preserved as evidence.
    //
    // Skip non-pending/approved/failed statuses (paid/withdrawn/cancelled/
    // rejected are immutable history).
    //
    // NOTE: in dry-run mode we use the projected new-USD deltas accumulated
    // in `projectedDocChanges` rather than re-reading the DB (which would
    // still hold the un-mutated values). In apply mode we re-read the DB
    // so we pick up sibling receipts that were ALREADY USD on this payout.
    if (changesByPayout.size > 0) {
      console.log(`\n[backfill] recompute final_amount_usd for ${changesByPayout.size} touched payouts (only when new < old):`);
      for (const payoutId of changesByPayout.keys()) {
        const { rows: sumRows } = await client.query(
          `SELECT
              po.status AS status,
              po.final_amount_usd AS old_final,
              p.name AS party_name,
              COALESCE(SUM(CASE WHEN pd.ocr_amount IS NOT NULL THEN pd.ocr_amount ELSE 0 END), 0) AS db_sum_usd
            FROM payouts po
            JOIN parties p ON p.id = po.party_id
            LEFT JOIN payout_documents pd ON pd.payout_id = po.id AND pd.kind = 'receipt'
           WHERE po.id = $1
           GROUP BY po.id, po.status, po.final_amount_usd, p.name`,
          [payoutId],
        );
        const r = sumRows[0];
        if (!r) continue;
        if (!['pending', 'approved', 'failed'].includes(r.status)) {
          console.log(`[backfill]   payout=${payoutId} (${r.party_name}) status=${r.status} — skipping recompute`);
          continue;
        }
        // In dry-run, projected sum = db_sum - sum-of-old-USD-for-this-payout
        //                            + sum-of-new-USD-for-this-payout
        const proj = projectedDocChanges.get(payoutId) || { oldSum: 0, newSum: 0 };
        const dbSum = Number(r.db_sum_usd);
        const newSum = args.apply
          ? Math.round(dbSum * 100) / 100  // already mutated
          : Math.round((dbSum - proj.oldSum + proj.newSum) * 100) / 100;
        const oldFinal = Number(r.old_final);
        if (newSum >= oldFinal) {
          console.log(
            `[backfill]   payout=${payoutId} (${r.party_name}) status=${r.status} `
            + `old_final=$${oldFinal.toFixed(2)} projected_new_sum=$${newSum.toFixed(2)} — keep old (was clamped to cap)`,
          );
          continue;
        }
        console.log(
          `[backfill]   payout=${payoutId} (${r.party_name}) status=${r.status} `
          + `old_final=$${oldFinal.toFixed(2)} → new_final=$${newSum.toFixed(2)} (delta=$${(newSum - oldFinal).toFixed(2)})`,
        );
        if (args.apply) {
          await client.query(
            `UPDATE payouts SET final_amount_usd = $2, updated_at = NOW() WHERE id = $1`,
            [payoutId, newSum],
          );
        }
      }
    }

    console.log('\n[backfill] per-country summary:');
    for (const [cc, acc] of summaryByCountry.entries()) {
      console.log(
        `  ${cc}: ${acc.docs} receipts, `
        + `old-USD-sum=$${acc.oldUsdSum.toFixed(2)} → new-USD-sum=$${acc.newUsdSum.toFixed(2)} `
        + `(delta=$${(acc.newUsdSum - acc.oldUsdSum).toFixed(2)})`,
      );
    }
    console.log(`\n[backfill] done. mode=${args.apply ? 'APPLIED' : 'DRY-RUN'} docs_changed=${args.apply ? appliedDocs : rows.length - skippedNoMapping} skipped_no_mapping=${skippedNoMapping}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[backfill] failed:', err);
  process.exit(1);
});
