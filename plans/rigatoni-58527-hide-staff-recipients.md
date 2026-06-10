# rigatoni-58527 — Hide admins & underbosses from /payments reimbursement recipient picker

## Problem
On `/payments`, when an admin records or sends a reimbursement, the recipient
picker lists the event's main host plus any co-hosts that resolve to a real
`User`. Org insiders (admins and underbosses) who are listed as a host/co-host
on an event therefore show up as selectable reimbursement recipients. They
should never be reimbursable — it's a conflict-of-interest / fraud surface.

## Root cause (single source)
`GET /api/admin/payouts/parties/search` in
`backend/src/routes/admin-payout.routes.ts` (~lines 1014–1138) builds the
`hostCandidates` array (main host first, then resolvable co-hosts). This one
endpoint (`searchApprovedParties` in `frontend/src/lib/api.ts`) feeds BOTH
recipient pickers:
- `frontend/src/components/payments-admin/ExternalPaymentModal.tsx` ("Record External Payment")
- `frontend/src/components/payments-admin/SendPaymentModal.tsx` ("Send Payment")

So filtering here fixes both with no frontend change required.

## Decision (confirmed with Snax)
Exclude any candidate whose lowercased email matches:
- **any row in the `admins` table** (every role — `admin`, `super_admin`, AND `payment_admin`), or
- an **active** row in the `underbosses` table (`is_active = true`).

This is the broadest conflict-of-interest guard: no org insider can be a
reimbursement recipient.

## Implementation
All in `backend/src/routes/admin-payout.routes.ts`, inside the
`/parties/search` handler:

1. After resolving `parties` and `cohostUserByEmail`, collect the full set of
   candidate emails to check = every party's main-host email (`p.user.email`)
   UNION `allCohostEmails`. Lowercase + trim.

2. Batch-look-up insiders in two queries (no per-party round-trips):
   ```ts
   const candidateEmails = Array.from(new Set([
     ...Array.from(allCohostEmails),
     ...parties.map((p) => p.user?.email?.trim().toLowerCase()).filter(Boolean) as string[],
   ]));
   const [adminRows, underbossRows] = candidateEmails.length
     ? await Promise.all([
         prisma.admin.findMany({ where: { email: { in: candidateEmails } }, select: { email: true } }),
         prisma.underboss.findMany({ where: { email: { in: candidateEmails }, isActive: true }, select: { email: true } }),
       ])
     : [[], []];
   const excludedEmails = new Set<string>();
   for (const a of adminRows) excludedEmails.add(a.email.toLowerCase());
   for (const u of underbossRows) excludedEmails.add(u.email.toLowerCase());
   ```
   (Admin/underboss emails are stored lowercased by the auth paths; lowercase
   here defensively anyway.)

3. When building `hostCandidates`:
   - **Main host**: only push if `!excludedEmails.has(p.user.email.toLowerCase())`.
   - **Co-hosts**: skip if `excludedEmails.has(email)` (the already-lowercased
     `email` var in the loop).

4. Leave the top-level `hostUserId: p.user!.id` field as-is — it is NOT consumed
   for recipient selection by either modal (verified: ExternalPaymentModal and
   SendPaymentModal both drive selection off `hostCandidates`/`recipientUserId`),
   so changing it is unnecessary and risks interface churn.

5. Do NOT drop a party from the results when its `hostCandidates` ends up empty
   (e.g. a solo event hosted by an admin). The party should still be findable so
   an admin can record a payment via the modal's existing **"Other"** free-form
   email path. Both modals already handle a zero-length `hostCandidates`
   (ExternalPaymentModal: no auto-select; SendPaymentModal: "No payable hosts
   found for this city.").

## Notes / landmines
- **Backend-only change.** No schema/migration. Backend auto-deploys from master
  ~1 min after merge — no DB ordering concern here.
- Highest-churn file in the repo; keep the diff tightly scoped to the
  `/parties/search` handler. Re-read it from `origin/master` first.
- Keep comments full-line (no schema/migration touched, but house style).

## Verification
- Vercel preview: `https://rsvpizza-git-rigatoni-58527-hide-staff-recipients-pizza-dao.vercel.app`
  (note: preview frontend hits the **production backend**, which won't have this
  change until merge+deploy — so behavior verifies in prod after merge, not on
  the preview).
- After backend deploy: pick an event whose host/co-host is a known underboss or
  admin in the External Payment / Send Payment modal → that person no longer
  appears in the recipient list; non-insider hosts still appear.

## Out of scope
- The "Other" free-form email path is unchanged — an admin can still deliberately
  type any email. This task only removes insiders from the auto-suggested options.
