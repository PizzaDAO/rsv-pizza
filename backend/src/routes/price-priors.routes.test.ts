/**
 * basil-14648 P2: GET /api/pizza-index/priors(.jws). Prisma is mocked (the view rows come from a fixture).
 * The last block verifies rsv's document with pizza-mcp's REAL verifier: it runs pizza-mcp's own code from
 * the checkout in PIZZA_MCP_DIR (skipped when unset).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const h = vi.hoisted(() => ({ viewRows: [] as any[], parties: [] as any[] }));
vi.mock('../config/database.js', () => ({
  prisma: {
    $queryRaw: vi.fn(async () => h.viewRows),
    appConfig: { findUnique: vi.fn(async () => null) },
    party: { findMany: vi.fn(async () => h.parties) },
  },
}));

import priorsRouter, { resetSignedPriorsCache } from './price-priors.routes.js';
import { invalidatePizzaIndexCache } from '../services/pizzaIndex.service.js';
import { publicJwks, mintPizzaMcpToken, PRICE_PRIORS_LIFETIME_S } from '../lib/pizzaMcpToken.js';
import { PRIOR_ROW_KEYS } from '../services/pricePriors.service.js';
import { generateSigningKeyPem } from '../testutil/pizzaFakes.js';

const ENV = ['PIZZA_MCP_SIGNING_KEY', 'PIZZA_MCP_URL', 'PIZZA_MCP_AUDIENCE', 'PIZZA_MCP_ISSUER', 'PIZZA_MCP_SIGNING_KID', 'PIZZA_MCP_JWKS_EXTRA'];
let saved: Record<string, string | undefined>;

function app() {
  const a = express();
  a.use('/api/pizza-index', priorsRouter);
  a.use((err: any, _req: any, res: any, _next: any) => res.status(500).json({ error: { message: err.message } }));
  return a;
}

const year = new Date().getUTCFullYear();
/** A view row (snake_case, as pizza_price_index_lines returns it). */
function viewRow(event: string, price: number, merchant: string) {
  const d = 35.56;
  const area = Math.PI * (d / 2) ** 2;
  return {
    line_id: crypto.randomUUID(), document_id: crypto.randomUUID(), party_id: event, party_name: `Host party ${event}`,
    country: 'United States', city: 'Boston', region: 'usa', event_year: year, event_series_slug: 'gpp',
    document_url: 'https://storage/receipt.jpg', document_mime_type: 'image/jpeg', source_receipt_index: null,
    source_receipt_count: null, merchant: `Shop ${merchant}`, merchant_key: merchant, raw_name: 'Pepperoni', qty: 2,
    currency: 'USD', fx_rate: 1, unit_price_list: price, unit_price_net: null, unit_price_usd: price,
    unit_price_net_usd: null, size_label: 'large', shape: 'round', diameter_cm: d, area_cm2: area, style: null,
    size_source: 'parsed', size_confidence: 0.95, verified_at: null, verified_by: null, is_verified: false,
    outlier_flag: false, is_bundle: false, usd_per_cm2: price / area, local_per_cm2: price / area,
    net_usd_per_cm2: null, event_key: event, origin: 'event', fx_source: null, is_lump_sum: false, receipt_key: null,
  };
}
const EVENTS = ['e1', 'e2', 'e3', 'e4'];

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  process.env.PIZZA_MCP_SIGNING_KEY = generateSigningKeyPem();
  process.env.PIZZA_MCP_URL = 'https://api.openpizza.xyz';
  h.viewRows = EVENTS.map((e, i) => viewRow(e, 18 + i, i % 2 ? 'shop-b' : 'shop-a'));
  h.parties = EVENTS.map((e) => ({ id: e, country: 'United States', address: `${e} Main St, Boston, MA 02110, USA` }));
  invalidatePizzaIndexCache();
  resetSignedPriorsCache();
});
afterEach(() => {
  for (const k of ENV) (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]));
});

const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString());

describe('GET /api/pizza-index/priors', () => {
  it('returns the aggregate document, cached 1 h, with only the contract keys', async () => {
    const res = await request(app()).get('/api/pizza-index/priors');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('max-age=3600');
    expect(res.body.v).toBe(1);
    expect(res.body.rows.map((r: any) => r.region)).toEqual(['city:US-MA:boston', 'country:US', 'state:US-MA']);
    for (const r of res.body.rows) expect(Object.keys(r).sort()).toEqual([...PRIOR_ROW_KEYS].sort());
    const s = JSON.stringify(res.body);
    for (const leak of ['Host party', 'Shop shop', 'shop-a', 'receipt.jpg', 'Main St', 'e1']) expect(s).not.toContain(leak);
  });
});

