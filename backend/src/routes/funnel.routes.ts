import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import crypto from 'crypto';

const router = Router();

// POST /api/events/:slug/funnel — Fire-and-forget RSVP funnel tracking (public, no auth)
router.post('/:slug/funnel', async (req: Request, res: Response, _next: NextFunction) => {
  // Always return 204 — never fail the request
  try {
    const { slug } = req.params;
    const { step } = req.body || {};

    // Validate step
    const validSteps = ['rsvp_opened', 'rsvp_step1_complete'];
    if (!step || !validSteps.includes(step)) {
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
    // Alias fallback: silently resolve old slugs
    if (!party) {
      const alias = await prisma.slugAlias.findUnique({
        where: { oldSlug: slug },
        select: { partyId: true },
      });
      if (alias) {
        party = await prisma.party.findUnique({
          where: { id: alias.partyId },
          select: { id: true },
        });
      }
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

    // Upsert — deduplicates automatically via unique constraint
    await prisma.rsvpFunnelEvent.upsert({
      where: {
        partyId_visitorHash_step: {
          partyId: party.id,
          visitorHash,
          step,
        },
      },
      update: {}, // No-op on duplicate
      create: {
        partyId: party.id,
        step,
        visitorHash,
        ipAddress: ip,
        userAgent: ua.substring(0, 500),
      },
    });

    res.status(204).end();
  } catch (error) {
    // Never fail — swallow all errors and return 204
    console.error('RSVP funnel tracking error (non-fatal):', error);
    res.status(204).end();
  }
});

export default router;
