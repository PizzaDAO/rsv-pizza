/**
 * basil-14648 P2 (price priors): public, aggregate-only price priors for pizza-mcp.
 *
 *   GET /api/pizza-index/priors       JSON {v:1, generated_at, rows}   (debug / transparency view)
 *   GET /api/pizza-index/priors.jws   application/jose, a compact JWS signed with PIZZA_MCP_SIGNING_KEY
 *                                     (pizza-mcp docs/CLIENTS.md section 4); 503 PRIORS_SIGNING_UNAVAILABLE
 *                                     while the key or PIZZA_MCP_URL is unset.
 *
 * Both are cached 1 h. Rows are the same grain as the public index (n >= 3 events, >= 2 merchants,
 * year granularity, no ids or names), so this adds no new disclosure. Mounted BEFORE publicPizzaIndexRouter.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { canSignPriceDocument, signPriceDocument } from '../lib/pizzaMcpToken.js';
import { getPriceDocument, type PriceDocument } from '../services/pricePriors.service.js';

const router = Router();
const CACHE = 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600';

router.get('/priors', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const doc = await getPriceDocument();
    res.set('Cache-Control', CACHE);
    res.json(doc);
  } catch (err) {
    next(err);
  }
});

// One signature per built document: the same document keeps the same iat, so pizza-mcp sees "not newer"
// (a no-op) instead of a fresh import every request.
let signed: { doc: PriceDocument; jws: string } | null = null;

router.get('/priors.jws', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    if (!canSignPriceDocument()) {
      res.set('Cache-Control', 'no-store');
      return res.status(503).json({ error: { message: 'Price priors signing is not configured', code: 'PRIORS_SIGNING_UNAVAILABLE' } });
    }
    const doc = await getPriceDocument();
    if (!signed || signed.doc !== doc) signed = { doc, jws: signPriceDocument(doc) };
    res.set('Cache-Control', CACHE);
    res.type('application/jose').send(signed.jws);
  } catch (err) {
    next(err);
  }
});

/** Test seam. */
export function resetSignedPriorsCache(): void {
  signed = null;
}

export default router;
