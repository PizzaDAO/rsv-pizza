import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { verifyBlandWebhook } from '../middleware/webhookAuth.js';
import { AppError } from '../middleware/error.js';
import { canUserEditParty } from '../helpers/partyAccess.js';
import { prisma } from '../config/database.js';
import {
  initiateCall,
  processWebhook,
  getCallById,
  retryCall,
  fetchBlandCall,
  fetchBlandRecording,
  blandCallHadCard,
  safeTranscript,
  InitiateCallRequest,
  BlandWebhookPayload,
  OrderItem,
} from '../services/blandAI.service.js';

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ITEMS = 30;
const MAX_QTY_PER_ITEM = 50;
const MAX_TOTAL_PIZZAS = 100;

function maxCallsPerPartyPerDay(): number {
  const n = Number.parseInt(process.env.AI_PHONE_MAX_CALLS_PER_PARTY_PER_DAY || '', 10);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

function str(value: unknown, field: string, max: number, required = true): string | undefined {
  if (value === undefined || value === null || value === '') {
    if (required) throw new AppError(`${field} is required`, 400, 'VALIDATION_ERROR');
    return undefined;
  }
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError(`${field} must be a string`, 400, 'VALIDATION_ERROR');
  }
  if (value.length > max) throw new AppError(`${field} is too long`, 400, 'VALIDATION_ERROR');
  return value.trim();
}

function phone(value: unknown, field: string): string {
  const s = str(value, field, 40)!;
  const digits = s.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15 || !/^[\d\s()+.-]+$/.test(s)) {
    throw new AppError(`${field} must be a phone number`, 400, 'VALIDATION_ERROR');
  }
  return s;
}

function strList(value: unknown, field: string, maxLen: number, maxEach: number): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maxLen) {
    throw new AppError(`${field} is invalid`, 400, 'VALIDATION_ERROR');
  }
  return value.map((v) => {
    if (typeof v !== 'string' || v.length > maxEach) throw new AppError(`${field} is invalid`, 400, 'VALIDATION_ERROR');
    return v;
  });
}

/** Validates and normalizes the order items (only known fields are kept). */
export function parseItems(raw: unknown): OrderItem[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new AppError('items must be a non-empty array', 400, 'VALIDATION_ERROR');
  }
  if (raw.length > MAX_ITEMS) throw new AppError('Too many items', 400, 'VALIDATION_ERROR');
  const items = raw.map((it: any) => {
    if (!it || typeof it !== 'object') throw new AppError('items are invalid', 400, 'VALIDATION_ERROR');
    const quantity = it.quantity;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY_PER_ITEM) {
      throw new AppError('item quantity is invalid', 400, 'VALIDATION_ERROR');
    }
    return {
      name: str(it.name, 'item name', 200)!,
      quantity,
      size: str(it.size, 'item size', 80)!,
      toppings: strList(it.toppings, 'item toppings', 20, 80),
      dietaryNotes: strList(it.dietaryNotes, 'item dietaryNotes', 10, 80),
    };
  });
  if (items.reduce((s, i) => s + i.quantity, 0) > MAX_TOTAL_PIZZAS) {
    throw new AppError(`At most ${MAX_TOTAL_PIZZAS} pizzas per call`, 400, 'VALIDATION_ERROR');
  }
  return items;
}

function notConfigured(): AppError {
  return new AppError('AI phone ordering is not configured yet. Please try again later.', 503, 'BLAND_NOT_CONFIGURED');
}

async function assertCanEditParty(partyId: string, req: AuthRequest): Promise<void> {
  if (!(await canUserEditParty(partyId, req.userId, req.userEmail))) {
    throw new AppError('Not authorized for this party', 403, 'FORBIDDEN');
  }
}

/** Looks a call up by our id or by the Bland call id; 404 if missing, 403 if not the caller's. */
async function loadViewableCall(ref: string, req: AuthRequest) {
  if (!ref || ref === 'pending' || ref.length > 100) throw new AppError('Call not found', 404, 'NOT_FOUND');
  const call =
    (await prisma.aIPhoneCall.findUnique({ where: { id: ref } })) ??
    (await prisma.aIPhoneCall.findUnique({ where: { callId: ref } }));
  if (!call) throw new AppError('Call not found', 404, 'NOT_FOUND');
  const allowed = call.userId === req.userId || (await canUserEditParty(call.partyId, req.userId, req.userEmail));
  if (!allowed) throw new AppError('Not authorized', 403, 'FORBIDDEN');
  return call;
}

