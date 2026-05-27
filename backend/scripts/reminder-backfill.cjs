// One-shot: send hourly-bucketed reminders to every approved guest whose
// event starts in [now+30min, now+4h] and who hasn't been reminded yet.
//
// Dry-run by default. Pass --apply to actually claim + send.
//
// Run from backend/ with prod env pulled:
//   vercel env pull --environment=production --scope=pizza-dao .env.prod
//   DOTENV_CONFIG_PATH=.env.prod node -r dotenv/config scripts/reminder-backfill.cjs
//   # then, after reviewing the dry-run output:
//   DOTENV_CONFIG_PATH=.env.prod node -r dotenv/config scripts/reminder-backfill.cjs --apply
//   rm .env.prod
//
// The email template here MIRRORS backend/src/routes/reminder.routes.ts —
// keep in sync if the deployed template changes.

require('dotenv').config();
const { Client } = require('pg');
const { createHmac } = require('crypto');

const APPLY = process.argv.includes('--apply');
const CONCURRENCY = 5;
const PUBLIC_ORIGIN = process.env.PUBLIC_FRONTEND_ORIGIN || 'https://www.rsv.pizza';
const BACKEND_ORIGIN = process.env.BACKEND_PUBLIC_URL || 'https://api.rsv.pizza';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const UNSUBSCRIBE_SECRET = process.env.UNSUBSCRIBE_SECRET;

if (APPLY && !RESEND_API_KEY) { console.error('RESEND_API_KEY missing (required for --apply)'); process.exit(1); }
if (APPLY && !UNSUBSCRIBE_SECRET) { console.error('UNSUBSCRIBE_SECRET missing (required for --apply)'); process.exit(1); }

// ---------- helpers ----------

function signGuestId(guestId) {
  const mac = createHmac('sha256', UNSUBSCRIBE_SECRET).update(guestId).digest();
  return mac.subarray(0, 16).toString('base64url');
}

function buildUnsubUrl(guestId) {
  return `${BACKEND_ORIGIN}/api/reminders/unsubscribe?g=${guestId}&s=${signGuestId(guestId)}`;
}

function headlineImgUrl(hours) {
  const word = hours === 1 ? 'hour' : 'hours';
  return `${PUBLIC_ORIGIN}/reminder-see-you-in-${hours}-${word}.png`;
}

function formatLocalTime(date, tz) {
  return date.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
    timeZone: tz || undefined,
  });
}
function shortLocalTime(date, tz) {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: tz || undefined,
  });
}

function bucketHours(startTimeMs, nowMs) {
  const hoursAway = (startTimeMs - nowMs) / (60 * 60 * 1000);
  // Round DOWN to nearest hour, clamp [1, 4].
  return Math.max(1, Math.min(4, Math.floor(hoursAway)));
}

