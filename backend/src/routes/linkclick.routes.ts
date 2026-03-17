import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import crypto from 'crypto';

const router = Router();

// POST /api/events/:slug/click — Fire-and-forget link click tracking (public, no auth)
router.post('/:slug/click', async (req: Request, res: Response, _next: NextFunction) => {
  // Always return 204 — never fail the request
  try {
    const { slug } = req.params;
    const { url, linkType, linkLabel } = req.body || {};

    // Require url and linkType
    if (!url || !linkType) {
      res.status(204).end();
      return;
    }

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

    // No dedup — every click is recorded
    await prisma.linkClick.create({
      data: {
        partyId: party.id,
        url: typeof url === 'string' ? url.substring(0, 2000) : String(url).substring(0, 2000),
        linkType: typeof linkType === 'string' ? linkType.substring(0, 100) : String(linkType).substring(0, 100),
        linkLabel: typeof linkLabel === 'string' ? linkLabel.substring(0, 500) : null,
        visitorHash,
        ipAddress: ip,
        userAgent: ua.substring(0, 500),
      },
    });

    res.status(204).end();
  } catch (error) {
    // Never fail — swallow all errors and return 204
    console.error('Link click tracking error (non-fatal):', error);
    res.status(204).end();
  }
});

export default router;
