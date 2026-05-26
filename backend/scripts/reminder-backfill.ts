// One-shot: send hourly-bucketed reminders to every approved guest whose
// event starts in [NOW()+30min, NOW()+4h] and who hasn't been reminded yet.
//
// Dry-run by default. Pass --apply to actually claim + send via resend.batch.send().
//
// Run from backend/ with prod env pulled:
//   vercel env pull --environment=production --scope=pizza-dao .env.prod
//   DOTENV_CONFIG_PATH=.env.prod npx tsx scripts/reminder-backfill.ts
//   # then, after reviewing the dry-run output:
//   DOTENV_CONFIG_PATH=.env.prod npx tsx scripts/reminder-backfill.ts --apply
//   rm .env.prod

import 'dotenv/config';
import pg from 'pg';
import {
  buildReminderPayload,
  getResend,
  REMINDER_FROM,
  shortLocalTime,
  type ReminderEventCtx,
  type ReminderHours,
} from '../src/lib/sendReminder.js';

const APPLY = process.argv.includes('--apply');
const BATCH_SIZE = 100;        // Resend batch limit
const BATCH_DELAY_MS = 1000;   // gentle pacing between batches

if (APPLY) {
  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY missing (required for --apply)');
    process.exit(1);
  }
  if (!process.env.UNSUBSCRIBE_SECRET) {
    console.error('UNSUBSCRIBE_SECRET missing (required for --apply)');
    process.exit(1);
  }
}

type GuestRow = {
  id: string;
  name: string;
  email: string;
  party_id: string;
  party_name: string;
  date: Date;
  timezone: string | null;
  address: string | null;
  venue_name: string | null;
  event_image_url: string | null;
  invite_code: string;
  custom_url: string | null;
};

function bucketHours(startTimeMs: number, nowMs: number): ReminderHours {
  const hoursAway = (startTimeMs - nowMs) / (60 * 60 * 1000);
  return Math.max(1, Math.min(4, Math.floor(hoursAway))) as ReminderHours;
}

function ctxFromRow(row: GuestRow): ReminderEventCtx {
  return {
    partyName: row.party_name,
    partyDate: new Date(row.date),
    partyTimezone: row.timezone,
    partyAddress: row.address,
    partyVenueName: row.venue_name,
    partyImageUrl: row.event_image_url,
    inviteCode: row.invite_code,
    customUrl: row.custom_url,
  };
}

async function main() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const { rows } = await client.query<GuestRow>(`
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
  `);

  const now = Date.now();
  const buckets: Record<ReminderHours, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const r of rows) buckets[bucketHours(new Date(r.date).getTime(), now)]++;

  console.log(`\n=== Reminder backfill — ${APPLY ? 'APPLY' : 'DRY RUN'} ===`);
  console.log(`Eligible guests: ${rows.length}`);
  console.log(`Bucket distribution:`);
  for (const h of [1, 2, 3, 4] as ReminderHours[]) console.log(`  ${h}h: ${buckets[h]}`);

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

  // Claim atomically.
  const ids = rows.map((r) => r.id);
  const claimed = await client.query<{ id: string }>(
    `UPDATE guests SET reminder_sent_at = NOW()
     WHERE id = ANY($1::uuid[]) AND reminder_sent_at IS NULL
     RETURNING id`,
    [ids],
  );
  const claimedSet = new Set(claimed.rows.map((c) => c.id));
  const toSend = rows.filter((r) => claimedSet.has(r.id));
  console.log(
    `Claimed ${toSend.length}/${rows.length} (others were claimed by regular cron in the meantime)`,
  );

  const resend = getResend();
  const sentByBucket: Record<ReminderHours, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const failed: { id: string; email: string; err: string }[] = [];
  let totalSent = 0;

  for (let i = 0; i < toSend.length; i += BATCH_SIZE) {
    const chunk = toSend.slice(i, i + BATCH_SIZE);

    // Build all payloads in this chunk in parallel — render is local.
    const payloads = await Promise.all(
      chunk.map(async (row) => {
        const hours = bucketHours(new Date(row.date).getTime(), now);
        const p = await buildReminderPayload(
          { id: row.id, name: row.name, email: row.email },
          ctxFromRow(row),
          hours,
        );
        return {
          from: REMINDER_FROM,
          to: [p.to],
          subject: p.subject,
          html: p.html,
          text: p.text,
          headers: {
            'List-Unsubscribe': `<${p.unsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
          // sidecar: not sent to Resend, used to attribute results.
          _row: row,
          _hours: hours,
        };
      }),
    );

    // Strip sidecar fields before posting.
    const batch = payloads.map(({ _row, _hours, ...rest }) => rest);

    let batchResp: Awaited<ReturnType<typeof resend.batch.send>>;
    try {
      batchResp = await resend.batch.send(batch);
    } catch (e) {
      // Whole batch threw — mark all as failed in this chunk.
      for (const p of payloads) {
        failed.push({ id: p._row.id, email: p._row.email, err: String(e) });
      }
      continue;
    }

    if (batchResp.error) {
      for (const p of payloads) {
        failed.push({ id: p._row.id, email: p._row.email, err: JSON.stringify(batchResp.error) });
      }
    } else {
      // Resend returns success per item (no per-row error in batch v1).
      // Treat the whole chunk as sent on success.
      for (const p of payloads) {
        totalSent++;
        sentByBucket[p._hours]++;
      }
    }

    if (i + BATCH_SIZE < toSend.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }

    console.log(
      `  Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(toSend.length / BATCH_SIZE)} done (running: sent=${totalSent} failed=${failed.length})`,
    );
  }

  // Roll back claims for failures.
  if (failed.length > 0) {
    await client.query(
      `UPDATE guests SET reminder_sent_at = NULL WHERE id = ANY($1::uuid[])`,
      [failed.map((f) => f.id)],
    );
  }

  console.log(`\n=== Done ===`);
  console.log(`Sent: ${totalSent}`);
  console.log(`  by bucket: ${JSON.stringify(sentByBucket)}`);
  console.log(`Failed: ${failed.length} (claims rolled back)`);
  for (const f of failed.slice(0, 10)) console.log(`  ${f.email}: ${f.err.slice(0, 200)}`);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
