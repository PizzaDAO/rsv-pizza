import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { mintPizzaMcpToken, publicJwks, hasSigningKey } from './pizzaMcpToken.js';
import { generateSigningKeyPem } from '../testutil/pizzaFakes.js';

const ENV = ['PIZZA_MCP_SIGNING_KEY', 'PIZZA_MCP_URL', 'PIZZA_MCP_AUDIENCE', 'PIZZA_MCP_ISSUER', 'PIZZA_MCP_SIGNING_KID', 'PIZZA_MCP_JWKS_EXTRA'];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  process.env.PIZZA_MCP_SIGNING_KEY = generateSigningKeyPem();
  process.env.PIZZA_MCP_URL = 'https://api.openpizza.xyz/';
});
afterEach(() => {
  for (const k of ENV) (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]));
});

function verifyWithJwks(token: string) {
  const jwk = publicJwks()!.keys[0];
  const pub = crypto.createPublicKey({ key: jwk as any, format: 'jwk' });
  return jwt.verify(token, pub, { algorithms: ['ES256'] }) as jwt.JwtPayload;
}

describe('pizza-mcp token claims (docs/CLIENTS.md)', () => {
  it('has exactly the documented claims, a 60 s lifetime and an ES256 header with kid', () => {
    const t = mintPizzaMcpToken({ userId: 'u123', email: 'host@x.com', partyId: 'p1', nowS: 1_800_000_000 });
    const { header } = jwt.decode(t, { complete: true }) as any;
    expect(header.alg).toBe('ES256');
    expect(header.kid).toBe(publicJwks()!.keys[0].kid);
    expect(header.jwk).toBeUndefined();
    expect(header.jku).toBeUndefined();

    const c = jwt.decode(t) as jwt.JwtPayload;
    expect(c).toMatchObject({
      iss: 'https://api.rsv.pizza',
      aud: 'https://api.openpizza.xyz',
      sub: 'rsvpizza:u123',
      azp: 'rsv.pizza',
      scope: 'pizza:browse orders:read orders:write',
      iat: 1_800_000_000,
      exp: 1_800_000_060,
      email: 'host@x.com',
      party_id: 'p1',
    });
    expect(typeof c.jti).toBe('string');
    // nothing beyond the documented set
    expect(Object.keys(c).sort()).toEqual(['aud', 'azp', 'email', 'exp', 'iat', 'iss', 'jti', 'party_id', 'scope', 'sub']);
  });

  it('omits email when unknown and never adds phone/name', () => {
    const c = jwt.decode(mintPizzaMcpToken({ userId: 'u1' })) as jwt.JwtPayload;
    expect(c.email).toBeUndefined();
    expect(c.phone_number).toBeUndefined();
    expect(c.name).toBeUndefined();
  });

  it('verifies against the published JWKS, and not against another key', () => {
    const t = mintPizzaMcpToken({ userId: 'u1' });
    expect(verifyWithJwks(t).sub).toBe('rsvpizza:u1');
    const other = crypto.createPublicKey(crypto.createPrivateKey(generateSigningKeyPem()));
    expect(() => jwt.verify(t, other, { algorithms: ['ES256'] })).toThrow();
  });

  it('honours PIZZA_MCP_AUDIENCE and PIZZA_MCP_ISSUER overrides', () => {
    process.env.PIZZA_MCP_AUDIENCE = 'https://api.openpizza.xyz/api/mcp';
    process.env.PIZZA_MCP_ISSUER = 'https://api.example.test';
    const c = jwt.decode(mintPizzaMcpToken({ userId: 'u1' })) as jwt.JwtPayload;
    expect(c.aud).toBe('https://api.openpizza.xyz/api/mcp');
    expect(c.iss).toBe('https://api.example.test');
  });

  it('throws when the key or audience is missing, and rejects a non P-256 key', () => {
    delete process.env.PIZZA_MCP_URL;
    expect(() => mintPizzaMcpToken({ userId: 'u1' })).toThrow(/PIZZA_MCP_URL/);
    process.env.PIZZA_MCP_URL = 'https://x.test';
    delete process.env.PIZZA_MCP_SIGNING_KEY;
    expect(hasSigningKey()).toBe(false);
    expect(publicJwks()).toBeNull();
    expect(() => mintPizzaMcpToken({ userId: 'u1' })).toThrow();
    process.env.PIZZA_MCP_SIGNING_KEY = crypto
      .generateKeyPairSync('ec', { namedCurve: 'secp384r1' })
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString();
    expect(() => mintPizzaMcpToken({ userId: 'u1' })).toThrow(/P-256/);
  });

  it('accepts a PEM with escaped newlines (single-line env var)', () => {
    process.env.PIZZA_MCP_SIGNING_KEY = process.env.PIZZA_MCP_SIGNING_KEY!.trim().replace(/\n/g, '\\n');
    expect(verifyWithJwks(mintPizzaMcpToken({ userId: 'u9' })).sub).toBe('rsvpizza:u9');
  });

  it('JWKS publishes only public members, and extra rotation keys never leak a private part', () => {
    process.env.PIZZA_MCP_JWKS_EXTRA = JSON.stringify([
      { kty: 'EC', crv: 'P-256', x: 'x1', y: 'y1', kid: 'old' },
      { kty: 'EC', crv: 'P-256', x: 'x2', y: 'y2', kid: 'bad', d: 'SECRET' },
    ]);
    const jwks = publicJwks()!;
    expect(jwks.keys.map((k) => k.kid)).toHaveLength(2);
    expect(JSON.stringify(jwks)).not.toContain('SECRET');
    expect(JSON.stringify(jwks.keys[0])).not.toContain('"d"');
  });
});
