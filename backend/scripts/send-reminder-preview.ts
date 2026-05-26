// One-shot: send a preview of the T-N-hour reminder email to a test address.
// Reads a real prod event (must have event_image_url) so the flyer block renders.
//
// Usage:
//   vercel env pull --environment=production --scope=pizza-dao .env.prod
//   DOTENV_CONFIG_PATH=.env.prod npx tsx scripts/send-reminder-preview.ts snax@pizzadao.org
//   # optional: override hours bucket (default 4)
//   DOTENV_CONFIG_PATH=.env.prod HOURS=2 npx tsx scripts/send-reminder-preview.ts snax@pizzadao.org
//   rm .env.prod

import 'dotenv/config';
import pg from 'pg';
import { sendReminder, type ReminderEventCtx, type ReminderHours } from '../src/lib/sendReminder.js';

const TO = process.argv[2] || 'snax@pizzadao.org';
const HOURS = (Number(process.env.HOURS) || 4) as ReminderHours;
const PUBLIC_ORIGIN = process.env.PUBLIC_FRONTEND_ORIGIN;

if (!process.env.RESEND_API_KEY) { console.error('RESEND_API_KEY missing'); process.exit(1); }
if (!process.env.UNSUBSCRIBE_SECRET) {
  // Preview-only: prod secret may not be set yet. The unsub link in the
  // preview email won't validate against prod — that's expected.
  process.env.UNSUBSCRIBE_SECRET = 'preview-only-dummy-secret';
  console.warn('UNSUBSCRIBE_SECRET not set — using preview-only dummy (unsub link will be invalid)');
}
if (!([1, 2, 3, 4] as number[]).includes(HOURS)) { console.error(`HOURS must be 1|2|3|4 (got ${HOURS})`); process.exit(1); }

async function main() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const { rows } = await client.query<{
    id: string; name: string; date: Date; timezone: string | null;
    address: string | null; venue_name: string | null; event_image_url: string;
    invite_code: string; custom_url: string | null;
  }>(`
    SELECT id, name, date, timezone, address, venue_name, event_image_url, invite_code, custom_url
    FROM parties
    WHERE event_image_url IS NOT NULL
      AND date IS NOT NULL
    ORDER BY (date >= NOW()) DESC, ABS(EXTRACT(EPOCH FROM (date - NOW()))) ASC
    LIMIT 1
  `);
  await client.end();

  if (rows.length === 0) {
    console.error('No party found with event_image_url + date set');
    process.exit(1);
  }
  const p = rows[0];
  console.log(`Using party: ${p.name} (${p.id}) date=${new Date(p.date).toISOString()}`);

  const ctx: ReminderEventCtx = {
    partyName: p.name,
    partyDate: new Date(p.date),
    partyTimezone: p.timezone,
    partyAddress: p.address,
    partyVenueName: p.venue_name,
    partyImageUrl: p.event_image_url,
    inviteCode: p.invite_code,
    customUrl: p.custom_url,
  };

  const id = await sendReminder(
    { id: 'preview', name: 'Snax', email: TO },
    ctx,
    HOURS,
    PUBLIC_ORIGIN ? { publicOrigin: PUBLIC_ORIGIN } : undefined,
  );
  console.log(`Sent ${HOURS}h reminder preview to ${TO}: ${id}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
