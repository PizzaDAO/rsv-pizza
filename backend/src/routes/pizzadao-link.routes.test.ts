import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const JWT_SECRET = 'test-secret';
const mockPrisma = vi.hoisted(() => ({ user: { findUnique: vi.fn() } }));

vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const h = req.headers.authorization;
    try {
      if (!h?.startsWith('Bearer ')) throw new Error('no');
      const d = jwt.verify(h.split(' ')[1], JWT_SECRET) as any;
      req.userId = d.userId;
      next();
    } catch {
      res.status(401).json({ error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } });
    }
  },
}));

import linkRoutes from './pizzadao-link.routes.js';
import { errorHandler } from '../middleware/error.js';
import { publicJwks, mintPizzaMcpToken } from '../lib/pizzaMcpToken.js';
import { generateSigningKeyPem } from '../testutil/pizzaFakes.js';
import { parseReturnUrl, buildLinkRedirect, LinkInputError } from '../lib/pizzadaoLink.js';

const ENV = ['PIZZA_MCP_SIGNING_KEY', 'PIZZA_MCP_URL', 'PIZZADAO_LINK_RETURN_ORIGINS', 'PIZZADAO_LINK_AUDIENCE'];
let saved: Record<string, string | undefined>;
const STATE = 'abcDEF0123456789_-xyz';
let uid = 0;
const bearer = () => `Bearer ${jwt.sign({ userId: `u${++uid}` }, JWT_SECRET)}`;

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/pizzadao-link', linkRoutes);
  a.use(errorHandler);
  return a;
}
const post = (body: unknown, auth: string | null = bearer()) => {
  const r = request(app()).post('/api/pizzadao-link');
  if (auth) r.set('Authorization', auth);
  return r.send(body as object);
};

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  process.env.PIZZA_MCP_SIGNING_KEY = generateSigningKeyPem();
  mockPrisma.user.findUnique.mockResolvedValue({ email: '  Member@Example.org ' });
});
afterEach(() => {
  for (const k of ENV) (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]));
});

describe('POST /api/pizzadao-link', () => {
  it('requires a signed-in user', async () => {
    const res = await post({ returnUrl: 'https://pizzadao.org/x', state: STATE }, null);
    expect(res.status).toBe(401);
  });

  it('503 when no signing key is configured', async () => {
    delete process.env.PIZZA_MCP_SIGNING_KEY;
    expect((await post({ returnUrl: 'https://pizzadao.org/x', state: STATE })).status).toBe(503);
  });

  it('redirects to the return URL with a verifiable token that carries only the hash, state and expiry', async () => {
    const res = await post({ returnUrl: 'https://pizzadao.org/profile/1/edit?a=b', state: STATE });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const url = new URL(res.body.url);
    expect(url.origin + url.pathname).toBe('https://pizzadao.org/profile/1/edit');
    expect(url.searchParams.get('a')).toBe('b');
    expect(url.searchParams.get('state')).toBe(STATE);
    // plain email never appears in the URL
    expect(res.body.url.toLowerCase()).not.toContain('member');
    expect(res.body.url).not.toContain('example.org');

    const token = url.searchParams.get('rsv_link')!;
    const { header } = jwt.decode(token, { complete: true }) as any;
    expect(header).toMatchObject({ alg: 'ES256', typ: 'pizzadao-link+jwt' });
    const pub = crypto.createPublicKey({ key: publicJwks()!.keys[0] as any, format: 'jwk' });
    const claims = jwt.verify(token, pub, { algorithms: ['ES256'], audience: 'pizzadao.org' }) as jwt.JwtPayload;
    expect(Object.keys(claims).sort()).toEqual(
      ['aud', 'email_sha256', 'exp', 'iat', 'iss', 'jti', 'state', 'use', 'v'],
    );
    expect(claims.email_sha256).toBe(crypto.createHash('sha256').update('member@example.org').digest('hex'));
    expect(claims.state).toBe(STATE);
    expect(claims.use).toBe('pizzadao_link');
    expect(claims.exp! - claims.iat!).toBe(300);
    expect(JSON.stringify(claims)).not.toMatch(/example\.org/);
  });

  it('rejects return URLs off the allowlist (no open redirect)', async () => {
    for (const returnUrl of [
      'https://evil.example/x',
      'https://pizzadao.org.evil.example/x',
      'https://evil.example/https://pizzadao.org',
      'https://evilpizzadao.org/x', // lookalike suffix
      'https://pizzadao.org.evil.example/x',
      'https://sub.pizzadao.org/x',
      'https://pizzadao.org:8443/x', // port
      'https://xn--pizzada-8ve.org/x', // IDN lookalike (punycode)
      'https://pizzadаo.org/x', // Cyrillic a
      'https://pizzadao.org\\@evil.example/x', // backslash
      'https:\\\\evil.example/x',
      'https:///evil.example/x',
      'https://pizzadao.org/x\n',
      'https://pizzadao.org /x',
      'https://pizzadao.org@evil.example/x',
      'http://pizzadao.org/x',
      'javascript:alert(1)',
      '//evil.example',
      '/relative',
      'https://pizzadao.org/x#frag',
      '',
      42,
    ]) {
      const res = await post({ returnUrl, state: STATE });
      expect(res.status, String(returnUrl)).toBe(400);
      expect(res.body.url).toBeUndefined();
    }
  });

  it('rejects missing or weak state', async () => {
    for (const state of [undefined, '', 'short', 'has space aaaaaaaaaaaaaaaa', 'x'.repeat(200), 5]) {
      expect((await post({ returnUrl: 'https://pizzadao.org/x', state })).status).toBe(400);
    }
  });
});

