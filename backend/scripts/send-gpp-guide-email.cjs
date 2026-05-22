#!/usr/bin/env node
/* eslint-disable no-console */
/*
 * One-off broadcast: send approved GPP 2026 hosts (and their non-partner co-hosts)
 * a link to their Party Guide tab.
 *
 * Task: focaccia-58247
 *
 * USAGE:
 *   node backend/scripts/send-gpp-guide-email.cjs --help
 *   node backend/scripts/send-gpp-guide-email.cjs --dry-run
 *   node backend/scripts/send-gpp-guide-email.cjs --send --confirm
 *   node backend/scripts/send-gpp-guide-email.cjs --send --only=a@b.com,c@d.com
 *   node backend/scripts/send-gpp-guide-email.cjs --send --confirm --skip-already-sent
 *
 * No new deps. Uses `pg` + `dotenv` (both already in backend/package.json).
 * Does NOT import from ../src/ or @prisma/client.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// Load .env.local first (real secrets live there per project convention),
// then .env fills in any gaps. dotenv doesn't overwrite existing keys.
const _envLocal = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(_envLocal)) require('dotenv').config({ path: _envLocal });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

const HELP_TEXT = `
send-gpp-guide-email.cjs — one-off GPP Party Guide broadcast

USAGE:
  node backend/scripts/send-gpp-guide-email.cjs --help
  node backend/scripts/send-gpp-guide-email.cjs --dry-run
  node backend/scripts/send-gpp-guide-email.cjs --send --confirm
  node backend/scripts/send-gpp-guide-email.cjs --send --only=a@b.com,c@d.com
  node backend/scripts/send-gpp-guide-email.cjs --send --confirm --skip-already-sent

FLAGS:
  --help                  Print this help and exit.
  --dry-run               Query DB, write recipient CSV + sample HTML to OS temp dir.
                          No network calls.
  --send                  Actually POST to Resend. Requires --confirm OR --only.
  --confirm               Required for a full --send (safety guard).
  --only=a@b,c@d          Test-send to a specific comma-separated email allowlist.
                          --confirm is not required when --only is present.
  --skip-already-sent     Read the existing send log and exclude already-sent
                          recipients before batching.

ENV (loaded from backend/.env):
  DATABASE_URL            Postgres connection string. Required.
  RESEND_API_KEY          Resend API key. Required for --send.

OUTPUT FILES (OS temp dir, ${os.tmpdir()}):
  gpp-guide-recipients.csv
  gpp-guide-sample.html
  gpp-guide-send-log.json
`.trim();

function parseArgs(argv) {
  const opts = {
    help: false,
    dryRun: false,
    send: false,
    confirm: false,
    only: null, // null or array<string>
    skipAlreadySent: false,
  };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--send') opts.send = true;
    else if (arg === '--confirm') opts.confirm = true;
    else if (arg === '--skip-already-sent') opts.skipAlreadySent = true;
    else if (arg.startsWith('--only=')) {
      const raw = arg.slice('--only='.length);
      opts.only = raw
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    } else {
      console.error(`Unknown argument: ${arg}`);
      console.error('Run with --help to see usage.');
      process.exit(2);
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Output paths (cross-platform via os.tmpdir)
// ---------------------------------------------------------------------------

const tmpDir = os.tmpdir();
const CSV_PATH = path.join(tmpDir, 'gpp-guide-recipients.csv');
const SAMPLE_PATH = path.join(tmpDir, 'gpp-guide-sample.html');
const LOG_PATH = path.join(tmpDir, 'gpp-guide-send-log.json');

// ---------------------------------------------------------------------------
// Email template (hand-rolled, inline styles)
// ---------------------------------------------------------------------------

const SUBJECT = 'Your Hosting Guide for the Global Pizza Party';
const FROM = 'RSV.Pizza <noreply@rsv.pizza>';

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildPartyGuideEmail(recipient) {
  const firstName =
    (recipient.name && String(recipient.name).split(/\s+/)[0]) || 'host';
  const events = recipient.events || [];
  const single = events.length <= 1;
  const primaryEvent = events[0] || {};
  const primaryUrl = `https://rsv.pizza/host/${primaryEvent.invite_code}/party-guide`;
  const heroSubtitle = single
    ? primaryEvent.event_name || 'your Global Pizza Party'
    : `Your ${events.length} Global Pizza Parties`;
  const introLine = single
    ? "We've put together a Party Guide tab on your host dashboard to help you run a great Global Pizza Party 2026. Everything you need is now one click away."
    : `We've put together a Party Guide tab on each of your host dashboards to help you run great Global Pizza Parties 2026. Everything you need is now one click away — for all ${events.length} of your events.`;

  const ctaBlock = single
    ? `<div style="text-align: center; margin: 30px 0;">
      <a href="${primaryUrl}" style="display: inline-block; background: #ff393a; color: white; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
        Open your Party Guide
      </a>
    </div>

    <p style="font-size: 14px; color: #666; text-align: center; margin: 20px 0;">
      Or paste this link into your browser:<br>
      <a href="${primaryUrl}" style="color: #ff393a; word-break: break-all;">${primaryUrl}</a>
    </p>`
    : `<div style="margin: 30px 0;">
      <p style="font-size: 14px; color: #666; text-align: center; margin: 0 0 16px 0;">Open your Party Guide for each event:</p>
      ${events
        .map((e) => {
          const url = `https://rsv.pizza/host/${e.invite_code}/party-guide`;
          return `<div style="text-align: center; margin: 0 0 10px 0;">
        <a href="${url}" style="display: inline-block; background: #ff393a; color: white; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 15px; min-width: 240px;">
          ${escapeHtml(e.event_name || 'Open Party Guide')}
        </a>
      </div>`;
        })
        .join('\n      ')}
    </div>`;

  const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Your Global Pizza Party guide is ready</title>
  </head>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background: #ffffff;">
    <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 40px 20px; border-radius: 12px; text-align: center; margin-bottom: 30px;">
      <h1 style="color: #ffffff; font-size: 28px; margin: 0 0 10px 0;">Your Party Guide is ready 🍕</h1>
      <p style="color: rgba(255,255,255,0.8); font-size: 16px; margin: 0;">${escapeHtml(heroSubtitle)}</p>
    </div>

    <p style="font-size: 16px; margin-bottom: 20px;">
      Hi ${escapeHtml(firstName)},
    </p>

    <p style="font-size: 16px; margin-bottom: 20px;">
      ${introLine}
    </p>

    <div style="background: #fff4e6; padding: 20px; border-radius: 12px; margin: 30px 0;">
      <h3 style="margin: 0 0 10px 0; color: #ff6b35; font-size: 16px;">Inside the guide:</h3>
      <ul style="margin: 0; padding-left: 20px; color: #444;">
        <li>All the links and media you need</li>
        <li>All the photos you should take</li>
        <li>Reminders on everything you might forget!</li>
      </ul>
    </div>

    ${ctaBlock}

    <div style="border-top: 1px solid #e0e0e0; padding-top: 20px; margin-top: 30px; text-align: center; color: #666; font-size: 13px;">
      <p>Questions? Reply to this email or reach out on <a href="https://t.me/pizzadao" style="color: #ff393a;">Telegram</a>.</p>
      <p style="margin-top: 20px;">
        Happy hosting!<br>
        The PizzaDAO Team
      </p>
      <p style="margin-top: 24px; color: #999; font-size: 11px;">
        Reply STOP to opt out of future broadcasts.
      </p>
    </div>
  </body>
</html>`;

  return { subject: SUBJECT, html, partyGuideUrl: primaryUrl };
}

// ---------------------------------------------------------------------------
// DB query + flattening
// ---------------------------------------------------------------------------

const QUERY = `
SELECT
  p.id           AS party_id,
  p.name         AS event_name,
  p.invite_code,
  p.custom_url,
  p.city,
  p.country,
  p.date         AS event_date,
  p.timezone,
  p.co_hosts,
  u.email        AS host_email,
  u.name         AS host_name
FROM parties p
JOIN "User" u ON p.user_id = u.id
WHERE p.event_type = 'gpp'
  AND p.underboss_status = 'approved'
  AND (p.date IS NULL OR p.date >= CURRENT_DATE)
ORDER BY p.date ASC NULLS LAST;
`;

async function queryRows() {
  const { Client } = require('pg');
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    // Supabase requires SSL in prod; allow self-signed since we don't ship a CA.
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const result = await client.query(QUERY);
    return result.rows;
  } finally {
    await client.end();
  }
}

function flattenAndDedup(rows) {
  const flat = [];
  let partnerSkips = 0;
  for (const row of rows) {
    if (row.host_email && row.host_email.trim()) {
      flat.push({
        email: row.host_email.toLowerCase().trim(),
        name: row.host_name,
        role: 'host',
        invite_code: row.invite_code,
        event_name: row.event_name,
        event_date: row.event_date,
        country: row.country,
      });
    }
    const coHosts = Array.isArray(row.co_hosts) ? row.co_hosts : [];
    for (const ch of coHosts) {
      if (ch && ch.isPartner === true) {
        partnerSkips++;
        continue;
      }
      if (!ch || !ch.email || !ch.email.trim()) continue;
      flat.push({
        email: ch.email.toLowerCase().trim(),
        name: ch.name || row.host_name,
        role: 'cohost',
        invite_code: row.invite_code,
        event_name: row.event_name,
        event_date: row.event_date,
        country: row.country,
      });
    }
  }
  // Dedup by email, accumulating ALL of the recipient's events.
  const byEmail = new Map();
  for (const r of flat) {
    const ev = {
      event_name: r.event_name,
      invite_code: r.invite_code,
      event_date: r.event_date,
      country: r.country,
    };
    const existing = byEmail.get(r.email);
    if (!existing) {
      byEmail.set(r.email, {
        email: r.email,
        name: r.name,
        role: r.role,
        country: r.country,
        events: [ev],
      });
      continue;
    }
    // Defensive: don't add the same event twice (a person listed twice in coHosts).
    if (!existing.events.some((e) => e.invite_code === ev.invite_code)) {
      existing.events.push(ev);
    }
    // Recipient-level role: 'host' if they're a host on ANY of their events.
    if (r.role === 'host' && existing.role !== 'host') {
      existing.role = 'host';
      existing.name = r.name; // prefer host's User.name over co-host display name
    }
  }
  const allDeduped = [...byEmail.values()];
  // Sort each recipient's events by date ASC, NULL dates last.
  for (const r of allDeduped) {
    r.events.sort((a, b) => {
      if (a.event_date && b.event_date) {
        return new Date(a.event_date) - new Date(b.event_date);
      }
      if (a.event_date) return -1;
      if (b.event_date) return 1;
      return 0;
    });
  }
  // Exclude coordinator-style recipients (>20 events). They're added as co-hosts
  // for oversight, not because they're running each party day-of. Emailing them
  // with 30–400 buttons is spam and a deliverability risk.
  const HIGH_VOLUME_THRESHOLD = 20;
  const highVolume = allDeduped.filter((r) => r.events.length > HIGH_VOLUME_THRESHOLD);
  const recipients = allDeduped.filter((r) => r.events.length <= HIGH_VOLUME_THRESHOLD);
  return { flat, recipients, partnerSkips, highVolume };
}

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildCsv(recipients) {
  const header = [
    'email',
    'name',
    'role',
    'event_count',
    'event_names',
    'party_guide_urls',
    'primary_country',
  ].join(',');
  const lines = [header];
  for (const r of recipients) {
    const events = r.events || [];
    const eventNames = events.map((e) => e.event_name).join(' | ');
    const urls = events
      .map((e) => `https://rsv.pizza/host/${e.invite_code}/party-guide`)
      .join(' | ');
    lines.push(
      [r.email, r.name, r.role, events.length, eventNames, urls, r.country]
        .map(csvEscape)
        .join(',')
    );
  }
  return lines.join('\n') + '\n';
}

function topByCountry(recipients, n = 10) {
  const counts = new Map();
  for (const r of recipients) {
    const key = r.country || '(unknown)';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

function countByRole(recipients) {
  let host = 0;
  let cohost = 0;
  for (const r of recipients) {
    if (r.role === 'host') host++;
    else cohost++;
  }
  return { host, cohost };
}

// ---------------------------------------------------------------------------
// Send mode
// ---------------------------------------------------------------------------

async function sendOne(recipient, resendApiKey) {
  const { subject, html } = buildPartyGuideEmail(recipient);
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${resendApiKey}`,
    },
    body: JSON.stringify({
      from: FROM,
      to: [recipient.email],
      subject,
      html,
      headers: {
        'List-Unsubscribe':
          '<mailto:unsubscribe@rsv.pizza?subject=unsubscribe>',
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    const reason = `resend ${resp.status}${body ? ': ' + body.slice(0, 200) : ''}`;
    throw new Error(reason);
  }
}

async function runSend(recipients, opts) {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    console.error('ERROR: RESEND_API_KEY is required for --send mode.');
    console.error('Set it in backend/.env and re-run.');
    process.exit(1);
  }

  // Skip-already-sent: read prior log
  let alreadySent = new Set();
  if (opts.skipAlreadySent) {
    if (fs.existsSync(LOG_PATH)) {
      try {
        const prior = JSON.parse(fs.readFileSync(LOG_PATH, 'utf8'));
        if (Array.isArray(prior.sent)) {
          alreadySent = new Set(prior.sent.map((e) => String(e).toLowerCase()));
        }
        console.log(
          `[skip-already-sent] loaded ${alreadySent.size} prior recipients from ${LOG_PATH}`
        );
      } catch (err) {
        console.error(
          `[skip-already-sent] failed to read prior log at ${LOG_PATH}: ${err.message}`
        );
        process.exit(1);
      }
    } else {
      console.log(
        `[skip-already-sent] no prior log at ${LOG_PATH}; sending to full list.`
      );
    }
  }

  const filtered = recipients.filter((r) => !alreadySent.has(r.email));
  const skippedDueToLog = recipients.length - filtered.length;
  if (skippedDueToLog > 0) {
    console.log(`[skip-already-sent] excluding ${skippedDueToLog} recipients.`);
  }

  const startedAt = new Date().toISOString();
  const results = {
    startedAt,
    finishedAt: null,
    totalAttempted: filtered.length,
    sentCount: 0,
    failedCount: 0,
    sent: [],
    failed: [],
  };

  const N = filtered.length;
  console.log(`Sending to ${N} recipient(s)...`);

  const BATCH_SIZE = 10;
  let attempted = 0;
  for (let i = 0; i < filtered.length; i += BATCH_SIZE) {
    const batch = filtered.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (r) => {
        const idx = ++attempted;
        try {
          await sendOne(r, resendApiKey);
          results.sent.push(r.email);
          results.sentCount++;
          console.log(`[${idx}/${N}] sent to ${r.email}`);
        } catch (err) {
          const reason = err && err.message ? err.message : String(err);
          results.failed.push({ email: r.email, reason });
          results.failedCount++;
          console.log(`[${idx}/${N}] FAILED ${r.email}: ${reason}`);
        }
      })
    );
    if (i + BATCH_SIZE < filtered.length) {
      await new Promise((res) => setTimeout(res, 500));
    }
  }

  results.finishedAt = new Date().toISOString();

  // Merge with prior log so --skip-already-sent stays useful across runs.
  if (opts.skipAlreadySent && alreadySent.size > 0) {
    const priorSent = [...alreadySent];
    const merged = new Set([...priorSent, ...results.sent]);
    results.sent = [...merged];
  }

  fs.writeFileSync(LOG_PATH, JSON.stringify(results, null, 2));
  console.log('');
  console.log(`Done. sent=${results.sentCount} failed=${results.failedCount}`);
  console.log(`Log: ${LOG_PATH}`);
}

// ---------------------------------------------------------------------------
// Dry run
// ---------------------------------------------------------------------------

function runDryRun(flat, recipients, partnerSkips, highVolume) {
  const roleCounts = countByRole(recipients);
  const top = topByCountry(recipients, 10);
  const multiEvent = recipients.filter((r) => r.events.length > 1).length;

  console.log('=== DRY RUN ===');
  console.log(`raw flat count:       ${flat.length}`);
  console.log(`deduped count:        ${recipients.length}`);
  console.log(`partner co-host skip: ${partnerSkips}`);
  console.log(`high-volume excluded: ${highVolume.length} (>20 events each)`);
  if (highVolume.length > 0) {
    for (const r of highVolume) {
      console.log(`  - ${r.email} (${r.events.length} events)`);
    }
  }
  console.log(`multi-event recipients: ${multiEvent}`);
  console.log(`role counts:          host=${roleCounts.host} cohost=${roleCounts.cohost}`);
  console.log('top countries:');
  for (const [c, n] of top) {
    console.log(`  ${c.padEnd(24)} ${n}`);
  }

  // CSV
  fs.writeFileSync(CSV_PATH, buildCsv(recipients));

  // Sample HTML — first 3 recipients, plus the recipient with the most events
  // (if any have >1), so the multi-event design is visually reviewable.
  const samples = recipients.slice(0, 3);
  const mostEvents = [...recipients].sort((a, b) => b.events.length - a.events.length)[0];
  if (mostEvents && mostEvents.events.length > 1 && !samples.includes(mostEvents)) {
    samples.push(mostEvents);
  }
  const blocks = samples.map((r) => {
    const { html } = buildPartyGuideEmail(r);
    return `<!-- recipient: ${escapeHtml(r.email)} (${escapeHtml(r.role)}) -->\n${html}`;
  });
  const sampleHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>GPP Guide Email — sample</title></head>
<body>
${blocks.join('\n<hr>\n')}
</body>
</html>`;
  fs.writeFileSync(SAMPLE_PATH, sampleHtml);

  console.log('');
  console.log(`CSV:    ${CSV_PATH}`);
  console.log(`Sample: ${SAMPLE_PATH}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help || (!opts.dryRun && !opts.send)) {
    console.log(HELP_TEXT);
    process.exit(opts.help ? 0 : 2);
  }

  if (opts.dryRun && opts.send) {
    console.error('ERROR: --dry-run and --send are mutually exclusive.');
    process.exit(2);
  }

  if (opts.send && !opts.confirm && !opts.only) {
    console.error('ERROR: --send requires --confirm (or --only=<emails> for a test send).');
    console.error('Run with --help for usage.');
    process.exit(2);
  }

  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL is required.');
    console.error(`Looked for backend/.env at ${path.join(__dirname, '..', '.env')}`);
    process.exit(1);
  }

  if (opts.send && !process.env.RESEND_API_KEY) {
    console.error('ERROR: RESEND_API_KEY is required for --send mode.');
    process.exit(1);
  }

  console.log('Querying production DB for approved GPP events...');
  const rows = await queryRows();
  console.log(`Got ${rows.length} approved GPP party row(s).`);

  const { flat, recipients, partnerSkips, highVolume } = flattenAndDedup(rows);

  // --only filter (applies in send mode)
  let finalRecipients = recipients;
  if (opts.only && opts.only.length > 0) {
    const allow = new Set(opts.only);
    finalRecipients = recipients.filter((r) => allow.has(r.email));
    console.log(
      `[only] filtered to ${finalRecipients.length} recipient(s) from allowlist of ${opts.only.length}.`
    );
    const matched = new Set(finalRecipients.map((r) => r.email));
    const missing = [...allow].filter((e) => !matched.has(e));
    if (missing.length > 0) {
      console.log(`[only] not in approved-GPP recipient set: ${missing.join(', ')}`);
    }
  }

  if (opts.dryRun) {
    runDryRun(flat, finalRecipients, partnerSkips, highVolume);
    return;
  }

  if (opts.send) {
    await runSend(finalRecipients, opts);
    return;
  }
}

main().catch((err) => {
  console.error('FATAL:', err && err.stack ? err.stack : err);
  process.exit(1);
});
