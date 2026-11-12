#!/usr/bin/env node
/**
 * guests-anon-exposure step S1: apply Migration A (20261112_guests_broadcast_trigger).
 * Statement-level triggers on public.guests that call realtime.send() with a payload of
 * {"op": ...} (no guest data, no ids) on topic guests:<party_id>, event "guests_changed".
 * Additive and idempotent. The trigger function swallows its own errors (EXCEPTION block), so a
 * broadcast failure can never fail a guest write.
 *
 * Modes (exactly one; default is a read-only dry run):
 *   (none)      dry run: read-only. Shows current trigger/function state, whether realtime.send
 *               and today's realtime.messages partition exist, and the statements it would run.
 *   --apply     runs the migration in ONE transaction (SET LOCAL lock_timeout), verifies the
 *               triggers/function INSIDE the transaction (rolls back on problems), re-verifies
 *               after commit, then runs the delivery proof (below).
 *   --verify    verification only: trigger/function checks + the delivery proof. NOT read-only:
 *               the delivery proof calls realtime.send on a throwaway topic (writes one ephemeral
 *               row to realtime.messages; touches no app table).
 *   --rollback  DROP the 3 triggers and the function (one transaction).
 *
 * Delivery proof (plan S2): subscribes with the PUBLIC key (env SUPABASE_ANON_KEY) to the
 * throwaway topic guests:<random uuid> as a plain (public, non-private) broadcast channel, calls
 * realtime.send with exactly the arguments the trigger uses, and requires the message to arrive
 * within 10s with payload keys ['op'] only. This proves "allow public channels" is on, the
 * realtime.messages partition exists, and the public key can receive it. Skipped (with a clear
 * note) when SUPABASE_ANON_KEY is not set. The trigger's own code path is covered by the
 * function/trigger checks, not by writing to guests.
 *
 *   node backend/scripts/apply-guests-broadcast-trigger.cjs [--apply|--verify|--rollback]
 *
 * No session-level SET anywhere (DATABASE_URL is the 6543 transaction pooler); only SET LOCAL
 * inside a transaction. Prints names/counts, never values.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

const MODE = process.argv.includes('--apply') ? 'apply'
  : process.argv.includes('--verify') ? 'verify'
  : process.argv.includes('--rollback') ? 'rollback'
  : 'dry';
const prisma = new PrismaClient();
const MIGRATION = path.join(__dirname, '../prisma/migrations/20261112_guests_broadcast_trigger/migration.sql');
const TX_OPTS = { timeout: 60000, maxWait: 15000 };
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://znpiwdvvsqaxuskpfleo.supabase.co';
const TRIGGERS = [
  { name: 'trg_guests_broadcast_ins', event: 4 },
  { name: 'trg_guests_broadcast_upd', event: 16 },
  { name: 'trg_guests_broadcast_del', event: 8 },
];
const ROLLBACK_SQL = [
  'DROP TRIGGER IF EXISTS trg_guests_broadcast_ins ON public.guests',
  'DROP TRIGGER IF EXISTS trg_guests_broadcast_upd ON public.guests',
  'DROP TRIGGER IF EXISTS trg_guests_broadcast_del ON public.guests',
  'DROP FUNCTION IF EXISTS public.broadcast_guests_changed()',
];

/** Split a SQL file into statements, respecting $$ dollar quoting and -- comments. */
function splitStatements(sql) {
  const out = [];
  let cur = '';
  let inDollar = false;
  for (let i = 0; i < sql.length; i++) {
    if (!inDollar && sql.startsWith('--', i)) { // line comment outside a dollar quote
      while (i < sql.length && sql[i] !== '\n') i++;
      continue;
    }
    if (sql.startsWith('$$', i)) { inDollar = !inDollar; cur += '$$'; i++; continue; }
    if (!inDollar && sql[i] === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += sql[i];
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

async function state(db) {
  const fn = await db.$queryRawUnsafe(`
    SELECT p.prosecdef AS secdef, p.proconfig AS config,
           has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'broadcast_guests_changed'`);
  const trg = await db.$queryRawUnsafe(`
    SELECT t.tgname AS name, t.tgtype::int AS tgtype, t.tgenabled AS enabled,
           t.tgoldtable AS oldtable, t.tgnewtable AS newtable
    FROM pg_trigger t WHERE t.tgrelid = 'public.guests'::regclass AND NOT t.tgisinternal
      AND t.tgname LIKE 'trg_guests_broadcast_%'`);
  return { fn: fn[0] || null, trg };
}

function problemsOf(s) {
  const p = [];
  if (!s.fn) { p.push('function public.broadcast_guests_changed() missing'); }
  else {
    if (!s.fn.secdef) p.push('function is not SECURITY DEFINER');
    if (s.fn.anon_exec) p.push('anon can EXECUTE the function');
    if (s.fn.auth_exec) p.push('authenticated can EXECUTE the function');
    if (!/search_path/.test(JSON.stringify(s.fn.config || []))) p.push('function has no pinned search_path');
  }
  for (const want of TRIGGERS) {
    const t = s.trg.find((x) => x.name === want.name);
    if (!t) { p.push(`trigger ${want.name} missing`); continue; }
    if (t.tgtype & 1) p.push(`${want.name} is ROW-level (must be statement-level)`);
    if (t.tgtype & 2) p.push(`${want.name} is BEFORE (must be AFTER)`);
    if (!(t.tgtype & want.event)) p.push(`${want.name} has the wrong event`);
    if (t.enabled !== 'O') p.push(`${want.name} is not enabled (tgenabled=${t.enabled})`);
    if (want.event !== 4 && !t.oldtable) p.push(`${want.name} has no OLD transition table`);
    if (want.event !== 8 && !t.newtable) p.push(`${want.name} has no NEW transition table`);
  }
  return p;
}

async function realtimeFacts(db) {
  const send = await db.$queryRawUnsafe(`
    SELECT p.oid::regprocedure::text AS sig, has_function_privilege('postgres', p.oid, 'EXECUTE') AS ok
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'realtime' AND p.proname = 'send'`);
  const parts = await db.$queryRawUnsafe(`
    SELECT count(*)::int AS n FROM pg_inherits i
    WHERE i.inhparent = 'realtime.messages'::regclass`);
  const today = await db.$queryRawUnsafe(`
    SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'realtime' AND c.relname = 'messages_' || to_char(now() AT TIME ZONE 'utc', 'YYYY_MM_DD')`);
  const pub = await db.$queryRawUnsafe(`
    SELECT count(*)::int AS n FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'guests'`);
  return { send, partitions: parts[0].n, todayPartition: today[0].n, guestsInPublication: pub[0].n };
}

async function deliveryProof() {
  const key = process.env.SUPABASE_ANON_KEY;
  if (!key) {
    console.log('SKIP delivery proof: SUPABASE_ANON_KEY not set (export the public key and run --verify).');
    return true;
  }
  const { createClient } = require('@supabase/supabase-js');
  const probeParty = crypto.randomUUID();
  const topic = `guests:${probeParty}`;
  const sb = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  let timer;
  const received = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), 10000);
    const ch = sb.channel(topic, { config: { private: false, broadcast: { self: false } } })
      .on('broadcast', { event: 'guests_changed' }, (msg) => { clearTimeout(timer); resolve(msg); })
      .subscribe(async (status, err) => {
        if (status === 'SUBSCRIBED') {
          try {
            await prisma.$executeRawUnsafe(
              `SELECT realtime.send(jsonb_build_object('op','insert'), 'guests_changed', $1, false)`, topic);
          } catch (e) { console.log('realtime.send failed:', String(e.message).split('\n').pop()); clearTimeout(timer); resolve(null); }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.log(`subscribe ${status}${err ? ': ' + err.message : ''}`);
          clearTimeout(timer); resolve(null);
        }
      });
    void ch;
  });
  const msg = await received;
  try { await sb.removeAllChannels(); } catch { /* ignore */ }
  const mrow = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM realtime.messages WHERE topic = $1`, topic).catch(() => [{ n: '?' }]);
  console.log(`realtime.messages rows for the probe topic: ${mrow[0].n}`);
  if (!msg) {
    console.log('FAIL delivery proof: no broadcast received within 10s (public channels disabled? missing partition? key rejected?)');
    return false;
  }
  const keys = Object.keys((msg && msg.payload) || {}).sort();
  const ok = JSON.stringify(keys) === JSON.stringify(['op']);
  console.log(`${ok ? 'OK  ' : 'FAIL'} delivery proof: public-key subscriber received 'guests_changed'; payload keys = ${JSON.stringify(keys)}`);
  return ok;
}

async function main() {
  console.log(`\n=== guests broadcast trigger (${MODE.toUpperCase()}) ===\n`);

  if (MODE === 'rollback') {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '5s'`);
      for (const s of ROLLBACK_SQL) await tx.$executeRawUnsafe(s);
    }, TX_OPTS);
    const s = await state(prisma);
    const gone = !s.fn && s.trg.length === 0;
    console.log(gone ? 'OK   triggers and function dropped' : 'FAIL leftovers: ' + JSON.stringify(s));
    if (!gone) process.exit(1);
    return;
  }

  if (MODE === 'verify') {
    const s = await state(prisma);
    const problems = problemsOf(s);
    console.log(`trigger/function problems: ${problems.length}`);
    for (const p of problems) console.log('  - ' + p);
    const proof = await deliveryProof();
    if (problems.length || !proof) process.exit(1);
    console.log('\nOK   triggers present + delivery proven');
    return;
  }

  const before = await state(prisma);
  const rt = await realtimeFacts(prisma);
  console.log('function now:', before.fn ? `present, SECURITY DEFINER=${before.fn.secdef}` : '(missing)');
  console.log('triggers now:', before.trg.map((t) => t.name).join(', ') || '(none)');
  console.log('realtime.send overloads:', rt.send.map((r) => `${r.sig} (postgres EXECUTE=${r.ok})`).join('; ') || '(NONE - cannot apply)');
  console.log(`realtime.messages partitions: ${rt.partitions}; today's partition exists: ${rt.todayPartition === 1}`);
  console.log(`guests in supabase_realtime publication: ${rt.guestsInPublication === 1} (unchanged by this migration)`);
  const stmts = splitStatements(fs.readFileSync(MIGRATION, 'utf8'));
  console.log(`\n${MODE === 'apply' ? 'Running' : 'Would run'} ${stmts.length} statements:`);
  for (const s of stmts) console.log('  ' + s.replace(/\s+/g, ' ').slice(0, 110) + (s.length > 110 ? ' ...' : ''));
  if (MODE === 'dry') { console.log('\nDry run only (read-only). Re-run with --apply; then --verify for the delivery proof.'); return; }

  if (!rt.send.length) { console.error('REFUSING: realtime.send() does not exist in this project.'); process.exit(1); }
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '5s'`);
    for (const s of stmts) await tx.$executeRawUnsafe(s);
    const problems = problemsOf(await state(tx));
    if (problems.length) throw new Error(`verification failed inside txn (rolled back): ${problems.join('; ')}`);
  }, TX_OPTS);
  const problems = problemsOf(await state(prisma));
  console.log(`applied ${stmts.length} statements; post-commit problems: ${problems.length}`);
  for (const p of problems) console.log('  - ' + p);
  const proof = await deliveryProof();
  if (problems.length || !proof) { console.log('\nFAIL - consider --rollback'); process.exit(1); }
  console.log('\nOK   3 statement-level triggers present, function is SECURITY DEFINER with no anon EXECUTE, delivery proven');
}

main().catch((e) => { console.error('FAILED:', e.message); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); setTimeout(() => process.exit(), 200).unref(); });
