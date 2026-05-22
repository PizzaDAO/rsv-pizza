import { Router, Response, NextFunction, Request } from 'express';
import { prisma } from '../config/database.js';

const router = Router();
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 50;

function parseCursor(raw: unknown): { createdAt: Date; id: string } | null {
  if (typeof raw !== 'string' || !raw.includes('_')) return null;
  const sepIdx = raw.lastIndexOf('_');
  const ts = raw.slice(0, sepIdx);
  const id = raw.slice(sepIdx + 1);
  const d = new Date(ts);
  if (Number.isNaN(d.getTime()) || !id) return null;
  return { createdAt: d, id };
}

router.get('/feed', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(
      Math.max(parseInt((req.query.limit as string) || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, 1),
      MAX_LIMIT
    );
    const cursor = parseCursor(req.query.cursor);

    const where: any = {
      starred: true,
      status: 'approved',
      party: {
        is: {
          underbossStatus: 'approved',
          photosPublic: true,
          photosEnabled: true,
        },
      },
    };

    if (cursor) {
      where.OR = [
        { createdAt: { lt: cursor.createdAt } },
        { AND: [{ createdAt: cursor.createdAt }, { id: { lt: cursor.id } }] },
      ];
    }

    const rows = await prisma.photo.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        url: true,
        thumbnailUrl: true,
        caption: true,
        mimeType: true,
        duration: true,
        width: true,
        height: true,
        createdAt: true,
        party: {
          select: {
            id: true,
            name: true,
            customUrl: true,
            inviteCode: true,
            city: true,
            country: true,
          },
        },
      },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore
      ? `${page[page.length - 1].createdAt.toISOString()}_${page[page.length - 1].id}`
      : null;

    res.json({
      photos: page.map((p) => ({
        id: p.id,
        url: p.url,
        thumbnailUrl: p.thumbnailUrl,
        caption: p.caption,
        mimeType: p.mimeType,
        duration: p.duration,
        width: p.width,
        height: p.height,
        createdAt: p.createdAt,
        party: {
          slug: p.party.customUrl || p.party.inviteCode,
          name: p.party.name,
          city: p.party.city,
          country: p.party.country,
        },
      })),
      nextCursor,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