describe('return URL allowlist config', () => {
  it('normalizes case and same-origin paths (uppercase host, // in path) without widening the allowlist', () => {
    expect(parseReturnUrl('https://PIZZADAO.ORG/Profile').origin).toBe('https://pizzadao.org');
    expect(parseReturnUrl('https://pizzadao.org//evil.example/x').origin).toBe('https://pizzadao.org');
    expect(parseReturnUrl('https://pizzadao.org/x').toString()).toBe('https://pizzadao.org/x');
  });

  it('honours PIZZADAO_LINK_RETURN_ORIGINS as exact origins only (a wildcard is ignored, never matches)', () => {
    process.env.PIZZADAO_LINK_RETURN_ORIGINS =
      'https://pizzadao.org, https://pizzadao-git-feat-x-team.vercel.app/, https://pizzadao-*.vercel.app, https://*.vercel.app, https://pizzadao.org/path';
    expect(parseReturnUrl('https://pizzadao-git-feat-x-team.vercel.app/p').hostname).toBe('pizzadao-git-feat-x-team.vercel.app');
    expect(() => parseReturnUrl('https://pizzadao-git-other-team.vercel.app/p')).toThrow(LinkInputError);
    expect(() => parseReturnUrl('https://pizzadao-evil.vercel.app/p')).toThrow(LinkInputError);
    expect(() => parseReturnUrl('https://anything.vercel.app/p')).toThrow(LinkInputError);
    expect(() => parseReturnUrl('https://www.pizzadao.org/p')).toThrow(LinkInputError); // not listed once overridden
  });

  it('allows http only for localhost entries that are configured', () => {
    expect(() => parseReturnUrl('http://localhost:3000/p')).toThrow(LinkInputError);
    process.env.PIZZADAO_LINK_RETURN_ORIGINS = 'http://localhost:3000';
    expect(parseReturnUrl('http://localhost:3000/p').port).toBe('3000');
    expect(() => parseReturnUrl('http://localhost:3001/p')).toThrow(LinkInputError);
  });
});

// A link token must never be accepted by pizza-mcp's REAL verifier (PIZZA_MCP_DIR = a pizza-mcp
// checkout with node_modules), as an access token or as a signed document.
const MCP = process.env.PIZZA_MCP_DIR;
describe.skipIf(!MCP)('pizza-mcp rejects a pizzadao link token (real code from PIZZA_MCP_DIR)', () => {
  const run = (token: string) => {
    const here = dirname(fileURLToPath(import.meta.url));
    const r = spawnSync(join(MCP!, 'node_modules', '.bin', 'tsx'), [join(here, '..', 'testutil', 'verifyLinkTokenWithPizzaMcp.mjs')], {
      cwd: MCP!,
      input: JSON.stringify({
        token,
        jwks: publicJwks(),
        issuer: 'https://api.rsv.pizza', // brand-check-ignore-line (OPOP issuer, fixed by the trust contract)
        audiences: ['https://api.openpizza.xyz', 'https://api.openpizza.xyz/api/mcp', 'pizzadao.org'],
        nowMs: Date.now(),
      }),
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', PIZZA_MCP_DIR: MCP!, NODE_ENV: 'test' },
      timeout: 60_000,
    });
    if (r.status !== 0) throw new Error(`pizza-mcp verifier failed: ${r.stderr || r.error}`);
    return JSON.parse(r.stdout.trim().split('\n').pop()!).accepted as boolean;
  };

  it('does not accept it as an access token (even with its audience allowed), while a real access token passes', () => {
    process.env.PIZZA_MCP_URL = 'https://api.openpizza.xyz';
    const url = buildLinkRedirect({ email: 'a@b.co', returnUrl: 'https://pizzadao.org/x', state: STATE });
    expect(run(mintPizzaMcpToken({ userId: 'u1' }))).toBe(true); // positive control: the harness really verifies
    expect(run(new URL(url).searchParams.get('rsv_link')!)).toBe(false);
  });
});
