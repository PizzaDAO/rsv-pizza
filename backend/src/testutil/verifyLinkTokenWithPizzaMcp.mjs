// Runs INSIDE a pizza-mcp checkout (cwd = PIZZA_MCP_DIR) and asks pizza-mcp's REAL
// TrustedIssuerVerifier whether it would accept a given JWS as an access token. Used to prove a
// pizzadao link token is never accepted there. Only needs trusted-issuers.ts.
// stdin: {token, jwks, issuer, audiences, nowMs}. stdout: one JSON line {accepted}.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = process.env.PIZZA_MCP_DIR;
const input = JSON.parse(await new Promise((res) => {
  let s = '';
  process.stdin.on('data', (c) => (s += c));
  process.stdin.on('end', () => res(s));
}));
const ti = await import(pathToFileURL(join(dir, 'src/services/trusted-issuers.ts')).href);
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
let accepted = false;
try {
  accepted = !!(await verifier.verify(input.token));
} catch {
  accepted = false;
}
process.stdout.write(JSON.stringify({ accepted }) + '\n');