function buildHtml({ guestName, whenText, partyName, eventUrl, unsubUrl, venueName, address, imageUrl, headlineImg }) {
  const whereHtml = venueName && address
    ? `<p style="margin: 10px 0;"><strong>Where:</strong> ${venueName}<br><span style="color: #666; font-size: 14px;">${address}</span></p>`
    : `<p style="margin: 10px 0;"><strong>Where:</strong> ${address || venueName || 'Location TBD'}</p>`;
  const flyerBlock = imageUrl
    ? `<div style="text-align: center; margin-bottom: 20px;"><img src="${imageUrl}" alt="${partyName}" style="max-width: 100%; border-radius: 12px;" /></div>`
    : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Reminder: ${partyName}</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
${flyerBlock}
<div style="background: linear-gradient(180deg, #c8e8f2 0%, #9dd5e8 100%); padding: 44px 20px; border-radius: 12px; text-align: center; margin-bottom: 30px;">
  <img src="${headlineImg}" alt="See you soon!" width="540" style="display: block; margin: 0 auto; max-width: 100%; height: auto;" />
</div>
<div style="background: #f9f9f9; padding: 30px; border-radius: 12px; margin-bottom: 20px;">
  <h2 style="color: #1a1a2e; margin-top: 0; margin-bottom: 20px;">${partyName}</h2>
  <p style="margin: 10px 0;"><strong>When:</strong> ${whenText}</p>
  ${whereHtml}
</div>
<div style="text-align: center; margin: 30px 0;">
  <a href="${eventUrl}" style="display: inline-block; background: #ff393a; color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">View Event Page</a>
</div>
<div style="border-top: 1px solid #e0e0e0; padding-top: 20px; margin-top: 30px; text-align: center; color: #666; font-size: 14px;">
  <p>See you there, ${guestName}!</p>
</div>
<div style="text-align: center; color: #999; font-size: 12px; margin-top: 30px;">
  <p>You're receiving this because you RSVP'd to ${partyName} on RSV.Pizza.<br>
  <a href="${unsubUrl}" style="color: #999; text-decoration: underline;">Unsubscribe from reminders for this event</a></p>
</div>
</body></html>`;
}

function buildText({ guestName, whenText, addressText, partyName, eventUrl, unsubUrl, hours }) {
  const hoursWord = hours === 1 ? 'hour' : 'hours';
  return [
    `Hi ${guestName},`, '',
    `Quick reminder — ${partyName} starts in about ${hours} ${hoursWord}.`, '',
    `When: ${whenText}`,
    `Where: ${addressText}`, '',
    `Event page: ${eventUrl}`, '',
    `See you there!`, '',
    `--`,
    `You're receiving this because you RSVP'd to ${partyName} on RSV.Pizza.`,
    `Unsubscribe from reminders for this event: ${unsubUrl}`,
  ].join('\n');
}

// Sliding worker pool.
async function pool(items, limit, fn) {
  let next = 0;
  const results = new Array(items.length);
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try { results[i] = { ok: true, value: await fn(items[i]) }; }
      catch (e) { results[i] = { ok: false, error: e }; }
    }
  });
  await Promise.all(workers);
  return results;
}

async function sendOne(guest, party, client) {
  const now = Date.now();
  const hours = bucketHours(new Date(party.date).getTime(), now);
  const whenText = formatLocalTime(new Date(party.date), party.timezone);
  const timeOnly = shortLocalTime(new Date(party.date), party.timezone);
  const addressText = party.venue_name && party.address ? `${party.venue_name}, ${party.address}` : (party.venue_name || party.address || 'Location TBD');
  const slug = party.custom_url || party.invite_code;
  const eventUrl = `https://rsv.pizza/${slug}`;
  const unsubUrl = buildUnsubUrl(guest.id);
  const headlineImg = headlineImgUrl(hours);

  const subject = `Tonight at ${timeOnly}: ${party.name} 🍕`;
  const html = buildHtml({
    guestName: guest.name, whenText, partyName: party.name,
    eventUrl, unsubUrl, venueName: party.venue_name, address: party.address,
    imageUrl: party.event_image_url, headlineImg,
  });
  const text = buildText({ guestName: guest.name, whenText, addressText, partyName: party.name, eventUrl, unsubUrl, hours });

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'RSV.Pizza <noreply@rsv.pizza>',
      to: [guest.email], subject, html, text,
      headers: {
        'List-Unsubscribe': `<${unsubUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
  return hours;
}

// ---------- main ----------

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  // Filter at SQL level — bucket math + send happens in JS.
  // Window: 30 minutes from now → 4 hours from now.
  // Exclude T-4h ± 15min so we don't race the regular cron (events in [3h45m, 4h15m]).
  // Result: this picks up [30min, 3h45m] AND keeps [4h15m, 4h] (the regular cron
  // will catch the latter at next tick if not picked here, but we already exclude
  // them via the upper bound NOW()+4h — so effectively [30min, 4h] minus the
  // overlap window).
  const queryParams = [];
  const sql = `
    SELECT
      g.id, g.name, g.email,
      p.id AS party_id, p.name AS party_name, p.date, p.timezone,
      p.address, p.venue_name, p.event_image_url, p.invite_code, p.custom_url
    FROM guests g
    JOIN parties p ON p.id = g.party_id
    WHERE g.approved = TRUE
      AND g.email IS NOT NULL
      AND g.reminders_unsubscribed = FALSE
      AND g.reminder_sent_at IS NULL
      AND p.reminders_enabled = TRUE
      AND p.cancelled_at IS NULL
      AND p.date IS NOT NULL
      AND p.date >= NOW() + INTERVAL '30 minutes'
      AND p.date <= NOW() + INTERVAL '4 hours'
    ORDER BY p.date ASC
  `;
  const { rows } = await client.query(sql);

  // Bucket distribution preview.
  const now = Date.now();
  const buckets = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const row of rows) buckets[bucketHours(new Date(row.date).getTime(), now)]++;

  console.log(`\n=== Reminder backfill — ${APPLY ? 'APPLY' : 'DRY RUN'} ===`);
  console.log(`Eligible guests: ${rows.length}`);
  console.log(`Bucket distribution:`);
  for (const [h, n] of Object.entries(buckets)) console.log(`  ${h}h: ${n}`);

  if (!APPLY) {
    console.log(`\nDry run — no emails sent. Sample (first 5):`);
    for (const r of rows.slice(0, 5)) {
      const h = bucketHours(new Date(r.date).getTime(), now);
      console.log(`  ${h}h | ${r.email} | ${r.party_name} (${shortLocalTime(new Date(r.date), r.timezone)})`);
    }
    console.log(`\nRe-run with --apply to send.`);
    await client.end();
    return;
  }

  // APPLY: claim atomically (set reminder_sent_at), then send.
  // Per-row claim so we can roll back individually on failure.
  const ids = rows.map(r => r.id);
  const { rows: claimed } = await client.query(`
    UPDATE guests SET reminder_sent_at = NOW()
    WHERE id = ANY($1::uuid[]) AND reminder_sent_at IS NULL
    RETURNING id
  `, [ids]);
  const claimedSet = new Set(claimed.map(c => c.id));
  const toSend = rows.filter(r => claimedSet.has(r.id));
  console.log(`Claimed ${toSend.length}/${rows.length} (others were claimed by regular cron in the meantime)`);

  const results = await pool(toSend, CONCURRENCY, async (row) => {
    const party = {
      id: row.party_id, name: row.party_name, date: row.date,
      timezone: row.timezone, address: row.address, venue_name: row.venue_name,
      event_image_url: row.event_image_url, invite_code: row.invite_code, custom_url: row.custom_url,
    };
    return sendOne(row, party, client);
  });

  const failed = [];
  let sent = 0;
  const sentByBucket = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (let i = 0; i < results.length; i++) {
    if (results[i].ok) {
      sent++;
      sentByBucket[results[i].value]++;
    } else {
      failed.push({ id: toSend[i].id, email: toSend[i].email, err: String(results[i].error) });
    }
  }

  // Roll back claims for failures.
  if (failed.length > 0) {
    await client.query(`UPDATE guests SET reminder_sent_at = NULL WHERE id = ANY($1::uuid[])`, [failed.map(f => f.id)]);
  }

  console.log(`\n=== Done ===`);
  console.log(`Sent: ${sent}`);
  console.log(`  by bucket: ${JSON.stringify(sentByBucket)}`);
  console.log(`Failed: ${failed.length} (claims rolled back)`);
  for (const f of failed.slice(0, 10)) console.log(`  ${f.email}: ${f.err.slice(0, 200)}`);

  await client.end();
})().catch(err => { console.error(err); process.exit(1); });
