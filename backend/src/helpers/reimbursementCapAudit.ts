// fennel-49102: write-side helper for the reimbursement_cap_audit table.
//
// Mirrors backend/src/helpers/statusAudit.ts. Always call recordCapChange
// AFTER the cap-bearing UPDATE has committed (the PATCH /:id handler does
// the update outside an interactive transaction). Logging is best-effort:
// if the audit insert throws, we log and swallow so we never roll back a
// successful cap edit on the audit-table's behalf.
import { prisma } from '../config/database.js';
import { Decimal } from '@prisma/client/runtime/library';
import { isSuperAdmin, isUnderboss } from '../middleware/auth.js';

export type CapActorKind =
  | 'super_admin'
  | 'admin'
  | 'payment_admin'
  | 'underboss'
  | 'host'
  | 'system';

/**
 * Map a caller's email to the highest-privilege role label that applies.
 * Order matters — most-privileged first so we report the right hat even
 * when the caller technically wears several.
 *
 * Note: `isAdmin()` in auth.ts returns true for BOTH plain admins and
 * super_admins, so we read `admins.role` directly to distinguish.
 */
export async function resolveCapActorKind(email?: string | null): Promise<CapActorKind> {
  if (!email) return 'system';
  if (await isSuperAdmin(email)) return 'super_admin';

  const admin = await prisma.admin.findUnique({
    where: { email: email.toLowerCase() },
    select: { role: true },
  });
  if (admin?.role === 'admin') return 'admin';
  if (admin?.role === 'payment_admin') return 'payment_admin';

  if (await isUnderboss(email)) return 'underboss';
  return 'host';
}

interface RecordCapChangeOpts {
  partyId: string;
  /** Previous cap value, as read from the DB before the UPDATE. `null` = no prior cap. */
  oldCapUsd: Decimal | number | null;
  /** New cap value being written. `null` = clearing the cap. */
  newCapUsd: number | null;
  actorEmail: string;
  actorKind: CapActorKind;
  /** Free-form context, e.g. 'Accepted host appeal: ...' or 'PATCH /api/parties/:id'. */
  note?: string | null;
}

/**
 * Append one row to reimbursement_cap_audit.
 *
 * Callers are expected to gate this on `oldCap !== newCap` — we don't log
 * idempotent (no-op) writes. Failures are caught and logged but never
 * propagated, so a transient audit-table issue can't break cap edits.
 */
export async function recordCapChange(opts: RecordCapChangeOpts): Promise<void> {
  try {
    const oldDec =
      opts.oldCapUsd == null
        ? null
        : opts.oldCapUsd instanceof Decimal
          ? opts.oldCapUsd
          : new Decimal(opts.oldCapUsd as number);
    const newDec = opts.newCapUsd == null ? null : new Decimal(opts.newCapUsd);

    await prisma.reimbursementCapAudit.create({
      data: {
        partyId: opts.partyId,
        oldCapUsd: oldDec,
        newCapUsd: newDec,
        actorEmail: (opts.actorEmail || 'unknown').toLowerCase(),
        actorKind: opts.actorKind,
        note: opts.note ?? null,
      },
    });
  } catch (err) {
    // Audit-trail failures must not break the cap edit itself.
    console.warn('[recordCapChange] failed to write audit row', err);
  }
}

/**
 * Returns true when the cap actually changed. Treats `null`/`undefined` as
 * the same "no cap set" state, and compares numeric values regardless of
 * whether they arrive as Decimal | string | number.
 */
export function capValuesDiffer(
  oldCap: Decimal | number | string | null | undefined,
  newCap: number | null | undefined,
): boolean {
  const o = oldCap == null ? null : Number(oldCap as any);
  const n = newCap == null ? null : Number(newCap);
  if (o === null && n === null) return false;
  if (o === null || n === null) return true;
  if (!Number.isFinite(o) || !Number.isFinite(n)) return o !== n;
  // Compare to 2 decimal places to match the column's numeric(10,2) precision.
  return Math.round(o * 100) !== Math.round(n * 100);
}
