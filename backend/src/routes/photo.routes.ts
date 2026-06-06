import { Router, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { requireAuth, optionalAuth, isSuperAdmin, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { canUserEditParty, canUserAccessTab } from '../helpers/partyAccess.js';
import { autoCompleteScorecardItem } from './scorecard.routes.js';
import { getOperationalLimits } from '../lib/privateConfig.js';

const router = Router();

// GET /api/parties/:partyId/photos - List all photos for a party (public if photosPublic is true)
//
// napoletana-58210: the response is a UNION of two sources — the curated
// `photos` table (existing behaviour) and uncurated payout pizza photos
// (`payout_documents` where kind='pizza' and the parent payout is not
// 'rejected'). Each item carries a `source` discriminator + `payoutId` so the
// frontend can dispatch vote calls to the right endpoint. Source-incompatible
// filters (starred, tag, uploadedBy, non-default status) collapse the
// response to the photos table for v1 — payout docs have no analog for
// any of those concepts.
router.get('/:partyId/photos', optionalAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const { starred, tag, uploadedBy, limit = '50', offset = '0', status } = req.query;

    // Get party to check if photos are public
    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: { id: true, photosEnabled: true, photosPublic: true, userId: true, photoModeration: true },
    });

    if (!party) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    if (!party.photosEnabled) {
      throw new AppError('Photos are not enabled for this party', 403, 'PHOTOS_DISABLED');
    }

    // If photos are not public, require authentication and ownership
    if (!party.photosPublic) {
      const canAccess = await canUserEditParty(partyId, req.userId, req.userEmail);
      if (!canAccess) {
        throw new AppError('Photos are private', 403, 'PHOTOS_PRIVATE');
      }
    }

    // Build query filters
    const where: any = { partyId };

    if (starred === 'true') {
      where.starred = true;
    }

    if (tag && typeof tag === 'string') {
      where.tags = { has: tag };
    }

    if (uploadedBy && typeof uploadedBy === 'string') {
      where.uploadedBy = uploadedBy;
    }

    // Status filtering: guests see only approved, hosts can filter
    const statusFilter = status as string | undefined;
    if (statusFilter === 'pending' || statusFilter === 'rejected') {
      // Only hosts can see non-approved photos
      const canAccess = await canUserEditParty(partyId, req.userId, req.userEmail);
      if (canAccess) {
        where.status = statusFilter;
      } else {
        where.status = 'approved';
      }
    } else if (statusFilter === 'all') {
      const canAccess = await canUserEditParty(partyId, req.userId, req.userEmail);
      if (!canAccess) {
        where.status = 'approved';
      }
      // else: no status filter = show all for hosts
    } else {
      // Default: only show approved photos
      where.status = 'approved';
    }

    // provolone-58931: soft-delete visibility. By default exclude soft-deleted
    // photos from EVERY caller. Super-admins are the only exception — they get
    // deleted rows too (carrying deletedAt) so the gallery can render them
    // greyed with a Restore action.
    const viewerIsSuperAdmin = await isSuperAdmin(req.userEmail);
    if (!viewerIsSuperAdmin) {
      where.deletedAt = null;
    }

    // napoletana-58210: payout pizza photos are included ONLY when the request
    // has no filters that would otherwise exclude them (starred/tag/uploadedBy
    // don't exist on payout docs; non-default status filters target moderation
    // states that don't apply either). Default unfiltered = both sources.
    const includePayoutDocs =
      !starred &&
      !tag &&
      !uploadedBy &&
      (!statusFilter || statusFilter === 'approved');

    const photoLimit = Math.min(parseInt(limit as string, 10), 100);
    const photoOffset = parseInt(offset as string, 10);

    const photoSelect = {
      guest: { select: { id: true, name: true } },
      // salame-58195: include current user's vote (if any) so the client can
      // render votedByMe without an extra round-trip.
      votes: req.userId
        ? { where: { userId: req.userId }, select: { id: true } }
        : false,
    } as const;

    if (!includePayoutDocs) {
      // Original behaviour — single-source response.
      const photos = await prisma.photo.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: photoLimit,
        skip: photoOffset,
        include: photoSelect,
      });

      const total = await prisma.photo.count({ where });

      const photosWithVote = photos.map((p) => {
        const { votes, ...rest } = p as typeof p & { votes?: { id: string }[] };
        return {
          ...rest,
          source: 'photo' as const,
          payoutId: null,
          votedByMe: req.userId ? (votes?.length ?? 0) > 0 : false,
        };
      });

      return res.json({
        photos: photosWithVote,
        total,
        limit: photoLimit,
        offset: photoOffset,
      });
    }

    // UNION mode: pull both sources, merge, sort, then paginate.
    // We fetch up to (limit + offset) from each source (capped) so the merged
    // window can serve the requested page deterministically; counts come from
    // separate count queries.
    const fetchCap = Math.min(photoLimit + photoOffset, 200);

    const [photos, payoutDocs, photoTotal, payoutTotal] = await Promise.all([
      prisma.photo.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: fetchCap,
        include: photoSelect,
      }),
      prisma.payoutDocument.findMany({
        where: {
          partyId,
          kind: 'pizza',
          // napoletana-58211: exclude docs already mirrored into the
          // `photos` table — they're returned on the photo side of this
          // UNION. New uploads create both rows atomically; backfill links
          // existing rows.
          photoId: null,
          OR: [
            { payoutId: null },
            { payout: { isNot: { status: 'rejected' } } },
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: fetchCap,
        select: {
          id: true,
          partyId: true,
          url: true,
          fileName: true,
          fileSize: true,
          mimeType: true,
          payoutId: true,
          createdAt: true,
          voteCount: true,
          votes: req.userId
            ? { where: { userId: req.userId }, select: { id: true } }
            : false,
        },
      }),
      prisma.photo.count({ where }),
      prisma.payoutDocument.count({
        where: {
          partyId,
          kind: 'pizza',
          // napoletana-58211: exclude docs already mirrored into the
          // `photos` table — they're returned on the photo side of this
          // UNION. New uploads create both rows atomically; backfill links
          // existing rows.
          photoId: null,
          OR: [
            { payoutId: null },
            { payout: { isNot: { status: 'rejected' } } },
          ],
        },
      }),
    ]);

    // Shape both into a common payload. Photo-sourced rows preserve the
    // existing shape (so the frontend Photo type still applies); payout-sourced
    // rows fill in null/defaults for the photo-only fields.
    type Merged = {
      id: string;
      partyId: string;
      url: string;
      thumbnailUrl: string | null;
      fileName: string;
      fileSize: number;
      mimeType: string;
      width: number | null;
      height: number | null;
      uploadedBy: string | null;
      uploaderName: string | null;
      uploaderEmail: string | null;
      caption: string | null;
      tags: string[];
      photoYear: number | null;
      starred: boolean;
      starredAt: Date | null;
      status: string;
      reviewedAt: Date | null;
      reviewedBy: string | null;
      duration: number | null;
      voteCount: number;
      votedByMe: boolean;
      createdAt: Date;
      updatedAt: Date;
      guest: { id: string; name: string | null } | null;
      source: 'photo' | 'payout';
      payoutId: string | null;
      // porchetta-58296: surfaced so the payout form can hydrate its role slots.
      // Declared explicitly (not just carried by ...rest) so a future `select:`
      // on the photos query can't silently drop this gate-critical field.
      payoutRole: string | null;
    };

    const merged: Merged[] = [
      ...photos.map((p): Merged => {
        const { votes, guest, ...rest } = p as typeof p & {
          votes?: { id: string }[];
          guest?: { id: string; name: string | null } | null;
        };
        return {
          ...rest,
          guest: guest ?? null,
          source: 'photo',
          payoutId: null,
          payoutRole: rest.payoutRole ?? null,
          votedByMe: req.userId ? (votes?.length ?? 0) > 0 : false,
        };
      }),
      ...payoutDocs.map((pd): Merged => {
        const votes = (pd as typeof pd & { votes?: { id: string }[] }).votes;
        return {
          id: pd.id,
          partyId: pd.partyId,
          url: pd.url,
          thumbnailUrl: null,
          fileName: pd.fileName,
          fileSize: pd.fileSize,
          mimeType: pd.mimeType,
          width: null,
          height: null,
          uploadedBy: null,
          uploaderName: null,
          uploaderEmail: null,
          caption: null,
          tags: [],
          photoYear: null,
          // Payout pizza photos are auto-approved + auto-starred so they look
          // like the host curated them.
          starred: true,
          starredAt: pd.createdAt,
          status: 'approved',
          reviewedAt: null,
          reviewedBy: null,
          duration: null,
          voteCount: pd.voteCount,
          votedByMe: req.userId ? (votes?.length ?? 0) > 0 : false,
          createdAt: pd.createdAt,
          // PayoutDocument has no updatedAt — fall back to createdAt for shape parity.
          updatedAt: pd.createdAt,
          guest: null,
          source: 'payout',
          payoutId: pd.payoutId,
          // Payout-sourced rows never carry a gallery role designation.
          payoutRole: null,
        };
      }),
    ];

    merged.sort((a, b) => {
      const tDiff = b.createdAt.getTime() - a.createdAt.getTime();
      if (tDiff !== 0) return tDiff;
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
    });

    const pageStart = photoOffset;
    const pageEnd = pageStart + photoLimit;
    const page = merged.slice(pageStart, pageEnd);

    res.json({
      photos: page,
      total: photoTotal + payoutTotal,
      limit: photoLimit,
      offset: photoOffset,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/parties/:partyId/photos/tags - Get available tags for photos
// NOTE: This route MUST be defined before /:partyId/photos/:photoId to avoid "tags" being matched as photoId
router.get('/:partyId/photos/tags', optionalAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;

    // Get party to check existence
    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: { id: true, photosEnabled: true },
    });

    if (!party) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // Static default tags
    const defaultTags = ['Pizza', 'Box Tower', 'Group Photo'];

    // Dynamic sponsor tags: confirmed sponsors (status in yes, billed, paid)
    const sponsors = await prisma.sponsor.findMany({
      where: {
        partyId,
        status: { in: ['yes', 'billed', 'paid'] },
      },
      select: { name: true },
      orderBy: { name: 'asc' },
    });

    const sponsorTags = sponsors.map(s => s.name);

    // Combined tags list (defaults first, then sponsors)
    const tags = [...defaultTags, ...sponsorTags];

    res.json({ tags, defaultTags, sponsorTags });
  } catch (error) {
    next(error);
  }
});

