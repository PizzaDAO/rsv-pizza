import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { verifyBlandWebhook } from '../middleware/webhookAuth.js';
import { AppError } from '../middleware/error.js';
import {
  initiateCall,
  processWebhook,
  getCallById,
  retryCall,
  InitiateCallRequest,
  BlandWebhookPayload,
} from '../services/blandAI.service.js';

const router = Router();

// POST /api/ai-phone/initiate - Start AI phone call
router.post(
  '/initiate',
  requireAuth,
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
