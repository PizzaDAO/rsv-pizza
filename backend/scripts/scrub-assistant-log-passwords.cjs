#!/usr/bin/env node
/**
 * Scrub plaintext event passwords from event_assistant_log (instruction, history,
 * proposed_changes, clarifying_question). Mirrors backend/src/lib/assistantLogRedact.ts.
 *
 *   node --env-file=.env scripts/scrub-assistant-log-passwords.cjs           # dry run
 *   node --env-file=.env scripts/scrub-assistant-log-passwords.cjs --apply   # redact in place
 *
 * Dry run is read-only and prints COUNTS only, never values. --apply runs the UPDATEs in one
 * explicit transaction, each guarded by the original instruction/proposed_changes so a concurrent
 * change wins. No session-level SET (DATABASE_URL is a transaction pooler).
 */
try { require('dotenv').config(); } catch (_) {}
const { PrismaClient } = require('@prisma/client');

const APPLY = process.argv.includes('--apply');
const REDACTED = '[redacted]';
const PASSWORD_PHRASE = /(\bpass(?:word|code|phrase)\b\s*(?:is|to|as|=|:)\s*)(["'“‘]?)([^\s"'”’]+)(["'”’]?)/gi;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function secretsOf(pc) {
  if (!Array.isArray(pc)) return [];
  return pc.filter((c) => c && c.key === 'password' && typeof c.value === 'string' && c.value && c.value !== REDACTED).map((c) => c.value);
}
function redactText(t, secrets) {
  let o = t;
  for (const s of secrets) o = o.replace(new RegExp(esc(s), 'g'), REDACTED);
  return o.replace(PASSWORD_PHRASE, (m, lead, q1, val, q2) => (val === REDACTED ? m : `${lead}${q1}${REDACTED}${q2}`));
}
function redactRow(row) {
  const secrets = secretsOf(row.proposed_changes);
  const pc = Array.isArray(row.proposed_changes)
    ? row.proposed_changes.map((c) => (c && c.key === 'password' && typeof c.value === 'string' ? { ...c, value: REDACTED } : c))
    : row.proposed_changes;
  const history = Array.isArray(row.history)
    ? row.history.map((h) => (h && typeof h.content === 'string' ? { ...h, content: redactText(h.content, secrets) } : h))
    : row.history;
  return {
    instruction: redactText(row.instruction, secrets),
    history,
    proposed_changes: pc,
    clarifying_question: typeof row.clarifying_question === 'string' ? redactText(row.clarifying_question, secrets) : row.clarifying_question,
  };
}

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT id, instruction, history, proposed_changes, clarifying_question FROM event_assistant_log`,
  );
  let withPwChange = 0;
  const toUpdate = [];
  for (const r of rows) {
    if (secretsOf(r.proposed_changes).length) withPwChange++;
    const n = redactRow(r);
    const changed =
      n.instruction !== r.instruction ||
      n.clarifying_question !== r.clarifying_question ||
      JSON.stringify(n.history) !== JSON.stringify(r.history) ||
      JSON.stringify(n.proposed_changes) !== JSON.stringify(r.proposed_changes);
    if (changed) toUpdate.push({ r, n });
  }
  console.log(`mode: ${APPLY ? 'APPLY' : 'dry run'}`);
  console.log(`event_assistant_log rows scanned: ${rows.length}`);
  console.log(`rows with a plaintext password change: ${withPwChange}`);
  console.log(`rows needing redaction: ${toUpdate.length}`);
  if (!APPLY) { console.log('dry run only; re-run with --apply to update.'); return; }

  let updated = 0, skipped = 0;
  await prisma.$transaction(async (tx) => {
    for (const { r, n } of toUpdate) {
      const cnt = await tx.$executeRawUnsafe(
        `UPDATE event_assistant_log
            SET instruction = $1, history = $2::jsonb, proposed_changes = $3::jsonb, clarifying_question = $4
          WHERE id = $5 AND instruction = $6 AND proposed_changes = $7::jsonb`,
        n.instruction,
        n.history == null ? null : JSON.stringify(n.history),
        JSON.stringify(n.proposed_changes),
        n.clarifying_question,
        r.id,
        r.instruction,
        JSON.stringify(r.proposed_changes),
      );
      if (cnt === 1) updated++; else skipped++;
    }
  }, { timeout: 120000 });
  console.log(`updated: ${updated}, skipped (changed concurrently): ${skipped}`);
}

main().catch((e) => { console.error('failed:', e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
