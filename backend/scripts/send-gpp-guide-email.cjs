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

const SUBJECT = 'Your Global Pizza Party guide is ready 🍕';
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
  const partyGuideUrl = `https://rsv.pizza/host/${recipient.invite_code}/party-guide`;
  const eventName = recipient.event_name || 'your Global Pizza Party';

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
      <p style="color: rgba(255,255,255,0.8); font-size: 16px; margin: 0;">${escapeHtml(eventName)}</p>
    </div>

    <p style="font-size: 16px; margin-bottom: 20px;">
      Hi ${escapeHtml(firstName)},
    </p>

    <p style="font-size: 16px; margin-bottom: 20px;">
      We've put together a Party Guide tab on your host dashboard to help you run a great Global Pizza Party 2026. Everything you need is now one click away.
    </p>

    <div style="background: #fff4e6; padding: 20px; border-radius: 12px; margin: 30px 0;">
      <h3 style="margin: 0 0 10px 0; color: #ff6b35; font-size: 16px;">Inside the guide:</h3>
      <ul style="margin: 0; padding-left: 20px; color: #444;">
        <li>All the links and media you need</li>
        <li>All the photos you should take</li>
        <li>Reminders on everything you might forget!</li>
      </ul>
    </div>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${partyGuideUrl}" style="display: inline-block; background: #ff393a; color: white; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
        Open your Party Guide
      </a>
    </div>

    <p style="font-size: 14px; color: #666; text-align: center; margin: 20px 0;">
      Or paste this link into your browser:<br>
      <a href="${partyGuideUrl}" style="color: #ff393a; word-break: break-all;">${partyGuideUrl}</a>
    </p>

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

  return { subject: SUBJECT, html, partyGuideUrl };
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
JOIN users u ON p.user_id = u.id
WHERE p.event_type = 'gpp'
  AND p.underboss_status = 'approved'
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
  const byEmail = new Map();
  for (const r of flat) {
    const existing = byEmail.get(r.email);
    if (!existing) {
      byEmail.set(r.email, r);
      continue;
    }
    const promoteToHost = r.role === 'host' && existing.role !== 'host';
    const earlier =
      r.event_date &&
      (!existing.event_date ||
        new Date(r.event_date) < new Date(existing.event_date));
    if (promoteToHost || earlier) byEmail.set(r.email, r);
  }
  const recipients = [...byEmail.values()];
  return { flat, recipients, partnerSkips };
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
    'event_name',
    'invite_code',
    'country',
    'party_guide_url',
  ].join(',');
  const lines = [header];
  for (const r of recipients) {
    const url = `https://rsv.pizza/host/${r.invite_code}/party-guide`;
    lines.push(
      [r.email, r.name, r.role, r.event_name, r.invite_code, r.country, url]
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

function runDryRun(flat, recipients, partnerSkips) {
  const roleCounts = countByRole(recipients);
  const top = topByCountry(recipients, 10);

  console.log('=== DRY RUN ===');
  console.log(`raw flat count:       ${flat.length}`);
  console.log(`deduped count:        ${recipients.length}`);
  console.log(`partner co-host skip: ${partnerSkips}`);
  console.log(`role counts:          host=${roleCounts.host} cohost=${roleCounts.cohost}`);
  console.log('top countries:');
  for (const [c, n] of top) {
    console.log(`  ${c.padEnd(24)} ${n}`);
  }

  // CSV
  fs.writeFileSync(CSV_PATH, buildCsv(recipients));

  // Sample HTML — first 3 recipients
  const samples = recipients.slice(0, 3);
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

  const { flat, recipients, partnerSkips } = flattenAndDedup(rows);

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
    runDryRun(flat, finalRecipients, partnerSkips);
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
