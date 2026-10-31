/**
 * basil-14648: signing side of the RSV -> pizza-mcp trust (docs/CLIENTS.md in pizza-mcp).
 *
 * RSV mints a 60 second ES256 JWT per request and publishes the public key at
 * GET /.well-known/jwks.json. The private key comes from env only (PIZZA_MCP_SIGNING_KEY,
 * a PKCS8 PEM; "\n" escapes are accepted). Nothing here writes a key to disk.
 *
 * Claims (must match pizza-mcp's trusted-issuer entry exactly):
 *   iss  = PIZZA_MCP_ISSUER (default https://the RSV API)
 *   aud  = PIZZA_MCP_AUDIENCE, default the canonical URL (PIZZA_MCP_URL)
 *   sub  = rsvpizza:<User.id>        azp = RSV
 *   scope = "pizza:browse orders:read orders:write"
 *   iat/exp 60 s apart, jti random. email only as the fallback address for the approval code.
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { brand } from '../config/brand.js';

export const PIZZA_MCP_CLIENT_ID = 'rsv.pizza'; // brand-check-ignore-line (OPOP client id / issuer, fixed by the trust contract)
export const PIZZA_MCP_SUB_PREFIX = 'rsvpizza:';
export const PIZZA_MCP_SCOPE = 'pizza:browse orders:read orders:write';
export const PIZZA_MCP_TOKEN_TTL_S = 60;

export function pizzaMcpIssuer(): string {
  return (process.env.PIZZA_MCP_ISSUER || brand.apiUrl).trim().replace(/\/+$/, '');
}

/** Base URL of the pizza-mcp deployment (no trailing slash). */
export function pizzaMcpBaseUrl(): string | null {
  const u = (process.env.PIZZA_MCP_URL || '').trim().replace(/\/+$/, '');
  return u || null;
}

export function pizzaMcpAudience(): string | null {
  const a = (process.env.PIZZA_MCP_AUDIENCE || '').trim().replace(/\/+$/, '');
  return a || pizzaMcpBaseUrl();
}

function readPem(): string | null {
  const raw = process.env.PIZZA_MCP_SIGNING_KEY;
  if (!raw || !raw.trim()) return null;
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
}

export function hasSigningKey(): boolean {
  return readPem() !== null;
}

function privateKey(): crypto.KeyObject {
  const pem = readPem();
  if (!pem) throw new Error('PIZZA_MCP_SIGNING_KEY is not set');
  const key = crypto.createPrivateKey(pem);
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new Error('PIZZA_MCP_SIGNING_KEY must be an EC P-256 (prime256v1) key');
  }
  return key;
}

/** kid = RFC 7638 thumbprint of the public JWK unless PIZZA_MCP_SIGNING_KID overrides it. */
function kidFor(pub: { crv?: string; kty?: string; x?: string; y?: string }): string {
  if (process.env.PIZZA_MCP_SIGNING_KID) return process.env.PIZZA_MCP_SIGNING_KID;
  const canonical = JSON.stringify({ crv: pub.crv, kty: pub.kty, x: pub.x, y: pub.y });
  return crypto.createHash('sha256').update(canonical).digest('base64url');
}

/** Public JWK(s) to publish: the current key plus any rotation-overlap keys in PIZZA_MCP_JWKS_EXTRA. */
export function publicJwks(): { keys: Record<string, unknown>[] } | null {
  const pem = readPem();
  if (!pem) return null;
  const pub = crypto.createPublicKey(privateKey()).export({ format: 'jwk' });
  const keys: Record<string, unknown>[] = [
    { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y, use: 'sig', alg: 'ES256', kid: kidFor(pub) },
  ];
  const extra = process.env.PIZZA_MCP_JWKS_EXTRA;
  if (extra) {
    try {
      const parsed = JSON.parse(extra);
      if (Array.isArray(parsed)) {
        for (const k of parsed) {
          // public members only: never republish anything that looks private
          if (k && typeof k === 'object' && k.kty === 'EC' && k.kid && !('d' in k)) {
            keys.push({ kty: k.kty, crv: k.crv, x: k.x, y: k.y, use: 'sig', alg: 'ES256', kid: k.kid });
          }
        }
      }
    } catch {
      /* ignore a malformed extra set */
    }
  }
  return { keys };
}

export interface MintInput {
  userId: string;
  email?: string | null;
  partyId?: string;
  /** Test seam. */
  nowS?: number;
}

/** Mint the per-request bearer for one host. Throws if the key or audience is unset. */
export function mintPizzaMcpToken(input: MintInput): string {
  const aud = pizzaMcpAudience();
  if (!aud) throw new Error('PIZZA_MCP_URL is not set');
  const key = privateKey();
  const kid = kidFor(crypto.createPublicKey(key).export({ format: 'jwk' }));
  const iat = input.nowS ?? Math.floor(Date.now() / 1000);
  const claims: Record<string, unknown> = {
    iss: pizzaMcpIssuer(),
    aud,
    sub: `${PIZZA_MCP_SUB_PREFIX}${input.userId}`,
    azp: PIZZA_MCP_CLIENT_ID,
    scope: PIZZA_MCP_SCOPE,
    iat,
    exp: iat + PIZZA_MCP_TOKEN_TTL_S,
    jti: crypto.randomUUID(),
  };
  if (input.email) claims.email = input.email;
  if (input.partyId) claims.party_id = input.partyId;
  // jsonwebtoken adds no jwk/jku header and keeps the explicit iat/exp above.
  return jwt.sign(claims, key, { algorithm: 'ES256', keyid: kid });
}
