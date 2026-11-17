/**
 * Tiny in-memory stand-in for the `series_admins` / `series_audit` / `event_series` Prisma delegates,
 * enough for the brand-admin membership tests (single-use tokens, expiry, scoping). Supports the
 * where-shapes the code uses: equality, `{gt}`, `{in}`, `{is}` relation filters and the
 * `seriesId_email` compound unique.
 */
let seq = 0;

type Row = Record<string, any>;

export type Relations = Record<string, (row: Row) => Row | null | undefined>;

/** Where-matcher. Relation filters (`{ series: { is: {...} } }`, `{ party: {...} }`) resolve through `rel` and recurse. */
export function matches(row: Row, where: Row | undefined, rel: Relations = {}): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (k === 'seriesId_email') return row.seriesId === v.seriesId && row.email === v.email;
    if (v && typeof v === 'object' && !(v instanceof Date) && k in rel) {
      const target = rel[k](row);
      return !!target && matches(target, 'is' in v ? v.is : v, rel);
    }
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('gt' in v) return row[k] != null && row[k] > v.gt;
      if ('in' in v) return v.in.includes(row[k]);
      if ('not' in v) return row[k] !== v.not;
    }
    return row[k] === v;
  });
}

function pick(row: Row | null | undefined, select?: Row): Row | null {
  if (!row) return null;
  if (!select) return { ...row };
  return Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, row[k]]));
}

export function makeFakeDb(opts: { superAdmins?: string[]; inactiveSeries?: string[]; seriesIds?: string[] } = {}) {
  const admins: Row[] = [];
  const audit: Row[] = [];
  const seriesIds = new Set(opts.seriesIds ?? []);
  const seriesState: Record<string, Row> = Object.fromEntries(
    (opts.seriesIds ?? []).map((id) => [id, { id, isActive: !opts.inactiveSeries?.includes(id) }]),
  );
  const rel: Relations = { series: (r) => seriesState[r.seriesId] };
  const db: any = {
    seriesAdmin: {
      findUnique: async ({ where }: any) => admins.find((r) => matches(r, where, rel)) ?? null,
      findFirst: async ({ where, select }: any) => {
        return pick(admins.find((r) => matches(r, where, rel)), select);
      },
      findMany: async ({ where, select }: any) => admins.filter((r) => matches(r, where, rel)).map((r) => pick(r, select)),
      create: async ({ data, select }: any) => {
        const row = { id: `aaaaaaaa-0000-4000-8000-${String(++seq).padStart(12, "0")}`, alertsEnabled: true, createdAt: new Date(), ...data };
        admins.push(row);
        return pick(row, select);
      },
      update: async ({ where, data, select }: any) => {
        const row = admins.find((r) => matches(r, where, rel));
        if (!row) throw Object.assign(new Error('nf'), { code: 'P2025' });
        Object.assign(row, data);
        return pick(row, select);
      },
      updateMany: async ({ where, data }: any) => {
        const hit = admins.filter((r) => matches(r, where, rel));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      },
    },
    seriesAudit: { create: async ({ data }: any) => { audit.push(data); return data; } },
    eventSeries: { findUnique: async ({ where }: any) => (seriesIds.has(where.id) ? { id: where.id } : null) },
    $transaction: async (fn: any) => fn(db),
  };
  return { db, admins, audit, seriesIds, seriesState };
}
