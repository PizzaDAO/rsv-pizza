/**
 * Tiny in-memory stand-in for the `series_admins` / `series_audit` / `event_series` Prisma delegates,
 * enough for the brand-admin membership tests (single-use tokens, expiry, scoping). Supports the
 * where-shapes the code uses: equality, `{gt}`, `{in}`, `{is}` relation filters and the
 * `seriesId_email` compound unique.
 */
let seq = 0;

type Row = Record<string, any>;

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (k === 'series') return true; // relation filter: the fake treats every series as active unless a test overrides
    if (k === 'seriesId_email') return row.seriesId === v.seriesId && row.email === v.email;
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
  const db: any = {
    seriesAdmin: {
      findUnique: async ({ where }: any) => admins.find((r) => matches(r, where)) ?? null,
      findFirst: async ({ where, select }: any) => {
        const sid = where?.series?.is?.isActive === true ? where.seriesId : null;
        if (sid && opts.inactiveSeries?.includes(sid)) return null;
        return pick(admins.find((r) => matches(r, where)), select);
      },
      findMany: async ({ where, select }: any) => admins.filter((r) => matches(r, where)).map((r) => pick(r, select)),
      create: async ({ data, select }: any) => {
        const row = { id: `a${++seq}`, alertsEnabled: true, createdAt: new Date(), ...data };
        admins.push(row);
        return pick(row, select);
      },
      update: async ({ where, data, select }: any) => {
        const row = admins.find((r) => matches(r, where));
        if (!row) throw Object.assign(new Error('nf'), { code: 'P2025' });
        Object.assign(row, data);
        return pick(row, select);
      },
      updateMany: async ({ where, data }: any) => {
        const hit = admins.filter((r) => matches(r, where));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      },
    },
    seriesAudit: { create: async ({ data }: any) => { audit.push(data); return data; } },
    eventSeries: { findUnique: async ({ where }: any) => (seriesIds.has(where.id) ? { id: where.id } : null) },
    $transaction: async (fn: any) => fn(db),
  };
  return { db, admins, audit, seriesIds };
}
