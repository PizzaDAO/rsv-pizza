/** Test-only fakes for the pizza ordering tests: an in-memory db, a signing key and a fake pizza-mcp. */
import crypto from 'node:crypto';

export function generateSigningKeyPem(): string {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}

export const PARTY_ID = '11111111-1111-4111-8111-111111111111';
export const OTHER_PARTY_ID = '22222222-2222-4222-8222-222222222222';

const p2002 = () => Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });

/** Just enough of Prisma for services/pizzaOrderSync + the order routes. */
export function makeFakeDb() {
  const orders = new Map<string, any>(); // by id
  const docs: any[] = [];
  const events = new Set<string>();
  const carts = new Map<string, any>();
  const parties = new Map<string, any>();
  const users = new Map<string, any>();
  const handoffs = new Map<string, any>(); // basil-14648 P2: pizza_handoffs, by id
  let seq = 0;
  const byOpop = (id: string) => [...orders.values()].find((o) => o.opopOrderId === id) ?? null;

  const pizzaOrder = {
    findUnique: async ({ where }: any) => (where.opopOrderId ? byOpop(where.opopOrderId) : orders.get(where.id) ?? null),
    findFirst: async ({ where }: any) => {
      const o = byOpop(where.opopOrderId);
      return o && (!where.partyId || o.partyId === where.partyId) ? o : null;
    },
    findMany: async ({ where }: any) => [...orders.values()].filter((o) => o.partyId === where.partyId),
    create: async ({ data }: any) => {
      if (byOpop(data.opopOrderId)) throw p2002();
      const row = {
        id: `po-${++seq}`, paymentStatus: null, ceilingCents: null, confirmedTotalCents: null, readyAt: null,
        readyAtText: null, summary: null, lastView: null, nextAction: null, timelineLen: 0, lastEventAt: null, confirmedAt: null,
        payoutDocumentId: null, createdAt: new Date(), updatedAt: new Date(), ...data,
      };
      orders.set(row.id, row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = orders.get(where.id);
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    createMany: async ({ data }: any) => {
      let count = 0;
      for (const d of data) if (!byOpop(d.opopOrderId)) { await pizzaOrder.create({ data: d }); count++; }
      return { count };
    },
    upsert: async ({ where, create, update }: any) => {
      const ex = byOpop(where.opopOrderId);
      return ex ? pizzaOrder.update({ where: { id: ex.id }, data: update }) : pizzaOrder.create({ data: create });
    },
  };
  const db = {
    pizzaOrder,
    pizzaCart: {
      create: async ({ data }: any) => {
        if (carts.has(data.opopCartId)) throw p2002();
        const row = { id: `pc-${++seq}`, createdAt: new Date(), ...data };
        carts.set(data.opopCartId, row);
        return row;
      },
      findUnique: async ({ where }: any) => carts.get(where.opopCartId) ?? null,
      update: async ({ where, data }: any) => {
        const row = carts.get(where.opopCartId);
        if (data.quoteIds?.push) row.quoteIds = [...row.quoteIds, data.quoteIds.push];
        return row;
      },
    },
    pizzaWebhookEvent: {
      createMany: async ({ data }: any) => {
        let count = 0;
        for (const d of data) if (!events.has(d.id)) { events.add(d.id); count++; }
        return { count };
      },
      create: async ({ data }: any) => {
        if (events.has(data.id)) throw p2002();
        events.add(data.id);
        return data;
      },
    },
    payoutDocument: {
      createMany: async ({ data }: any) => {
        let count = 0;
        for (const d of data) {
          if (docs.some((x) => x.pizzaOrderId === d.pizzaOrderId)) continue;
          docs.push({ id: `doc-${++seq}`, ...d });
          count++;
        }
        return { count };
      },
      findUnique: async ({ where }: any) => docs.find((d) => d.pizzaOrderId === where.pizzaOrderId) ?? null,
      findMany: async ({ where }: any) =>
        docs.filter(
          (d) =>
            d.partyId === where.partyId &&
            (where.source === undefined || d.source === where.source) &&
            (where.isDuplicate === undefined || (d.isDuplicate ?? false) === where.isDuplicate) &&
            (where.ineligible === undefined || (d.ineligible ?? false) === where.ineligible)
        ),
      deleteMany: async ({ where }: any) => {
        const keep = docs.filter((d) => !(d.pizzaOrderId === where.pizzaOrderId && d.source !== 'upload' && (where.payoutId === undefined || (d.payoutId ?? null) === where.payoutId)));
        const count = docs.length - keep.length;
        docs.length = 0; docs.push(...keep);
        return { count };
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const d of docs) if (d.pizzaOrderId === where.pizzaOrderId && d.source !== 'upload') { Object.assign(d, data); count++; }
        return { count };
      },
    },
    // basil-14648 P2: pizza_handoffs. `where` supports equality, `null`, and `{ not: null }`.
    pizzaHandoff: (() => {
      const matches = (h: any, where: any = {}) =>
        Object.entries(where).every(([k, v]) =>
          v && typeof v === 'object' && 'not' in (v as any) ? (h[k] ?? null) !== (v as any).not : (h[k] ?? null) === v
        );
      const sorted = (rows: any[], orderBy?: any) => {
        const [k, dir] = Object.entries(orderBy ?? { createdAt: 'desc' })[0] as [string, string];
        return [...rows].sort((a, b) => (new Date(a[k] ?? 0).getTime() - new Date(b[k] ?? 0).getTime()) * (dir === 'desc' ? -1 : 1) || (dir === 'desc' ? b._seq - a._seq : a._seq - b._seq));
      };
      return {
        findMany: async ({ where, orderBy, take }: any = {}) => sorted([...handoffs.values()].filter((h) => matches(h, where)), orderBy).slice(0, take ?? Infinity),
        findFirst: async ({ where, orderBy }: any = {}) => sorted([...handoffs.values()].filter((h) => matches(h, where)), orderBy)[0] ?? null,
        count: async ({ where }: any = {}) => [...handoffs.values()].filter((h) => matches(h, where)).length,
        create: async ({ data }: any) => {
          const now = new Date();
          const row = {
            id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, _seq: seq, opopCartId: null, quoteId: null, holdCents: 0,
            clickedAt: null, orderedAt: null, releasedAt: null, receiptCoveredAt: null, createdAt: now, updatedAt: now, ...data,
          };
          handoffs.set(row.id, row);
          return { ...row };
        },
        updateMany: async ({ where, data }: any) => {
          let count = 0;
          for (const h of handoffs.values()) if (matches(h, where)) { Object.assign(h, data, { updatedAt: new Date() }); count++; }
          return { count };
        },
        update: async ({ where, data }: any) => {
          const row = handoffs.get(where.id);
          if (!row) throw new Error('not found');
          Object.assign(row, data, { updatedAt: new Date() });
          return { ...row };
        },
      };
    })(),
    party: { findUnique: async ({ where }: any) => parties.get(where.id) ?? null },
    user: { findUnique: async ({ where }: any) => users.get(where.id) ?? null },
    // rolls back on throw, like a real transaction
    $transaction: async (fn: any) => {
      const snap = { carts: new Map([...carts].map(([k, v]) => [k, { ...v }])), events: new Set(events), orders: new Map([...orders].map(([k, v]) => [k, { ...v }])), docs: docs.map((d) => ({ ...d })) };
      try {
        return await fn(db);
      } catch (e) {
        carts.clear(); snap.carts.forEach((v, k) => carts.set(k, v));
        events.clear(); snap.events.forEach((x) => events.add(x));
        orders.clear(); snap.orders.forEach((v, k) => orders.set(k, v));
        docs.length = 0; docs.push(...snap.docs);
        throw e;
      }
    },
  };
  return { db, orders, docs, events, carts, parties, users, handoffs, byOpop };
}

export type FakeDb = ReturnType<typeof makeFakeDb>;

export function opopOrder(over: Record<string, any> = {}, timeline = 1) {
  return {
    id: 'ord_1',
    order_number: 'A-100',
    pizzeria_id: 'pzl_osm_n1',
    status: 'calling',
    payment_status: 'unpaid',
    summary: '10 pizzas',
    totals: { subtotal_cents: 0, discount_cents: 0, delivery_fee_cents: 0, service_fee_cents: 0, tax_cents: 0, tip_cents: 0, total_cents: 0 },
    promised_at: null,
    hold_expires_at: null,
    amount_due_cents: 0,
    timeline: Array.from({ length: timeline }, (_, i) => ({ at: new Date(1_700_000_000_000 + i * 1000).toISOString(), status: `s${i}` })),
    tracking_url: null,
    tier: 'listing',
    binding: false,
    call: { attempts: 1, last_outcome: null, shop_total_cents: null, ready_at_text: null, changes: [], transcript_available: false },
    ...over,
  };
}

import jwt from 'jsonwebtoken';
import { publicJwks } from '../lib/pizzaMcpToken.js';

export interface FakeCall {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: any;
  claims: jwt.JwtPayload;
}

/**
 * A fake pizza-mcp HTTP layer. It verifies the bearer exactly as pizza-mcp would (ES256 against our
 * JWKS, iss/aud/azp/sub prefix/lifetime), records every call, and answers from `routes`.
 */
export function makeFakePizzaMcp(
  routes: Record<string, (call: FakeCall) => { status?: number; json: unknown }>,
  base = 'https://api.openpizza.xyz'
) {
  const calls: FakeCall[] = [];
  const fetchImpl = (async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(init.headers ?? {})) headers[k.toLowerCase()] = String(v);
    const token = (headers.authorization ?? '').replace(/^Bearer /, '');
    let claims: jwt.JwtPayload;
    // pizza-mcp's human-page endpoints are public: GET /confirmations/{id} needs (and gets) no token
    const isPublic = (init.method ?? 'GET') === 'GET' && /^\/api\/v1\/confirmations\/[^/]+$/.test(url.pathname) && !headers.authorization;
    if (isPublic) claims = {};
    else try {
      const pub = crypto.createPublicKey({ key: publicJwks()!.keys[0] as any, format: 'jwk' });
      claims = jwt.verify(token, pub, { algorithms: ['ES256'], issuer: 'https://api.rsv.pizza', audience: base }) as jwt.JwtPayload; // brand-check-ignore-line (OPOP client id / issuer, fixed by the trust contract)
      if (claims.azp !== 'rsv.pizza' || !String(claims.sub).startsWith('rsvpizza:') || claims.exp! - claims.iat! > 600) throw new Error('claims'); // brand-check-ignore-line (OPOP client id / issuer, fixed by the trust contract)
    } catch {
      return new Response(JSON.stringify({ code: 'UNAUTHENTICATED', title: 'bad token', status: 401, retryable: false }), { status: 401 });
    }
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const call: FakeCall = {
      method: init.method ?? 'GET',
      path,
      query: Object.fromEntries(url.searchParams),
      headers,
      // a multipart upload (FormData) is kept as is for the test to read
      body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body ?? undefined,
      claims,
    };
    calls.push(call);
    const key = Object.keys(routes).find((k) => {
      const [m, p] = k.split(' ');
      return m === call.method && new RegExp(`^${p.replace(/:[a-z]+/g, '[^/]+')}$`).test(path);
    });
    if (!key) return new Response(JSON.stringify({ code: 'NOT_FOUND', title: 'nf', status: 404, retryable: false }), { status: 404 });
    const out = routes[key](call);
    if (out.status === 204) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(out.json), { status: out.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { fetchImpl, calls };
}