// GET /api/parties/:partyId/photos/stats - Get photo statistics for a party
// NOTE: This route MUST be defined before /:partyId/photos/:photoId to avoid "stats" being matched as photoId
router.get('/:partyId/photos/stats', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;

    // Get party to check existence
    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: { id: true, photosEnabled: true },
    });

    if (!party) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // provolone-58931: stats always exclude soft-deleted photos (even for
    // super-admins — deleted items shouldn't inflate the displayed counts).
    const totalPhotos = await prisma.photo.count({ where: { partyId, status: 'approved', deletedAt: null } });
    const starredPhotos = await prisma.photo.count({ where: { partyId, starred: true, status: 'approved', deletedAt: null } });
    const pendingPhotos = await prisma.photo.count({ where: { partyId, status: 'pending', deletedAt: null } });

    // Get unique tags
    const photos = await prisma.photo.findMany({
      where: { partyId, deletedAt: null },
      select: { tags: true },
    });
    const allTags = photos.flatMap(p => p.tags);
    const uniqueTags = [...new Set(allTags)];

    // Get unique uploaders count
    const uniqueUploaders = await prisma.photo.groupBy({
      by: ['uploaderEmail'],
      where: { partyId, uploaderEmail: { not: null }, deletedAt: null },
    });

    res.json({
      totalPhotos,
      starredPhotos,
      pendingPhotos,
      uniqueTags,
      uniqueUploadersCount: uniqueUploaders.length,
      photosEnabled: party.photosEnabled,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:partyId/photos/batch-review - Batch approve/reject photos (host only)
// NOTE: This route MUST be defined before /:partyId/photos/:photoId to avoid "batch-review" being matched as photoId
router.post('/:partyId/photos/batch-review', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const { photoIds, status } = req.body;

    // Validate input
    if (!photoIds || !Array.isArray(photoIds) || photoIds.length === 0) {
      throw new AppError('photoIds must be a non-empty array', 400, 'VALIDATION_ERROR');
    }

    if (!['approved', 'rejected'].includes(status)) {
      throw new AppError('status must be "approved" or "rejected"', 400, 'VALIDATION_ERROR');
    }

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Verify co-host has access to photos tab
    const canAccessPhotos = await canUserAccessTab(partyId, req.userEmail, req.userId, 'photos');
    if (!canAccessPhotos) {
      throw new AppError('You do not have access to the photos tab', 403, 'TAB_ACCESS_DENIED');
    }

    const result = await prisma.photo.updateMany({
      where: {
        id: { in: photoIds },
        partyId,
        deletedAt: null, // provolone-58931: never re-review soft-deleted photos
      },
      data: {
        status,
        reviewedAt: new Date(),
        reviewedBy: req.userId || null,
      },
    });

    res.json({ updated: result.count });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:partyId/photos - Upload a new photo (requires guest identity or auth)
router.post('/:partyId/photos', optionalAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const {
      url,
      thumbnailUrl,
      fileName,
      fileSize,
      mimeType,
      width,
      height,
      uploaderName,
      uploaderEmail,
      guestId,
      caption,
      tags,
      photoYear,
      duration,
    } = req.body;

    // Validate required fields
    if (!url || !fileName || !fileSize || !mimeType) {
      throw new AppError('Missing required fields: url, fileName, fileSize, mimeType', 400, 'VALIDATION_ERROR');
    }

    // Get party to check if photos are enabled and moderation setting
    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: { id: true, photosEnabled: true, photoModeration: true, cancelledAt: true },
    });

    if (!party) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // porchetta-81402: cancelled events are read-only.
    if (party.cancelledAt) {
      throw new AppError('This event has been cancelled', 410, 'EVENT_CANCELLED');
    }

    if (!party.photosEnabled) {
      throw new AppError('Photos are not enabled for this party', 403, 'PHOTOS_DISABLED');
    }

    // Validate MIME type (images + videos)
    const allowedImageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'image/avif'];
    const allowedVideoTypes = ['video/mp4', 'video/webm', 'video/quicktime'];
    const allowedMimeTypes = [...allowedImageTypes, ...allowedVideoTypes];
    if (!allowedMimeTypes.includes(mimeType)) {
      throw new AppError('Invalid file type. Allowed: jpeg, png, webp, gif, heic, heif, avif, mp4, webm, mov', 400, 'INVALID_FILE_TYPE');
    }

    const isVideo = allowedVideoTypes.includes(mimeType);

    // Validate file size: 25MB for images, 50MB for videos
    const maxSize = isVideo ? 50 * 1024 * 1024 : 25 * 1024 * 1024;
    if (fileSize > maxSize) {
      throw new AppError(
        isVideo ? 'File too large. Maximum video size is 50MB' : 'File too large. Maximum size is 25MB',
        400,
        'FILE_TOO_LARGE'
      );
    }

    // Validate video duration (5 minutes max)
    if (isVideo && duration !== undefined && duration !== null) {
      if (typeof duration !== 'number' || duration <= 0) {
        throw new AppError('Invalid duration', 400, 'VALIDATION_ERROR');
      }
      if (duration > 300) {
        throw new AppError('Video too long. Maximum duration is 5 minutes', 400, 'VIDEO_TOO_LONG');
      }
    }

    // If guestId provided, verify it belongs to this party
    let verifiedGuestId: string | null = null;
    if (guestId) {
      const guest = await prisma.guest.findFirst({
        where: { id: guestId, partyId },
      });
      if (guest) {
        verifiedGuestId = guest.id;
      }
    }

    // Validate photoYear if provided
    if (photoYear !== undefined && photoYear !== null) {
      const year = parseInt(photoYear, 10);
      const currentYear = new Date().getFullYear();
      if (isNaN(year) || year < 1900 || year > currentYear + 1) {
        throw new AppError(`photoYear must be between 1900 and ${currentYear + 1}`, 400, 'VALIDATION_ERROR');
      }
    }

    // sicilian-58196: dedup pre-check. If a photo already exists in this party
    // with identical (fileSize, mimeType), return the original instead of
    // creating a duplicate row. Returns 200 (not 201) with `deduped: true` so
    // the client can render a soft "already uploaded" hint. Skipped if either
    // fileSize or mimeType is missing — those are required by the validation
    // above, but be defensive. The original photo keeps its existing
    // starred / status / votes; we do NOT replay host-auto-star or
    // auto-approve on the dedup hit.
    if (fileSize && mimeType) {
      const existing = await prisma.photo.findFirst({
        where: { partyId, fileSize, mimeType, deletedAt: null }, // provolone-58931: a deleted dup shouldn't block a fresh re-upload
        select: { id: true },
      });
      if (existing) {
        const dedupedPhoto = await prisma.photo.findUnique({
          where: { id: existing.id },
          include: { guest: { select: { id: true, name: true } } },
        });
        return res.status(200).json({ photo: dedupedPhoto, deduped: true });
      }
    }

    // nduja-58296: per-user photo cap per event. Identify the uploader by
    // userId, guestId, or lowercased email — any match counts. Pending +
    // approved count; rejected photos do not (so a host can clean up bad
    // uploads to make room). If we can't identify the uploader at all, skip
    // the check rather than reject an otherwise valid upload.
    //
    // marinara-71630 P8: the cap is a tunable operational quota resolved from
    // config (fallback = current value 30) so it can be overridden without a
    // deploy. The enforced value AND the user-facing error copy are both driven
    // from this single resolved number so they can never drift.
    const photoLimitPerUserPerEvent = (await getOperationalLimits()).photoPerUserPerEvent;
    const uploaderUserId = req.userId || null;
    const uploaderGuestId = verifiedGuestId || null;
    const uploaderEmailLower = (uploaderEmail || '').toLowerCase() || null;

    const uploaderClauses: Prisma.PhotoWhereInput[] = [];
    if (uploaderUserId) uploaderClauses.push({ reviewedBy: uploaderUserId });
    if (uploaderGuestId) uploaderClauses.push({ uploadedBy: uploaderGuestId });
    if (uploaderEmailLower) uploaderClauses.push({ uploaderEmail: uploaderEmailLower });

    if (uploaderClauses.length > 0) {
      const existingCount = await prisma.photo.count({
        where: {
          partyId,
          status: { not: 'rejected' },
          deletedAt: null, // provolone-58931: deleted photos free up room under the cap
          OR: uploaderClauses,
        },
      });
      if (existingCount >= photoLimitPerUserPerEvent) {
        throw new AppError(
          `${photoLimitPerUserPerEvent} photo limit per user. Remove photos to make room`,
          400,
          'PHOTO_LIMIT_REACHED'
        );
      }
    }

    // margherita-43821: host uploads (owner / co-host w/ canEdit / super-admin /
    // GPP editor) are auto-approved + auto-starred so they appear in /photos
    // immediately. Guest uploads still go through pending moderation.
    const isHostUpload = await canUserEditParty(partyId, req.userId, req.userEmail);
    const initialStatus = isHostUpload ? 'approved' : 'pending';
    const initialStarred = isHostUpload ? true : false;
    const now = new Date();

    const photo = await prisma.photo.create({
      data: {
        partyId,
        url,
        thumbnailUrl: thumbnailUrl || null,
        fileName,
        fileSize,
        mimeType,
        width: width || null,
        height: height || null,
        uploadedBy: verifiedGuestId,
        uploaderName: uploaderName || null,
        uploaderEmail: uploaderEmail?.toLowerCase() || null,
        caption: caption || null,
        tags: tags || [],
        photoYear: photoYear ? parseInt(photoYear, 10) : null,
        duration: isVideo && duration ? duration : null,
        status: initialStatus,
        starred: initialStarred,
        starredAt: initialStarred ? now : null,
        reviewedAt: isHostUpload ? now : null,
        reviewedBy: isHostUpload ? (req.userId || null) : null,
      },
      include: {
        guest: { select: { id: true, name: true } },
      },
    });

    // Auto-complete scorecard items for photo uploads
    if (verifiedGuestId) {
      // Auto-complete "photo" item
      autoCompleteScorecardItem(verifiedGuestId, partyId, 'photo', photo.id, 'photo_id');

      // If tagged "pizza-selfie", auto-complete that too
      const photoTags = (tags || []) as string[];
      if (photoTags.some((t: string) => t.toLowerCase() === 'pizza-selfie' || t.toLowerCase() === 'pizza selfie')) {
        autoCompleteScorecardItem(verifiedGuestId, partyId, 'pizza_selfie', photo.id, 'photo_id');
      }
    }

    res.status(201).json({ photo });
  } catch (error) {
    next(error);
  }
});