// POST /api/ai-phone/initiate - Start AI phone call (party editors only)
router.post(
  '/initiate',
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const body = req.body || {};
      const partyId = body.partyId;
      if (!partyId || typeof partyId !== 'string' || !UUID_RE.test(partyId)) {
        throw new AppError('partyId is required', 400, 'VALIDATION_ERROR');
      }

      // sec-edge-functions: the caller must be able to edit the party the call is billed to.
      await assertCanEditParty(partyId, req);

      const pizzeriaName = str(body.pizzeriaName, 'pizzeriaName', 200)!;
      const pizzeriaPhone = phone(body.pizzeriaPhone, 'pizzeriaPhone');
      const items = parseItems(body.items);
      const customerName = str(body.customerName, 'customerName', 100)!;
      const customerPhone = phone(body.customerPhone, 'customerPhone');
      const fulfillmentType = body.fulfillmentType;
      if (!fulfillmentType || !['pickup', 'delivery'].includes(fulfillmentType)) {
        throw new AppError('fulfillmentType must be "pickup" or "delivery"', 400, 'VALIDATION_ERROR');
      }
      const deliveryAddress = str(body.deliveryAddress, 'deliveryAddress', 300, false);
      if (fulfillmentType === 'delivery' && !deliveryAddress) {
        throw new AppError('deliveryAddress is required for delivery orders', 400, 'VALIDATION_ERROR');
      }
      const partySize =
        Number.isInteger(body.partySize) && body.partySize > 0 && body.partySize <= 10_000 ? body.partySize : undefined;
      const payWithCard = body.payWithCard === true;

      // Bland calls cost money: cap them per party per day.
      const recent = await prisma.aIPhoneCall.count({
        where: { partyId, createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
      });
      if (recent >= maxCallsPerPartyPerDay()) {
        throw new AppError('Too many AI calls for this party today. Try again tomorrow.', 429, 'RATE_LIMITED');
      }

      const request: InitiateCallRequest = {
        partyId,
        userId: req.userId!,
        pizzeriaName,
        pizzeriaPhone,
        items,
        customerName,
        customerPhone,
        fulfillmentType,
        deliveryAddress,
        partySize,
        payWithCard,
      };

      const result = await initiateCall(request);

      if (!result.success) {
        throw new AppError(result.error || 'Failed to initiate call', 500, 'CALL_ERROR');
      }

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/ai-phone/calls/:ref/live - Live status + transcript from Bland (replaces the
// `ai-call-status` edge function). :ref is our call id or the Bland call id.
router.get(
  '/calls/:ref/live',
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const call = await loadViewableCall(req.params.ref, req);
      if (call.callId === 'pending') {
        return res.json({ status: 'queued', transcript: '', callLength: null, answeredBy: 'unknown', endedReason: null, recordingAvailable: false });
      }
      const bland = await fetchBlandCall(call.callId);
      if (!bland.ok) {
        if (bland.status === 503) throw notConfigured();
        throw new AppError('Failed to get call status', bland.status === 404 ? 404 : 502, 'BLAND_ERROR');
      }
      const data = bland.data;
      let transcript = '';
      if (data.concatenated_transcript) {
        transcript = data.concatenated_transcript;
      } else if (Array.isArray(data.transcripts)) {
        transcript = data.transcripts.map((t) => `${t.user}: ${t.text}`).join('\n');
      }
      const status = data.status || data.call_status || 'unknown';
      res.set('Cache-Control', 'private, no-store');
      res.json({
        status,
        transcript: (await safeTranscript(transcript, data)) ?? '',
        callLength: data.call_length ?? null,
        answeredBy: data.answered_by || 'unknown',
        endedReason: data.ended_reason || null,
        recordingAvailable: !blandCallHadCard(data),
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/ai-phone/calls/:ref/recording - Audio proxy (replaces the `ai-call-recording` edge
// function). Withheld for card-paid calls: the card number is read aloud in them.
router.get(
  '/calls/:ref/recording',
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const call = await loadViewableCall(req.params.ref, req);
      if (call.callId === 'pending') throw new AppError('Recording not available', 404, 'NOT_FOUND');
      const details = await fetchBlandCall(call.callId);
      if (details.status === 503) throw notConfigured();
      if (!details.ok) throw new AppError('Recording not available', 404, 'NOT_FOUND');
      if (blandCallHadCard(details.data)) {
        throw new AppError('Recordings are not available for calls that included payment details', 404, 'NOT_FOUND');
      }
      const audio = await fetchBlandRecording(call.callId);
      if (!audio || !audio.ok) throw new AppError('Failed to fetch recording', 502, 'BLAND_ERROR');
      const buf = Buffer.from(await audio.arrayBuffer());
      res.set('Content-Type', audio.headers.get('Content-Type') || 'audio/mpeg');
      res.set('Cache-Control', 'private, no-store');
      res.send(buf);
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/ai-phone/:id/status - Get call status by our ID
router.get(
  '/:id/status',
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      const call = await getCallById(id);

      if (!call) {
        throw new AppError('Call not found', 404, 'NOT_FOUND');
      }

      // Ensure user owns this call
      if (call.userId !== req.userId) {
        throw new AppError('Not authorized', 403, 'FORBIDDEN');
      }

      res.json({
        id: call.id,
        callId: call.callId,
        status: call.status,
        pizzeriaName: call.pizzeriaName,
        orderConfirmed: call.orderConfirmed,
        confirmedTotal: call.confirmedTotal,
        estimatedTime: call.estimatedTime,
        summary: call.summary,
        callDuration: call.callDuration,
        callStartedAt: call.callStartedAt,
        callEndedAt: call.callEndedAt,
        order: call.order,
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/ai-phone/:id/transcript - Get full transcript
router.get(
  '/:id/transcript',
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      const call = await getCallById(id);

      if (!call) {
        throw new AppError('Call not found', 404, 'NOT_FOUND');
      }

      // Ensure user owns this call
      if (call.userId !== req.userId) {
        throw new AppError('Not authorized', 403, 'FORBIDDEN');
      }

      res.json({
        id: call.id,
        transcript: call.transcript,
        summary: call.summary,
        recordingUrl: call.recordingUrl,
        callDuration: call.callDuration,
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/ai-phone/:id/retry - Retry a failed call
router.post(
  '/:id/retry',
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      const call = await getCallById(id);

      if (!call) {
        throw new AppError('Call not found', 404, 'NOT_FOUND');
      }

      // Ensure user owns this call
      if (call.userId !== req.userId) {
        throw new AppError('Not authorized', 403, 'FORBIDDEN');
      }

      // ...and can still edit the party (a removed co-host must not keep dialing on its dime)
      await assertCanEditParty(call.partyId, req);

      // Only allow retry on failed or no_answer calls
      if (!['failed', 'no_answer'].includes(call.status)) {
        throw new AppError('Can only retry failed or unanswered calls', 400, 'INVALID_STATUS');
      }

      const recent = await prisma.aIPhoneCall.count({
        where: { partyId: call.partyId, createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
      });
      if (recent >= maxCallsPerPartyPerDay()) {
        throw new AppError('Too many AI calls for this party today. Try again tomorrow.', 429, 'RATE_LIMITED');
      }

      const result = await retryCall(id);

      if (!result.success) {
        throw new AppError(result.error || 'Failed to retry call', 500, 'CALL_ERROR');
      }

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/ai-phone/webhook - Receive Bland AI webhooks (signature required; see webhookAuth)
router.post(
  '/webhook',
  verifyBlandWebhook,
  async (req: Request, res: Response) => {
    try {
      const payload: BlandWebhookPayload = req.body;

      console.log('Received Bland AI webhook:', {
        call_id: payload.call_id,
        status: payload.status,
        completed: payload.completed,
      });

      await processWebhook(payload);

      // Always respond 200 to acknowledge receipt
      res.json({ received: true });
    } catch (error) {
      console.error('Webhook processing error:', error);
      // Still respond 200 to prevent retries, but log the error
      res.json({ received: true, error: 'Processing error logged' });
    }
  }
);

export default router;
