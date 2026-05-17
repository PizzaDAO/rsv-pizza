import { Router, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { classifyLogo, stripWhiteBackground, type LogoClass } from '../lib/logoBackgroundStrip.js';
import { syncPartnerToAllEvents, syncAutoSponsorsToAllEvents } from '../helpers/partnerSync.js';
import crypto from 'crypto';

const router = Router();

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BUCKET = 'event-images';
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const DOWNLOAD_CONCURRENCY = 12;
const DOWNLOAD_TIMEOUT_MS = 10_000;
const PREVIEW_TIMEOUT_MS = 30_000;

/**
 * Graphics-admin auth gate. Mirrors the pattern in underboss.routes.ts:77-87.
 * Allows admins or any user listed in `graphics_admins`.
 */
async function requireGraphicsAdminAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const email = req.userEmail;
    if (!email) {
      throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
    }

    if (await isAdmin(email)) return next();

    const graphicsAdmin = await prisma.graphicsAdmin.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (graphicsAdmin) return next();

    throw new AppError('Graphics admin access required', 403, 'FORBIDDEN');
  } catch (error) {
    next(error);
  }
}

interface SponsorInfo {
  sponsorId: string;
  partyId: string;
  partySlug: string;
  partyName: string;
  partyCity: string;
  partnerName: string;
}

interface AuditItem {
  logoUrl: string;
  classification: 'white_bg_png' | 'jpeg_white';
  sponsors: SponsorInfo[];
  sponsorUserId: string | null;
  sponsorUserName: string | null;
  eventCount: number;
}

interface AuditCache {
  expiresAt: number;
  items: AuditItem[];
}

let auditCache: AuditCache | null = null;

function invalidateAuditCache() {
  auditCache = null;
}

/**
 * Fetch a URL into a Buffer with a timeout.
 * Returns { buffer, contentType } on success, null on any failure.
 */
