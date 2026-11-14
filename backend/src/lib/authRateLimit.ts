/**
 * durable-rate-limits: cross-instance counters for the sign-in code budgets (lib/loginCode.ts).
 *
 * #1253 kept the per-IP and per-(email, IP) budgets in memory, so on Vercel each warm
 * serverless instance had its own copy and an attacker's effective budget grew with the
 * number of instances. These counters live in Postgres (`auth_rate_events`) instead, one row
 * per reserved event, so every instance sees the same counts.
 *
 * Atomicity: `reserve` runs ONE transaction:
 *   1. `pg_advisory_xact_lock` on every (bucket, key) involved, in sorted order (no deadlock);
 *   2. a SEPARATE statement that counts recent rows for each key and inserts one row per key
 *      only if every count is under its limit.
 * The count must be a separate statement from the lock: under READ COMMITTED each statement
 * takes its snapshot when it starts, so a statement that starts after the lock is granted sees
 * every row committed by whoever held the lock before. Parallel requests on different
 * instances therefore serialize per key and can't all pass.
 * The locks are transaction-scoped (released at COMMIT), which is safe on the 6543
 * transaction pooler. Never use session-level locks or SET here; the transaction starts with
 * SET LOCAL lock_timeout / statement_timeout so a stalled lock holder can't pin pool
 * connections (the array form of $transaction ignores Prisma's transactionOptions timeout;
 * cf. the 2026-05-19 pool outage). A timeout makes reserve() throw, which the callers treat as
 * "store unavailable" (verify: 503, send: per-instance fallback).
 *
 * Privacy: rows hold HMAC-SHA256 digests of the IP / email+IP (key derived from JWT_SECRET
 * with a domain label), never plaintext.
 */
import { createHmac } from 'crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { getJwtSecret } from '../config/secrets.js';

export interface RateBucket {
  /** Bucket name, e.g. `send`, `verify_ip`. Stored as-is (not secret). */
  bucket: string;
  /** Already-hashed key (see hashRateKey). */
  key: string;
  /** Reserve only if fewer than this many events exist in the window. */
  limit: number;
}

export interface Reservation {
  /** Events already in the window for each bucket (same order as the input), before this one. */
  counts: number[];
  /** Ids of the inserted rows, or null when some bucket was at its limit (nothing inserted). */
  ids: string[] | null;
  /**
   * Per bucket: ms until its oldest in-window event expires (a slot frees up by ageing), or
   * null when the bucket has no events. Lets callers cache a refusal briefly.
   */
  retryAfterMs: Array<number | null>;
}

export interface RateStore {
  /** Atomically: insert one event per bucket iff every bucket is under its limit. */
  reserve(buckets: RateBucket[], windowMs: number): Promise<Reservation>;
  /** Give reserved events back (delete their rows). */
  release(ids: string[]): Promise<void>;
  /** Delete events older than `olderThanMs`. */
  cleanup(olderThanMs: number): Promise<void>;
}

/** Rows older than this are never counted (every window is 15 min); delete them. */
export const RATE_EVENT_RETENTION_MS = 60 * 60 * 1000;
/** Bounds on how long a reservation may wait for / hold the lock (SET LOCAL, per transaction). */
export const RESERVE_LOCK_TIMEOUT = '2s';
export const RESERVE_STATEMENT_TIMEOUT = '5s';
/** Fraction of reservations that also run the cleanup DELETE. */
export const CLEANUP_CHANCE = 0.01;

const HASH_DOMAIN = 'auth-rate-events:v1';

/**
 * HMAC-SHA256 of `raw` under a key derived from JWT_SECRET (domain-separated, so these digests
 * can't be confused with guest tokens or JWTs), salted by bucket so the same IP gets unrelated
 * keys in different buckets. 128 bits (32 hex chars) is plenty for a counter key.
 */
export function hashRateKey(bucket: string, raw: string): string {
  const derived = createHmac('sha256', getJwtSecret()).update(HASH_DOMAIN).digest();
  return createHmac('sha256', derived).update(`${bucket}\0${raw}`).digest('hex').slice(0, 32);
}

function lockKeys(buckets: RateBucket[]): string[] {
  return [...new Set(buckets.map((b) => `${b.bucket}:${b.key}`))].sort();
}

type RawClient = Pick<PrismaClient, '$transaction' | '$executeRaw' | '$executeRawUnsafe' | '$queryRaw'>;
type ReserveRow = { counts: number[]; retry: Array<number | null> | null; ids: string[] | null };

