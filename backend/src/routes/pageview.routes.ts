import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import crypto from 'crypto';

const router = Router();

// POST /api/events/:slug/view — Fire-and-forget page view tracking (public, no auth)
router.post('/:slug/view', async (req: Request, res: Response, _next: NextFunction) => {
  // Always return 204 — never fail the request
  try {
    const { slug } = req.params;
    const { referrer } = req.body || {};

    // Find party by inviteCode or customUrl
    let party = await prisma.party.findUnique({
      where: { inviteCode: slug },
      select: { id: true },
    });
    if (!party) {
      party = await prisma.party.findUnique({
        where: { customUrl: slug },
        select: { id: true },
      });
    }

    if (!party) {
      res.status(204).end();
      return;
    }

    // Extract IP and User-Agent from headers
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || req.socket.remoteAddress
      || 'unknown';
    const ua = (req.headers['user-agent'] as string) || 'unknown';

    // Compute privacy-friendly visitor hash: SHA-256(IP + User-Agent)
    const visitorHash = crypto
      .createHash('sha256')
      .update(`${ip}|${ua}`)
      .digest('hex');

    // Deduplication: skip if same visitor_hash viewed this party within last 30 minutes
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
    const recent = await prisma.pageView.findFirst({
      where: {
        partyId: party.id,
        visitorHash,
        viewedAt: { gte: thirtyMinAgo },
      },
      select: { id: true },
    });

    if (recent) {
      res.status(204).end();
      return;
    }

    // Insert page view record
    await prisma.pageView.create({
      data: {
        partyId: party.id,
        visitorHash,
        ipAddress: ip,
        userAgent: ua.substring(0, 500), // Truncate long user agents
        referrer: typeof referrer === 'string' ? referrer.substring(0, 2000) : null,
      },
    });

    res.status(204).end();
  } catch (error) {
    // Never fail — swallow all errors and return 204
    console.error('Page view tracking error (non-fatal):', error);
    res.status(204).end();
  }
});

export default router;
