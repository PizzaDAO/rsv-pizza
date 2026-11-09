// basil-14648 P2: runs INSIDE a pizza-mcp checkout (cwd = PIZZA_MCP_DIR, pizza-mcp's own tsx, so its
// tsconfig "@/..." paths resolve) and checks an rsv priors document with pizza-mcp's REAL code:
// TrustedIssuerVerifier.verifySignedDocument, parsePriorsDocument and validateBatch.
// stdin: {jws, accessToken, jwks, issuer, audiences, nowMs}. stdout: one JSON line.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = process.env.PIZZA_MCP_DIR;
const input = JSON.parse(await new Promise((res) => {
  let s = '';
  process.stdin.on('data', (c) => (s += c));
  process.stdin.on('end', () => res(s));
}));
const ti = await import(pathToFileURL(join(dir, 'src/services/trusted-issuers.ts')).href);
const pi = await import(pathToFileURL(join(dir, 'src/services/price-priors-import.ts')).href);

const verifier = new ti.TrustedIssuerVerifier({
  issuers: [{
    issuer: input.issuer,
    jwks_url: `${input.issuer}/.well-known/jwks.json`,
    client_id: 'rsv.pizza', // brand-check-ignore-line (OPOP client id, fixed by the trust contract)
    audiences: input.audiences,
    scopes: ['pizza:browse', 'orders:read', 'orders:write'],
    required_scopes: ['pizza:browse'],
    sub_prefix: 'rsvpizza:',
    max_lifetime_s: 600,
  }],
  fetchJwks: async () => input.jwks,
  now: () => input.nowMs,
});
const opts = { issuer: input.issuer, typ: pi.PRIORS_TYP, use: pi.PRIORS_USE, maxLifetimeS: pi.PRIORS_MAX_LIFETIME_S };
const claims = await verifier.verifySignedDocument(input.jws, opts);
const parsed = claims ? pi.parsePriorsDocument(claims) : null;
const valid = parsed && parsed.ok ? pi.validateBatch(parsed.rows, []) : null;
const out = {
  verified: !!claims,
  claims,
  parsed,
  valid,
  bytes: Buffer.byteLength(input.jws),
  maxBytes: pi.PRIORS_MAX_BYTES,
  // the two types must never cross
  docAsToken: input.jws ? await verifier.verify(input.jws) : null,
  tokenAsDoc: input.accessToken ? await verifier.verifySignedDocument(input.accessToken, opts) : null,
  tokenAsToken: input.accessToken ? !!(await verifier.verify(input.accessToken)) : null,
};
process.stdout.write(JSON.stringify(out) + '\n');
