/**
 * Brand-admin membership: super-admin invite / resend / revoke / list, and the invitee's accept
 * (plans/wl-self-serve-brands.md §2.1). Every mutation writes a `series_audit` row in the same
 * transaction. The raw invite token only ever exists in the invite email.
 */
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/error.js';
import { brandedSiteForParty } from './siteBrand.js';
import { sendBrandedEmail } from './resendSend.js';
import { writeSeriesAudit } from './seriesAudit.js';
import { newInviteToken, hashInviteToken, buildInviteEmail } from './seriesInvites.js';

export const SERIES_ADMIN_ROLES = ['owner', 'editor'] as const;

/** Public shape of a membership row: never the token hash. */
const ADMIN_SELECT = {
  id: true, seriesId: true, email: true, role: true, status: true, alertsEnabled: true,
  inviteExpiresAt: true, invitedBy: true, acceptedAt: true, revokedAt: true, revokedBy: true, createdAt: true,
} as const;

export async function listSeriesAdmins(seriesId: string) {
  return prisma.seriesAdmin.findMany({
    where: { seriesId },
    orderBy: [{ createdAt: 'asc' }],
    select: ADMIN_SELECT,
  });
}

/** Email the accept link from the series' own site. Returns false when it could not be sent (caller can resend). */
async function sendInvite(seriesId: string, email: string, token: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;
  const site = await brandedSiteForParty({ eventSeriesId: seriesId });
  if (!site) return false;
  const { subject, html } = buildInviteEmail({
    brandName: site.name,
    acceptUrl: `${site.url}/brand-admin/accept?token=${encodeURIComponent(token)}`,
  });
  try {
    const resp = await sendBrandedEmail({ site, apiKey, payload: { to: [email], subject, html } });
    if (!resp.ok) console.warn(`[series-invite] Resend ${resp.status} for series ${seriesId}`);
    return resp.ok;
  } catch (err: any) {
    console.warn('[series-invite] send failed:', err?.message || err);
    return false;
  }
}

/** A brand needs a live branded site (site_url set, active) to host the accept page. */
async function assertBrandedSite(seriesId: string) {
  const site = await brandedSiteForParty({ eventSeriesId: seriesId });
  if (!site) {
    throw new AppError('Set an active site URL on this series before inviting a brand admin', 400, 'VALIDATION_ERROR');
  }
}

export async function inviteSeriesAdmin(opts: {
  seriesId: string; email: string; role: string; actorEmail: string;
}) {
  const { seriesId, email, role, actorEmail } = opts;
  const series = await prisma.eventSeries.findUnique({ where: { id: seriesId }, select: { id: true } });
  if (!series) throw new AppError('Series not found', 404, 'NOT_FOUND');
  await assertBrandedSite(seriesId);

  const { token, hash, expiresAt } = newInviteToken();
  const admin = await prisma.$transaction(async (tx) => {
    const existing = await tx.seriesAdmin.findUnique({ where: { seriesId_email: { seriesId, email } }, select: { id: true, status: true } });
    if (existing?.status === 'active') throw new AppError('That person is already a brand admin', 409, 'DUPLICATE');
    const data = {
      role, status: 'invited', inviteTokenHash: hash, inviteExpiresAt: expiresAt, invitedBy: actorEmail,
      userId: null, acceptedAt: null, revokedAt: null, revokedBy: null,
    };
    const row = existing
      ? await tx.seriesAdmin.update({ where: { id: existing.id }, data, select: ADMIN_SELECT })
      : await tx.seriesAdmin.create({ data: { seriesId, email, ...data }, select: ADMIN_SELECT });
    await writeSeriesAudit(tx, {
      seriesId, actorEmail, actorKind: 'super_admin', action: 'admin.invite',
      changes: { email: { old: null, new: email }, role: { old: null, new: role } },
    });
    return row;
  });
  const emailSent = await sendInvite(seriesId, email, token);
  return { admin, emailSent };
}

/** Fresh token for a still-pending invite (the old one stops working). */
export async function resendSeriesInvite(opts: { seriesId: string; adminId: string; actorEmail: string }) {
  const { seriesId, adminId, actorEmail } = opts;
  await assertBrandedSite(seriesId);
  const { token, hash, expiresAt } = newInviteToken();
  const admin = await prisma.$transaction(async (tx) => {
    // Scoped to the series: an id from another series is a 404.
    const res = await tx.seriesAdmin.updateMany({
      where: { id: adminId, seriesId, status: 'invited' },
      data: { inviteTokenHash: hash, inviteExpiresAt: expiresAt, invitedBy: actorEmail },
    });
    if (res.count === 0) throw new AppError('Pending invite not found', 404, 'NOT_FOUND');
    const row = await tx.seriesAdmin.findFirst({ where: { id: adminId, seriesId }, select: ADMIN_SELECT });
    if (!row) throw new AppError('Pending invite not found', 404, 'NOT_FOUND');
    await writeSeriesAudit(tx, {
      seriesId, actorEmail, actorKind: 'super_admin', action: 'admin.resend',
      changes: { email: { old: row.email, new: row.email } },
    });
    return row;
  });
  const emailSent = await sendInvite(seriesId, admin.email, token);
  return { admin, emailSent };
}

