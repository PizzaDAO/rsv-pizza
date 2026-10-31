import { Router, Request, Response } from 'express';
import { publicJwks } from '../lib/pizzaMcpToken.js';

const router = Router();

/**
 * basil-14648: GET /.well-known/jwks.json — the public key pizza-mcp uses to verify the
 * short-lived ES256 tokens rsv.pizza mints (see lib/pizzaMcpToken.ts). Public by design.
 * 404 until PIZZA_MCP_SIGNING_KEY is configured, so nobody caches an empty key set.
 */
router.get('/jwks.json', (_req: Request, res: Response) => {
  const jwks = publicJwks();
  if (!jwks) {
    return res.status(404).json({ error: { message: 'Not configured', code: 'NOT_FOUND' } });
  }
  res.set('Cache-Control', 'public, max-age=300');
  res.json(jwks);
});

export default router;
