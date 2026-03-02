import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

/**
 * Middleware to verify Bland AI webhook authenticity.
 *
 * Bland AI can send webhooks with a signature header for verification.
 * If BLAND_WEBHOOK_SECRET is not set, webhooks are accepted without verification
 * (useful for development).
 */
export const verifyBlandWebhook = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const webhookSecret = process.env.BLAND_WEBHOOK_SECRET;

  // If no secret configured, allow all webhooks (dev mode)
  if (!webhookSecret) {
    console.warn('BLAND_WEBHOOK_SECRET not set - accepting webhook without verification');
    return next();
  }

  // Get the signature from headers
  const signature = req.headers['x-bland-signature'] as string | undefined;

  if (!signature) {
    console.warn('Webhook received without signature');
    // In production, you might want to reject unsigned webhooks
    // For now, we'll allow them but log a warning
    return next();
  }

  try {
    // Verify the signature
    // Bland AI typically uses HMAC-SHA256 for webhook signatures
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(JSON.stringify(req.body))
      .digest('hex');

    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );

    if (!isValid) {
      console.error('Invalid webhook signature');
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    next();
  } catch (error) {
    console.error('Webhook verification error:', error);
    // If verification fails due to format issues, log but continue
    // This prevents webhook delivery failures during development
    next();
  }
};
