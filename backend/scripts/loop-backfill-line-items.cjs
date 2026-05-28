#!/usr/bin/env node
/**
 * provola-92103: loops the /api/admin/payouts/backfill-line-items endpoint
 * until done. The endpoint hard-caps each call at 50 receipts and throttles
 * 500ms between OCR calls; this driver simply re-POSTs until `remaining=0`.
 *
 * Usage:
 *   ADMIN_JWT=eyJ... node backend/scripts/loop-backfill-line-items.cjs
 *
 * Get the JWT from your browser devtools (login to rsv.pizza as admin →
 * Network → any /api/admin/* request → Request Headers → Authorization).
 *
 * Optional env:
 *   API_BASE  — default https://api.rsv.pizza
 *   BATCH     — per-call limit, default 25 (server caps at 50)
 */
const API = process.env.API_BASE || 'https://api.rsv.pizza';
const TOKEN = process.env.ADMIN_JWT;
if (!TOKEN) {
  console.error('Set ADMIN_JWT env var');
  process.exit(1);
}
const BATCH = Number(process.env.BATCH || 25);

(async () => {
  let total = 0;
  while (true) {
    const res = await fetch(`${API}/api/admin/payouts/backfill-line-items`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ limit: BATCH }),
    });
    if (!res.ok) {
      console.error('HTTP ' + res.status + ': ' + (await res.text()));
      process.exit(1);
    }
    const j = await res.json();
    total += j.succeeded;
    console.log(
      `+ ${j.succeeded} (${j.failed.length} failed) — remaining: ${j.remaining}`,
    );
    if (j.done) break;
  }
  console.log(`Done. Total succeeded: ${total}.`);
})();