// GET /api/parties/:partyId/photos/:photoId - Get single photo details
router.get('/:partyId/photos/:photoId', optionalAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, photoId } = req.params;

    // Get party to check if photos are public
    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: { id: true, photosEnabled: true, photosPublic: true, userId: true },
    });

    if (!party) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    if (!party.photosEnabled) {
      throw new AppError('Photos are not enabled for this party', 403, 'PHOTOS_DISABLED');
    }

    // If photos are not public, require authentication and ownership
    if (!party.photosPublic) {
      const canAccess = await canUserEditParty(partyId, req.userId, req.userEmail);
      if (!canAccess) {
        throw new AppError('Photos are private', 403, 'PHOTOS_PRIVATE');
      }
    }

    // provolone-58931: hide soft-deleted photos from everyone except super-admins.
    const viewerIsSuperAdmin = await isSuperAdmin(req.userEmail);
    const photo = await prisma.photo.findFirst({
      where: { id: photoId, partyId, ...(viewerIsSuperAdmin ? {} : { deletedAt: null }) },
      include: {
        guest: { select: { id: true, name: true } },
        // salame-58195
        votes: req.userId
          ? { where: { userId: req.userId }, select: { id: true } }
          : false,
      },
    });

    if (!photo) {
      throw new AppError('Photo not found', 404, 'NOT_FOUND');
    }

    const { votes, ...rest } = photo as typeof photo & { votes?: { id: string }[] };
    const photoWithVote = {
      ...rest,
      votedByMe: req.userId ? (votes?.length ?? 0) > 0 : false,
    };

    res.json({ photo: photoWithVote });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/parties/:partyId/photos/:photoId - Update photo (host only)