/** The production store: `auth_rate_events` via Prisma. */
export function prismaRateStore(client: RawClient): RateStore {
  return {
    async reserve(buckets, windowMs) {
      if (buckets.length === 0) return { counts: [], ids: [], retryAfterMs: [] };
      const names = buckets.map((b) => b.bucket);
      const keys = buckets.map((b) => b.key);
      const limits = buckets.map((b) => b.limit);
      const locks = lockKeys(buckets).map(
        (k) => client.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${k}, 0))`,
      );
      const query = client.$queryRaw<ReserveRow[]>(Prisma.sql`
        WITH want AS (
          SELECT w.bucket, w.key, w.lim, w.ord
            FROM unnest(${names}::text[], ${keys}::text[], ${limits}::int[]) WITH ORDINALITY AS w(bucket, key, lim, ord)
        ), c AS (
          SELECT want.*,
                 (SELECT count(*) FROM auth_rate_events e
                   WHERE e.bucket = want.bucket AND e.key = want.key
                     AND e.created_at > now() - (${windowMs}::int * interval '1 millisecond'))::int AS n,
                 (SELECT extract(epoch FROM (min(e.created_at) + (${windowMs}::int * interval '1 millisecond') - now())) * 1000
                    FROM auth_rate_events e
                   WHERE e.bucket = want.bucket AND e.key = want.key
                     AND e.created_at > now() - (${windowMs}::int * interval '1 millisecond'))::float8 AS retry
            FROM want
        ), ok AS (
          SELECT bool_and(n < lim) AS ok FROM c
        ), ins AS (
          INSERT INTO auth_rate_events (bucket, key)
          SELECT c.bucket, c.key FROM c, ok WHERE ok.ok
          RETURNING id
        )
        SELECT (SELECT json_agg(n ORDER BY ord) FROM c) AS counts,
               (SELECT json_agg(retry ORDER BY ord) FROM c) AS retry,
               (SELECT array_agg(id::text) FROM ins) AS ids`);
      // First statements: bound the lock wait and every statement (SET LOCAL takes no bind
      // parameters; these are constants). Scoped to this transaction, so nothing leaks to the
      // pooled connection.
      const timeouts = [
        client.$executeRawUnsafe(`SET LOCAL lock_timeout = '${RESERVE_LOCK_TIMEOUT}'`),
        client.$executeRawUnsafe(`SET LOCAL statement_timeout = '${RESERVE_STATEMENT_TIMEOUT}'`),
      ];
      // READ COMMITTED explicitly (it's the default, but correctness depends on it): the
      // counting statement must take a NEW snapshot after the lock is granted. Under
      // REPEATABLE READ / SERIALIZABLE the snapshot is fixed at the transaction's first
      // statement, before the lock wait, so it would miss rows the previous lock holder
      // committed and parallel requests could all pass.
      const results = await client.$transaction([...timeouts, ...locks, query], {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      });
      const row = (results[results.length - 1] as ReserveRow[])[0];
      const counts = row.counts.map(Number);
      const retryAfterMs = (row.retry ?? []).map((r) => (r === null ? null : Math.max(0, Number(r))));
      const ok = counts.every((n, i) => n < limits[i]);
      return { counts, ids: ok ? row.ids ?? [] : null, retryAfterMs };
    },
    async release(ids) {
      if (ids.length === 0) return;
      await client.$executeRaw`DELETE FROM auth_rate_events WHERE id = ANY(${ids}::bigint[])`;
    },
    async cleanup(olderThanMs) {
      await client.$executeRaw`DELETE FROM auth_rate_events WHERE created_at < now() - (${olderThanMs}::int * interval '1 millisecond')`;
    },
  };
}

/**
 * In-process store with the same contract (test double, shared between simulated
 * "instances"). Each reserve runs to completion before the next starts.
 */
export function memoryRateStore(opts: { latencyMs?: number } = {}) {
  const rows: Array<{ id: string; bucket: string; key: string; createdAt: number }> = [];
  let nextId = 1;
  let chain: Promise<unknown> = Promise.resolve();
  const delay = () => (opts.latencyMs ? new Promise((r) => setTimeout(r, opts.latencyMs)) : Promise.resolve());
  const serial = <T>(fn: () => T): Promise<T> => {
    const run = chain.then(async () => {
      await delay();
      return fn();
    });
    chain = run.catch(() => undefined);
    return run;
  };
  const store: RateStore & { rows: typeof rows; clear(): void } = {
    rows,
    clear() {
      rows.length = 0;
    },
    reserve(buckets, windowMs) {
      return serial(() => {
        const now = Date.now();
        const counts = buckets.map(
          (b) => rows.filter((r) => r.bucket === b.bucket && r.key === b.key && now - r.createdAt < windowMs).length,
        );
        const retryAfterMs = buckets.map((b) => {
          const ts = rows
            .filter((r) => r.bucket === b.bucket && r.key === b.key && now - r.createdAt < windowMs)
            .map((r) => r.createdAt);
          return ts.length ? Math.min(...ts) + windowMs - now : null;
        });
        if (!counts.every((n, i) => n < buckets[i].limit)) return { counts, ids: null, retryAfterMs };
        const ids = buckets.map((b) => {
          const id = String(nextId++);
          rows.push({ id, bucket: b.bucket, key: b.key, createdAt: now });
          return id;
        });
        return { counts, ids, retryAfterMs };
      });
    },
    release(ids) {
      return serial(() => {
        for (const id of ids) {
          const i = rows.findIndex((r) => r.id === id);
          if (i >= 0) rows.splice(i, 1);
        }
      });
    },
    cleanup(olderThanMs) {
      return serial(() => {
        const now = Date.now();
        for (let i = rows.length - 1; i >= 0; i--) if (now - rows[i].createdAt >= olderThanMs) rows.splice(i, 1);
      });
    },
  };
  return store;
}
