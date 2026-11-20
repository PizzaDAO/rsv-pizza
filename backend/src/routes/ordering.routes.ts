import { Router, Request, Response, NextFunction } from 'express';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { canUserEditParty } from '../helpers/partyAccess.js';
import { parseSearchInput, searchPizzerias, PizzeriaSearchError } from '../lib/pizzeriaSearch.js';
import { createSquareOrder, SquareOrderItem } from '../lib/squareClient.js';

/**
 * sec-edge-functions-2: replaces the anon-callable `search-pizzerias` and `square-order` edge
 * functions. Mounted at /api/ordering.
 *   - search-pizzerias: public (the guest RSVP flow uses it), validated input, per-IP rate limit.
 *   - square-order: requireAuth + party editor, strict validation, per-user rate limit.
 */
const router = Router();

const searchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'Too many pizzeria searches, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req) => 'ip:' + ipKeyGenerator(req.ip ?? ''),
});

const squareLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { error: 'Too many order attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req) => 'u:' + ((req as AuthRequest).userId || ipKeyGenerator(req.ip ?? '')),
});

// POST /api/ordering/search-pizzerias
router.post('/search-pizzerias', searchLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { lat, lng, radius } = parseSearchInput(req.body);
    const pizzerias = await searchPizzerias(lat, lng, radius);
    res.json({ pizzerias });
  } catch (error) {
    if (error instanceof PizzeriaSearchError) {
      return next(new AppError(error.message, error.status, error.status === 400 ? 'VALIDATION_ERROR' : 'SEARCH_ERROR'));
    }
    next(error);
  }
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCATION_RE = /^[A-Za-z0-9_-]{1,64}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[0-9 ()\-.]{7,20}$/;
export const MAX_ITEMS = 20;
export const MAX_QTY = 100;
export const MAX_UNIT_PRICE = 500; // dollars

const bad = (msg: string) => new AppError(msg, 400, 'VALIDATION_ERROR');

function str(v: unknown, field: string, max: number, required = false): string | undefined {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`${field} is required`);
    return undefined;
  }
  if (typeof v !== 'string' || v.length > max) throw bad(`${field} is invalid`);
  const t = v.trim();
  if (required && !t) throw bad(`${field} is required`);
  return t || undefined;
}

function strList(v: unknown, field: string): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > 30) throw bad(`${field} is invalid`);
  return v.map((x) => {
    if (typeof x !== 'string' || x.length > 100) throw bad(`${field} is invalid`);
    return x.trim();
  });
}

function parseItems(raw: unknown): SquareOrderItem[] {
  if (!Array.isArray(raw) || raw.length === 0) throw bad('items are required');
  if (raw.length > MAX_ITEMS) throw bad(`at most ${MAX_ITEMS} items`);
  return raw.map((it: any) => {
    if (!it || typeof it !== 'object') throw bad('items are invalid');
    if (!Number.isInteger(it.quantity) || it.quantity < 1 || it.quantity > MAX_QTY) throw bad('item quantity is invalid');
    let priceEstimate: number | undefined;
    if (it.priceEstimate !== undefined && it.priceEstimate !== null) {
      if (typeof it.priceEstimate !== 'number' || !Number.isFinite(it.priceEstimate) || it.priceEstimate < 0 || it.priceEstimate > MAX_UNIT_PRICE) {
        throw bad('item price is invalid');
      }
      priceEstimate = it.priceEstimate;
    }
    return {
      name: str(it.name, 'item name', 100, true)!,
      quantity: it.quantity,
      size: str(it.size, 'item size', 50) ?? '',
      toppings: strList(it.toppings, 'toppings'),
      dietaryNotes: strList(it.dietaryNotes, 'dietaryNotes'),
      priceEstimate,
    };
  });
}

// POST /api/ordering/square-order  (host/co-host editors of the party only)
router.post('/square-order', requireAuth, squareLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const b = req.body || {};
    if (typeof b.partyId !== 'string' || !UUID_RE.test(b.partyId)) throw bad('partyId is required');
    if (!(await canUserEditParty(b.partyId, req.userId, req.userEmail))) {
      throw new AppError('Not authorized', 403, 'FORBIDDEN');
    }

    if (typeof b.locationId !== 'string' || !LOCATION_RE.test(b.locationId)) throw bad('locationId is required');
    if (b.fulfillmentType !== 'PICKUP' && b.fulfillmentType !== 'DELIVERY') throw bad('fulfillmentType is invalid');
    const customerName = str(b.customerName, 'customerName', 100, true)!;
    const customerPhone = str(b.customerPhone, 'customerPhone', 20);
    if (customerPhone && !PHONE_RE.test(customerPhone)) throw bad('customerPhone is invalid');
    const customerEmail = str(b.customerEmail, 'customerEmail', 254);
    if (customerEmail && !EMAIL_RE.test(customerEmail)) throw bad('customerEmail is invalid');
    const deliveryAddress = str(b.deliveryAddress, 'deliveryAddress', 300);
    if (b.fulfillmentType === 'DELIVERY' && !deliveryAddress) throw bad('deliveryAddress is required');
    const scheduledTime = str(b.scheduledTime, 'scheduledTime', 40);
    if (scheduledTime && Number.isNaN(Date.parse(scheduledTime))) throw bad('scheduledTime is invalid');
    const items = parseItems(b.items);

    const result = await createSquareOrder({
      locationId: b.locationId,
      items,
      customerName,
      customerPhone,
      customerEmail,
      fulfillmentType: b.fulfillmentType,
      deliveryAddress,
      scheduledTime,
    });
    res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