router.patch('/:partyId/photos/:photoId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, photoId } = req.params;
    const { caption, tags, starred, status, photoYear, payoutRole } = req.body;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Verify co-host has access to photos tab
    const canAccessPhotosTab = await canUserAccessTab(partyId, req.userEmail, req.userId, 'photos');
    if (!canAccessPhotosTab) {
      throw new AppError('You do not have access to the photos tab', 403, 'TAB_ACCESS_DENIED');
    }

    // Check if photo exists. provolone-58931: soft-deleted photos can't be
    // edited via PATCH — they must be restored first.
    const existingPhoto = await prisma.photo.findFirst({
      where: { id: photoId, partyId, deletedAt: null },
    });

    if (!existingPhoto) {
      throw new AppError('Photo not found', 404, 'NOT_FOUND');
    }

    // Validate photoYear if provided (allow null to clear)
    if (photoYear !== undefined && photoYear !== null) {
      const year = parseInt(photoYear, 10);
      const currentYear = new Date().getFullYear();
      if (isNaN(year) || year < 1900 || year > currentYear + 1) {
        throw new AppError(`photoYear must be between 1900 and ${currentYear + 1}`, 400, 'VALIDATION_ERROR');
      }
    }

    // porchetta-58296: host-designated payout role. Accept
    // 'group' | 'box_stack' | 'pizza' (set) or null (clear). Validate the enum,
    // reject pre-event-start photos, and enforce one photo per role per event
    // (clear the prior holder in the same transaction as the set).
    const PAYOUT_ROLES = ['group', 'box_stack', 'pizza'] as const;
    type PayoutRole = (typeof PAYOUT_ROLES)[number];
    let validatedPayoutRole: PayoutRole | null | undefined;
    if (payoutRole !== undefined) {
      if (payoutRole === null) {
        validatedPayoutRole = null;
      } else if (typeof payoutRole === 'string' && (PAYOUT_ROLES as readonly string[]).includes(payoutRole)) {
        validatedPayoutRole = payoutRole as PayoutRole;
      } else {
        throw new AppError(
          `payoutRole must be one of: ${PAYOUT_ROLES.join(', ')}, or null`,
          400,
          'VALIDATION_ERROR',
        );
      }
    }

    // porchetta-58296: when assigning a role, the photo must be dated after the
    // event's start (reuse the photo-feed cutoff: party.date NULL ⇒ no cutoff).
    if (validatedPayoutRole) {
      const party = await prisma.party.findUnique({
        where: { id: partyId },
        select: { date: true },
      });
      if (party?.date && existingPhoto.createdAt < party.date) {
        throw new AppError(
          'This photo was taken before the event started and cannot be designated.',
          400,
          'PHOTO_BEFORE_EVENT_START',
        );
      }
    }

    // porchetta-58296: human gallery tag mirrored onto the photo when a role is
    // assigned, so it also shows under that filter in the gallery.
    const ROLE_TO_TAG: Record<PayoutRole, string> = {
      group: 'Group Photo',
      box_stack: 'Box Tower',
      pizza: 'Pizza',
    };

    const photo = await prisma.$transaction(async (tx) => {
      // porchetta-58296: enforce one photo per role per event. Clear the role
      // from any OTHER photo on this party before setting it here (belt-and-
      // braces with the partial unique index).
      if (validatedPayoutRole) {
        await tx.photo.updateMany({
          where: {
            partyId,
            payoutRole: validatedPayoutRole,
            id: { not: photoId },
            deletedAt: null,
          },
          data: { payoutRole: null, payoutRoleSetAt: null, payoutRoleSetBy: null },
        });
      }

      const nextTags =
        validatedPayoutRole
          ? Array.from(new Set([...(existingPhoto.tags ?? []), ROLE_TO_TAG[validatedPayoutRole]]))
          : undefined;

      return tx.photo.update({
        where: { id: photoId },
        data: {
          ...(caption !== undefined && { caption }),
          ...(tags !== undefined && { tags }),
          ...(photoYear !== undefined && { photoYear: photoYear === null ? null : parseInt(photoYear, 10) }),
          ...(starred !== undefined && {
            starred,
            starredAt: starred ? new Date() : null,
          }),
          ...(status !== undefined && ['approved', 'rejected', 'pending'].includes(status) && {
            status,
            reviewedAt: new Date(),
            reviewedBy: req.userId || null,
          }),
          ...(validatedPayoutRole !== undefined && {
            payoutRole: validatedPayoutRole,
            payoutRoleSetAt: validatedPayoutRole ? new Date() : null,
            payoutRoleSetBy: validatedPayoutRole ? (req.userId || null) : null,
            // Only append the human tag when assigning (not when clearing) and
            // only if the caller didn't explicitly set `tags` in this request.
            ...(nextTags !== undefined && tags === undefined && { tags: nextTags }),
          }),
        },
        include: {
          guest: { select: { id: true, name: true } },
        },
      });
    });

    res.json({ photo });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/parties/:partyId/photos/:photoId - Delete a photo (host or authenticated uploader)
router.delete('/:partyId/photos/:photoId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, photoId } = req.params;

    // Get the photo first. provolone-58931: a soft-deleted photo is treated as
    // gone for the delete path (idempotent — already deleted = not found).
    const photo = await prisma.photo.findFirst({
      where: { id: photoId, partyId, deletedAt: null },
    });

    if (!photo) {
      throw new AppError('Photo not found', 404, 'NOT_FOUND');
    }

    // Check if user can delete:
    // 1. Party host/owner can delete any photo (if they have photos tab access)
    // 2. Authenticated user whose email matches the uploader can delete their own photo
    const isHost = await canUserEditParty(partyId, req.userId, req.userEmail);
    const isUploader = req.userEmail &&
      photo.uploaderEmail &&
      photo.uploaderEmail.toLowerCase() === req.userEmail.toLowerCase();

    if (!isHost && !isUploader) {
      throw new AppError('Unauthorized to delete this photo', 403, 'UNAUTHORIZED');
    }

    // If acting as host (not just uploader), verify co-host has access to photos tab
    if (isHost && !isUploader) {
      const canAccessPhotosForDelete = await canUserAccessTab(partyId, req.userEmail, req.userId, 'photos');
      if (!canAccessPhotosForDelete) {
        throw new AppError('You do not have access to the photos tab', 403, 'TAB_ACCESS_DENIED');
      }
    }

    // provolone-58931: soft delete instead of a hard delete so super-admins can
    // still see (and restore) host/uploader-deleted photos.
    await prisma.photo.update({
      where: { id: photoId },
      data: { deletedAt: new Date() },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:partyId/photos/:photoId/restore - Restore a soft-deleted
// photo (super-admin only). provolone-58931.
router.post('/:partyId/photos/:photoId/restore', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { photoId } = req.params;

    if (!(await isSuperAdmin(req.userEmail))) {
      throw new AppError('Forbidden', 403, 'FORBIDDEN');
    }

    await prisma.photo.update({
      where: { id: photoId },
      data: { deletedAt: null },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// salame-58195: POST /api/parties/:partyId/photos/:photoId/vote
// Toggle the current user's thumbs-up on a photo. Requires auth.
// Returns { voted: boolean, voteCount: number }.
router.post('/:partyId/photos/:photoId/vote', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, photoId } = req.params;
    const userId = req.userId;
    if (!userId) {
      throw new AppError('Auth required', 401, 'UNAUTHORIZED');
    }

    // Verify the photo exists and belongs to this party.
    // provolone-58931: can't vote on a soft-deleted photo.
    const photo = await prisma.photo.findFirst({
      where: { id: photoId, partyId, deletedAt: null },
      select: { id: true },
    });
    if (!photo) {
      throw new AppError('Photo not found', 404, 'NOT_FOUND');
    }

    const existing = await prisma.photoVote.findUnique({
      where: { photoId_userId: { photoId, userId } },
      select: { id: true },
    });

    if (existing) {
      // Toggle off
      const [, updated] = await prisma.$transaction([
        prisma.photoVote.delete({
          where: { photoId_userId: { photoId, userId } },
        }),
        prisma.photo.update({
          where: { id: photoId },
          data: { voteCount: { decrement: 1 } },
          select: { voteCount: true },
        }),
      ]);
      // Guard against negative drift (shouldn't happen, but safe).
      const voteCount = Math.max(0, updated.voteCount);
      return res.json({ voted: false, voteCount });
    }

    // Toggle on
    const [, updated] = await prisma.$transaction([
      prisma.photoVote.create({
        data: { photoId, userId },
      }),
      prisma.photo.update({
        where: { id: photoId },
        data: { voteCount: { increment: 1 } },
        select: { voteCount: true },
      }),
    ]);
    return res.json({ voted: true, voteCount: updated.voteCount });
  } catch (error) {
    next(error);
  }
});

export default router;
