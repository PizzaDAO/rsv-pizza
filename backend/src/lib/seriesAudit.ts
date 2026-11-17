/**
 * Append-only audit trail for event_series writes (`series_audit`, plans/wl-self-serve-brands.md
 * §2.1). Works with the root prisma client or a transaction client, so the audit row commits with
 * the change it describes.
 *
 * `changes` is `{field: {old, new}}` for the fields that actually changed; `snapshot` is the
 * pre-change brand-field snapshot (one-click revert later). Secrets are never recorded: the
 * pending-domain ownership token and the Resend domain id are not in the snapshot field list.
 */
import { Prisma } from '@prisma/client';

export type SeriesActorKind = 'super_admin' | 'series_admin' | 'system';

/** Fields included in `snapshot` / `changes`. Deliberately excludes secrets and server-only ids. */
export const AUDITED_SERIES_FIELDS = [
  'name', 'displayName', 'isActive', 'themeClass', 'logoUrl', 'ogImageUrl', 'flyerTemplateKey',
  'siteUrl', 'siteAliases', 'brandName', 'createFlow', 'nameTemplate', 'description', 'eventType',
  'publicTags', 'internalTags', 'requireApproval', 'hideGuests', 'photosEnabled', 'photosPublic',
  'eventDate', 'eventStartTime', 'eventEndTime', 'fundingWalletAddress',
  'emailFromAddress', 'emailFromName', 'emailReplyTo', 'emailDomain', 'emailDomainVerifiedAt',
  'tagline', 'metaDescription', 'supportEmail', 'faviconUrl', 'logoLightUrl', 'themeTokens', 'flyerArt',
] as const;

type Row = Record<string, unknown>;

/** JSON-safe copy (Dates become ISO strings) so diffs compare by value. */
function plain(v: unknown): unknown {
  return v === undefined ? null : JSON.parse(JSON.stringify(v));
}

/** Pick the audited fields from a series row. */
export function snapshotOf(row: Row): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of AUDITED_SERIES_FIELDS) if (k in row) out[k] = plain(row[k]);
  return out;
}

/** `{field: {old, new}}` for the audited fields whose value differs between the two rows. */
export function diffSeries(before: Row, after: Row): Record<string, { old: unknown; new: unknown }> {
  const out: Record<string, { old: unknown; new: unknown }> = {};
  for (const k of AUDITED_SERIES_FIELDS) {
    if (!(k in after) && !(k in before)) continue;
    const o = plain(before[k]);
    const n = plain(after[k]);
    if (JSON.stringify(o) !== JSON.stringify(n)) out[k] = { old: o, new: n };
  }
  return out;
}

interface AuditClient {
  seriesAudit: { create: (args: { data: Prisma.SeriesAuditUncheckedCreateInput }) => Promise<unknown> };
}

export async function writeSeriesAudit(
  db: AuditClient,
  entry: {
    seriesId: string;
    actorEmail: string;
    actorKind: SeriesActorKind;
    action: string;
    changes?: Record<string, unknown> | null;
    snapshot?: Record<string, unknown> | null;
  },
): Promise<void> {
  await db.seriesAudit.create({
    data: {
      seriesId: entry.seriesId,
      actorEmail: entry.actorEmail,
      actorKind: entry.actorKind,
      action: entry.action,
      changes: (entry.changes ?? undefined) as Prisma.InputJsonValue | undefined,
      snapshot: (entry.snapshot ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}