async function fetchBuffer(
  url: string,
  timeoutMs: number
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    const ab = await res.arrayBuffer();
    return { buffer: Buffer.from(ab), contentType };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Derive a "city" display name from a party. Many GPP events are named
 * "Global Pizza Party <City>" — strip that prefix for nicer display.
 * Falls back to the full name if no GPP prefix matched.
 */
function derivePartyCity(name: string): string {
  return (name || '').replace(/^Global Pizza Party\s*/i, '').trim() || name;
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  const workers: Promise<void>[] = [];
  for (let w = 0; w < Math.min(concurrency, items.length); w++) {
    workers.push((async () => {
      while (true) {
        const i = idx++;
        if (i >= items.length) return;
        results[i] = await worker(items[i]);
      }
    })());
  }
  await Promise.all(workers);
  return results;
}

interface SponsorRow {
  id: string;
  name: string;
  logoUrl: string | null;
  contactEmail: string | null;
  partyId: string;
  party: {
    id: string;
    name: string;
    inviteCode: string;
    customUrl: string | null;
  };
}

/**
 * Build the audit list. Slow — does ~all-sponsor downloads in parallel.
 */
async function computeAuditItems(): Promise<AuditItem[]> {
  const sponsors = await prisma.sponsor.findMany({
    where: {
      logoUrl: { not: null },
      status: { in: ['yes', 'billed', 'paid'] },
      party: {
        eventType: 'gpp',
        underbossStatus: 'approved',
      },
    },
    select: {
      id: true,
      name: true,
      logoUrl: true,
      contactEmail: true,
      partyId: true,
      party: {
        select: {
          id: true,
          name: true,
          inviteCode: true,
          customUrl: true,
        },
      },
    },
  });

  // Group sponsors by logoUrl
  const byUrl = new Map<string, SponsorRow[]>();
  for (const s of sponsors as SponsorRow[]) {
    if (!s.logoUrl) continue;
    const arr = byUrl.get(s.logoUrl) || [];
    arr.push(s);
    byUrl.set(s.logoUrl, arr);
  }

  const uniqueUrls = Array.from(byUrl.keys());

  // Download + classify in parallel
  const classifications = await runWithConcurrency<
    string,
    { url: string; cls: LogoClass | null }
  >(uniqueUrls, DOWNLOAD_CONCURRENCY, async (url) => {
    const fetched = await fetchBuffer(url, DOWNLOAD_TIMEOUT_MS);
    if (!fetched) return { url, cls: null };
    try {
      const cls = await classifyLogo(fetched.buffer, fetched.contentType);
      return { url, cls };
    } catch {
      return { url, cls: null };
    }
  });

  // Collect all unique contactEmails so we can look up SponsorUser records in one query
  const allEmails = new Set<string>();
  for (const list of byUrl.values()) {
    for (const s of list) {
      if (s.contactEmail) allEmails.add(s.contactEmail.toLowerCase());
    }
  }

  let sponsorUsersByLogoUrl: Map<string, { id: string; name: string | null; email: string }> = new Map();
  if (allEmails.size > 0) {
    const sponsorUsers = await prisma.sponsorUser.findMany({
      where: {
        email: { in: Array.from(allEmails) },
        coHostLogoUrl: { not: null },
      },
      select: { id: true, name: true, email: true, coHostLogoUrl: true },
    });
    for (const su of sponsorUsers) {
      if (su.coHostLogoUrl) {
        sponsorUsersByLogoUrl.set(su.coHostLogoUrl, {
          id: su.id,
          name: su.name,
          email: su.email,
        });
      }
    }
  }

  const items: AuditItem[] = [];
  for (const { url, cls } of classifications) {
    if (cls !== 'white_bg_png' && cls !== 'jpeg_white') continue;

    const list = byUrl.get(url) || [];
    const sponsorInfos: SponsorInfo[] = list.map((s) => ({
      sponsorId: s.id,
      partyId: s.partyId,
      partySlug: s.party.customUrl || s.party.inviteCode,
      partyName: s.party.name,
      partyCity: derivePartyCity(s.party.name),
      partnerName: s.name,
    }));

    const su = sponsorUsersByLogoUrl.get(url) || null;

    items.push({
      logoUrl: url,
      classification: cls,
      sponsors: sponsorInfos,
      sponsorUserId: su?.id || null,
      sponsorUserName: su?.name || null,
      eventCount: sponsorInfos.length,
    });
  }

  // Sort by eventCount desc so high-impact items appear first.
  items.sort((a, b) => b.eventCount - a.eventCount);

  return items;
}

/**
 * GET /api/admin/logo-bg-audit
 * Returns the list of logo URLs that need cleanup (white_bg_png or jpeg_white).
 */
router.get('/', requireAuth, requireGraphicsAdminAuth, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (auditCache && auditCache.expiresAt > Date.now()) {
      return res.json({ items: auditCache.items });
    }

    const items = await computeAuditItems();
    auditCache = { items, expiresAt: Date.now() + CACHE_TTL_MS };

    res.json({ items });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/logo-bg-audit/preview?url=<logoUrl>
 * Returns the stripped PNG as image/png. Used by the frontend <img> tag.
 */
router.get('/preview', requireAuth, requireGraphicsAdminAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const url = req.query.url;
    if (typeof url !== 'string' || !url) {
      throw new AppError('Missing url query parameter', 400, 'VALIDATION_ERROR');
    }

    const fetched = await fetchBuffer(url, PREVIEW_TIMEOUT_MS);
    if (!fetched) {
      return res.status(502).json({ error: { message: 'Failed to fetch source logo', code: 'FETCH_FAILED' } });
    }

    let png: Buffer;
    try {
      png = await stripWhiteBackground(fetched.buffer);
    } catch (err) {
      console.error('stripWhiteBackground failed for', url, err);
      return res.status(502).json({ error: { message: 'Failed to process image', code: 'PROCESS_FAILED' } });
    }

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(png);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/admin/logo-bg-audit/apply
 * Body: { logoUrl: string }
 *
 * Re-classifies the URL, strips it, uploads to Supabase storage, and updates
 * every Sponsor.logoUrl AND every SponsorUser.coHostLogoUrl matching the
 * original URL. If a SponsorUser was updated, re-syncs to linked events.
 */
router.post('/apply', requireAuth, requireGraphicsAdminAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { logoUrl } = req.body || {};
    if (typeof logoUrl !== 'string' || !logoUrl) {
      throw new AppError('logoUrl is required', 400, 'VALIDATION_ERROR');
    }

    // Fetch + defensive re-classify
    const fetched = await fetchBuffer(logoUrl, PREVIEW_TIMEOUT_MS);
    if (!fetched) {
      throw new AppError('Failed to fetch source logo', 502, 'FETCH_FAILED');
    }
    const cls = await classifyLogo(fetched.buffer, fetched.contentType);
    if (cls !== 'white_bg_png' && cls !== 'jpeg_white') {
      throw new AppError(`Logo classification "${cls}" is not eligible for auto-strip`, 400, 'NOT_ELIGIBLE');
    }

    // Strip
    const stripped = await stripWhiteBackground(fetched.buffer);

    // Upload to Supabase storage
    const fileName = `sponsor-logos/${Date.now()}-cleanup-${crypto.randomBytes(4).toString('hex')}.png`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(fileName, stripped, {
        cacheControl: '3600',
        upsert: false,
        contentType: 'image/png',
      });
    if (uploadError) {
      console.error('Supabase upload failed:', uploadError);
      throw new AppError(`Storage upload failed: ${uploadError.message}`, 500, 'UPLOAD_FAILED');
    }

    const { data: urlData } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(fileName);
    const newUrl = urlData.publicUrl;
    if (!newUrl) {
      throw new AppError('Failed to get public URL for uploaded logo', 500, 'UPLOAD_NO_URL');
    }

    // Update Sponsor rows
    const sponsorUpdate = await prisma.sponsor.updateMany({
      where: { logoUrl },
      data: { logoUrl: newUrl },
    });

    // Update SponsorUser rows (master records) — there should be at most a small number
    const sponsorUsers = await prisma.sponsorUser.findMany({
      where: { coHostLogoUrl: logoUrl },
    });
    let sponsorUserUpdated = false;
    for (const su of sponsorUsers) {
      await prisma.sponsorUser.update({
        where: { id: su.id },
        data: { coHostLogoUrl: newUrl },
      });
      sponsorUserUpdated = true;

      // Re-sync partner data to linked Sponsor rows / co-host entries.
      // Re-fetch the updated record so the sync uses the new logoUrl.
      const updated = await prisma.sponsorUser.findUnique({ where: { id: su.id } });
      if (updated) {
        try {
          if (updated.autoCoHost) {
            await syncPartnerToAllEvents(updated as any);
          } else if (updated.autoSponsor) {
            await syncAutoSponsorsToAllEvents(updated as any);
          }
        } catch (err) {
          console.error('partnerSync failed after logo cleanup for SponsorUser', su.id, err);
          // Continue — the direct Sponsor.logoUrl updates above still applied.
        }
      }
    }

    invalidateAuditCache();

    res.json({
      newUrl,
      sponsorsUpdated: sponsorUpdate.count,
      sponsorUserUpdated,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
