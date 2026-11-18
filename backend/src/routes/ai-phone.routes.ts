import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { verifyBlandWebhook } from '../middleware/webhookAuth.js';
import { AppError } from '../middleware/error.js';
import { canUserEditParty } from '../helpers/partyAccess.js';
import { prisma } from '../config/database.js';
import { blandCallHadCard, safeTranscript } from '../lib/cardRedact.js';
import {
  initiateCall,
  processWebhook,
  getCallById,
  retryCall,
  fetchBlandCall,
  fetchBlandRecording,
  InitiateCallRequest,
  BlandWebhookPayload,
} from '../services/blandAI.service.js';

const router = Router();

function notConfigured(): AppError {
  return new AppError('AI phone calls are not configured yet. Please try again later.', 503, 'BLAND_NOT_CONFIGURED');
}

/**
 * sec-edge-functions: looks a call up by our id or the Bland call id; 404 if missing, 403 unless
 * the caller placed it or can edit its party. Replaces the anon-callable `ai-call-status` /
 * `ai-call-recording` edge functions, which served any call id to anyone.
 */
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

// GET /api/ai-phone/calls/:ref/live - live status + (redacted) transcript from Bland
router.get('/calls/:ref/live', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
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
    res.set('Cache-Control', 'private, no-store');
    res.json({
      status: data.status || data.call_status || 'unknown',
      transcript: safeTranscript(transcript, data) ?? '',
      callLength: data.call_length ?? null,
      answeredBy: data.answered_by || 'unknown',
      endedReason: data.ended_reason || null,
      recordingAvailable: !blandCallHadCard(data),
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/ai-phone/calls/:ref/recording - audio proxy; withheld for calls that carried a card
router.get('/calls/:ref/recording', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
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
    if (!audio) throw notConfigured();
    if (!audio.ok) throw new AppError('Failed to fetch recording', 502, 'BLAND_ERROR');
    const buf = Buffer.from(await audio.arrayBuffer());
    res.set('Content-Type', audio.headers.get('Content-Type') || 'audio/mpeg');
    res.set('Cache-Control', 'private, no-store');
    res.send(buf);
  } catch (error) {
    next(error);
  }
});

/**
 * basil-14648: placing or retrying a legacy Bland call is retired. AI ordering now goes through pizza-mcp
 * (pizza-order.routes.ts): host approval code, a price ceiling, no card by voice. These two routes let ANY signed-in
 * user dial ANY number with a "deviate from the order" prompt and no party check. Status, transcript and the
 * webhook stay so old call history still reads. The whole file goes in the P2 cleanup (plan section 10).
 */
export function legacyCallRetired(_req: Request, _res: Response, next: NextFunction) {
  next(new AppError('AI phone ordering moved. This endpoint no longer places calls.', 410, 'ENDPOINT_RETIRED'));
}

// POST /api/ai-phone/initiate - Start AI phone call
router.post(
  '/initiate',
  requireAuth,
  legacyCallRetired,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const {
        partyId,
        pizzeriaName,
        pizzeriaPhone,
        items,
        customerName,
        customerPhone,
        fulfillmentType,
        deliveryAddress,
        partySize,
        estimatedTotal,
      } = req.body;

      // Validation
      if (!partyId || typeof partyId !== 'string') {
        throw new AppError('partyId is required', 400, 'VALIDATION_ERROR');
      }

      if (!pizzeriaName || typeof pizzeriaName !== 'string') {
        throw new AppError('pizzeriaName is required', 400, 'VALIDATION_ERROR');
      }

      if (!pizzeriaPhone || typeof pizzeriaPhone !== 'string') {
        throw new AppError('pizzeriaPhone is required', 400, 'VALIDATION_ERROR');
      }

      if (!items || !Array.isArray(items) || items.length === 0) {
        throw new AppError('items must be a non-empty array', 400, 'VALIDATION_ERROR');
      }

      if (!customerName || typeof customerName !== 'string') {
        throw new AppError('customerName is required', 400, 'VALIDATION_ERROR');
      }

      if (!customerPhone || typeof customerPhone !== 'string') {
        throw new AppError('customerPhone is required', 400, 'VALIDATION_ERROR');
      }

      if (!fulfillmentType || !['pickup', 'delivery'].includes(fulfillmentType)) {
        throw new AppError('fulfillmentType must be "pickup" or "delivery"', 400, 'VALIDATION_ERROR');
      }

      if (fulfillmentType === 'delivery' && !deliveryAddress) {
        throw new AppError('deliveryAddress is required for delivery orders', 400, 'VALIDATION_ERROR');
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
        estimatedTotal,
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
  legacyCallRetired,
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

      // Only allow retry on failed or no_answer calls
      if (!['failed', 'no_answer'].includes(call.status)) {
        throw new AppError('Can only retry failed or unanswered calls', 400, 'INVALID_STATUS');
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

// POST /api/ai-phone/webhook - Receive Bland AI webhooks (public endpoint)
router.post(
  '/webhook',
  verifyBlandWebhook,
  async (req: Request, res: Response, next: NextFunction) => {
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