export async function revokeSeriesAdmin(opts: { seriesId: string; adminId: string; actorEmail: string }) {
  const { seriesId, adminId, actorEmail } = opts;
  return prisma.$transaction(async (tx) => {
    const before = await tx.seriesAdmin.findFirst({ where: { id: adminId, seriesId }, select: { id: true, email: true, status: true } });
    if (!before) throw new AppError('Brand admin not found', 404, 'NOT_FOUND');
    if (before.status === 'revoked') throw new AppError('Already revoked', 409, 'CONFLICT');
    const res = await tx.seriesAdmin.updateMany({
      where: { id: adminId, seriesId },
      data: { status: 'revoked', revokedAt: new Date(), revokedBy: actorEmail, inviteTokenHash: null, inviteExpiresAt: null },
    });
    if (res.count === 0) throw new AppError('Brand admin not found', 404, 'NOT_FOUND');
    await writeSeriesAudit(tx, {
      seriesId, actorEmail, actorKind: 'super_admin', action: 'admin.revoke',
      changes: { email: { old: before.email, new: before.email }, status: { old: before.status, new: 'revoked' } },
    });
    return tx.seriesAdmin.findFirst({ where: { id: adminId, seriesId }, select: ADMIN_SELECT });
  });
}

/** Toggle new-event alerts. `actor` is the member themself (series_admin) or a super-admin. */
export async function setSeriesAdminAlerts(opts: {
  seriesId: string; adminId?: string; email?: string; alertsEnabled: boolean;
  actorEmail: string; actorKind: 'super_admin' | 'series_admin';
}) {
  const { seriesId, adminId, email, alertsEnabled, actorEmail, actorKind } = opts;
  return prisma.$transaction(async (tx) => {
    const where = { seriesId, ...(adminId ? { id: adminId } : { email: email! }), status: { in: ['active', 'invited'] } };
    const before = await tx.seriesAdmin.findFirst({ where, select: { id: true, email: true, alertsEnabled: true } });
    if (!before) throw new AppError('Brand admin not found', 404, 'NOT_FOUND');
    await tx.seriesAdmin.updateMany({ where: { id: before.id, seriesId }, data: { alertsEnabled } });
    await writeSeriesAudit(tx, {
      seriesId, actorEmail, actorKind, action: 'admin.alerts',
      changes: { email: { old: before.email, new: before.email }, alertsEnabled: { old: before.alertsEnabled, new: alertsEnabled } },
    });
    return tx.seriesAdmin.findFirst({ where: { id: before.id, seriesId }, select: ADMIN_SELECT });
  });
}

export type AcceptResult = { seriesId: string };

/**
 * Accept an invite as the signed-in user. Only an `invited`, unexpired row whose email equals the
 * caller's passes, and the consume is one conditional UPDATE, so a token works exactly once even
 * under concurrent requests. A wrong-email caller does NOT consume the invite.
 */
export async function acceptSeriesInvite(opts: { token: string; userId: string; userEmail: string }): Promise<AcceptResult> {
  const hash = hashInviteToken(opts.token);
  const email = opts.userEmail.toLowerCase();
  return prisma.$transaction(async (tx) => {
    const row = await tx.seriesAdmin.findFirst({
      where: { inviteTokenHash: hash, status: 'invited', inviteExpiresAt: { gt: new Date() } },
      select: { id: true, seriesId: true, email: true },
    });
    if (!row) throw new AppError('This invite link is invalid or has expired', 400, 'INVALID_INVITE');
    if (row.email.toLowerCase() !== email) {
      throw new AppError('This invite is for a different email address. Sign in with the invited email.', 403, 'INVITE_EMAIL_MISMATCH');
    }
    const res = await tx.seriesAdmin.updateMany({
      where: { id: row.id, inviteTokenHash: hash, status: 'invited', inviteExpiresAt: { gt: new Date() } },
      data: { status: 'active', userId: opts.userId, acceptedAt: new Date(), inviteTokenHash: null, inviteExpiresAt: null },
    });
    if (res.count !== 1) throw new AppError('This invite link is invalid or has expired', 400, 'INVALID_INVITE');
    await writeSeriesAudit(tx, {
      seriesId: row.seriesId, actorEmail: email, actorKind: 'series_admin', action: 'admin.accept',
      changes: { email: { old: row.email, new: row.email }, status: { old: 'invited', new: 'active' } },
    });
    return { seriesId: row.seriesId };
  });
}