describe('GET /api/pizza-index/priors.jws', () => {
  it('503 PRIORS_SIGNING_UNAVAILABLE without the signing key', async () => {
    delete process.env.PIZZA_MCP_SIGNING_KEY;
    const res = await request(app()).get('/api/pizza-index/priors.jws');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('PRIORS_SIGNING_UNAVAILABLE');
  });

  it('503 without the pizza-mcp URL (no audience to sign for)', async () => {
    delete process.env.PIZZA_MCP_URL;
    const res = await request(app()).get('/api/pizza-index/priors.jws');
    expect(res.status).toBe(503);
  });

  it('is an application/jose compact JWS with the exact header and claims, and no sub', async () => {
    const res = await request(app()).get('/api/pizza-index/priors.jws').buffer(true).parse((r, cb) => {
      let s = '';
      r.on('data', (c: Buffer) => (s += c));
      r.on('end', () => cb(null, s));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/jose/);
    const jws = res.body as string;
    const [h64, p64, sig] = jws.split('.');
    const header = decode(h64);
    const kid = publicJwks()!.keys[0].kid;
    expect(header).toEqual({ alg: 'ES256', kid, typ: 'price-priors+jwt' });
    const c = decode(p64);
    expect(Object.keys(c).sort()).toEqual(['aud', 'exp', 'generated_at', 'iat', 'iss', 'rows', 'use', 'v']);
    expect(c).toMatchObject({
      iss: 'https://api.rsv.pizza', // brand-check-ignore-line (OPOP issuer, fixed by the trust contract)
      aud: 'https://api.openpizza.xyz', use: 'price_priors', v: 1,
    });
    expect(c.sub).toBeUndefined();
    expect(c.exp - c.iat).toBe(PRICE_PRIORS_LIFETIME_S);
    expect(c.rows).toHaveLength(3);
    // verifies against the published JWKS
    const pub = crypto.createPublicKey({ key: publicJwks()!.keys[0] as any, format: 'jwk' });
    expect(crypto.verify('sha256', Buffer.from(`${h64}.${p64}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'))).toBe(true);
    // the same built document keeps the same signature (and iat): pizza-mcp sees "not newer"
    const again = await request(app()).get('/api/pizza-index/priors.jws').buffer(true).parse((r, cb) => {
      let s = '';
      r.on('data', (x: Buffer) => (s += x));
      r.on('end', () => cb(null, s));
    });
    expect(again.body).toBe(jws);
  });
});

// ---------------------------------------------------------------------------
// pizza-mcp's REAL verifier (PIZZA_MCP_DIR = a pizza-mcp checkout with node_modules)
// ---------------------------------------------------------------------------
const MCP = process.env.PIZZA_MCP_DIR;
const here = dirname(fileURLToPath(import.meta.url));

function runPizzaMcp(input: Record<string, unknown>) {
  const tsx = join(MCP!, 'node_modules', '.bin', 'tsx');
  const r = spawnSync(tsx, [join(here, '..', 'testutil', 'verifyWithPizzaMcp.mjs')], {
    cwd: MCP!,
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', PIZZA_MCP_DIR: MCP!, NODE_ENV: 'test' },
    timeout: 60_000,
  });
  if (r.status !== 0) throw new Error(`pizza-mcp verifier failed: ${r.stderr || r.error}`);
  return JSON.parse(r.stdout.trim().split('\n').pop()!);
}

describe.skipIf(!MCP)('pizza-mcp verifies rsv\'s priors document (real code from PIZZA_MCP_DIR)', () => {
  it('has a usable pizza-mcp checkout', () => {
    expect(existsSync(join(MCP!, 'src', 'services', 'trusted-issuers.ts'))).toBe(true);
    expect(existsSync(join(MCP!, 'node_modules', '.bin', 'tsx'))).toBe(true);
  });

  it('verifySignedDocument accepts it, parsePriorsDocument + validateBatch pass, and the types never cross', async () => {
    const res = await request(app()).get('/api/pizza-index/priors.jws').buffer(true).parse((r, cb) => {
      let s = '';
      r.on('data', (c: Buffer) => (s += c));
      r.on('end', () => cb(null, s));
    });
    const jws = res.body as string;
    const accessToken = mintPizzaMcpToken({ userId: 'u1' });
    const out = runPizzaMcp({
      jws,
      accessToken,
      jwks: publicJwks(),
      issuer: 'https://api.rsv.pizza', // brand-check-ignore-line (OPOP issuer, fixed by the trust contract)
      audiences: ['https://api.openpizza.xyz', 'https://api.openpizza.xyz/api/mcp'],
      nowMs: Date.now(),
    });
    expect(out.verified).toBe(true);
    expect(out.parsed).toMatchObject({ ok: true });
    expect(out.parsed.rows).toHaveLength(3);
    expect(out.valid).toMatchObject({ ok: true });
    expect(out.bytes).toBeLessThanOrEqual(out.maxBytes);
    expect(out.docAsToken).toBeNull(); // a priors document is never an access token
    expect(out.tokenAsDoc).toBeNull(); // an access token is never a priors document
    expect(out.tokenAsToken).toBe(true); // and rsv's access tokens still pass the stricter verify()
  });

  it('pizza-mcp rejects it for the wrong audience or a tampered body', async () => {
    const res = await request(app()).get('/api/pizza-index/priors.jws').buffer(true).parse((r, cb) => {
      let s = '';
      r.on('data', (c: Buffer) => (s += c));
      r.on('end', () => cb(null, s));
    });
    const jws = res.body as string;
    const base = {
      jwks: publicJwks(),
      issuer: 'https://api.rsv.pizza', // brand-check-ignore-line (OPOP issuer, fixed by the trust contract)
      nowMs: Date.now(),
    };
    expect(runPizzaMcp({ ...base, jws, audiences: ['https://other.example'] }).verified).toBe(false);
    const [hh, p, s] = jws.split('.');
    const claims = decode(p);
    claims.rows[0].p50_cents += 100;
    const tampered = `${hh}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${s}`;
    expect(runPizzaMcp({ ...base, jws: tampered, audiences: ['https://api.openpizza.xyz'] }).verified).toBe(false);
  });
});
