# ravioli-58517 — Split the receipts reminder into a receipts reminder + a photo reminder

## Goal
The `/payments` by-city ⋮ menu currently has a single **"Send receipts reminder"** action
(`crocchetta-92106/92107`) whose Telegram message says *"Make sure you've uploaded receipts
**and photos** to rsv.pizza/<slug>"* and which persists `parties.receipts_reminder_sent_at`
(shown as a "Sent {date}" sub-label).

Split this into **two** independent menu actions, each with its own send-history timestamp
(mirroring the existing **wallet reminder** sibling, which already has this exact shape):

| Action | Telegram message | sent-at column |
|---|---|---|
| Send receipts reminder | `Make sure you've uploaded your receipts to rsv.pizza/<slug>` | `receipts_reminder_sent_at` (existing) |
| **Send photo reminder** (new) | `Make sure you've uploaded your event photos to rsv.pizza/<slug>` | `photo_reminder_sent_at` (new) |

"With the same send history as the others" = the new photo reminder gets a
`photo_reminder_sent_at` timestamptz column + "Sent {date}" sub-label, identical to receipts
+ wallet.

## Architecture (existing pattern to clone)
The wallet reminder is the precise template — it is already a sibling clone of the receipts
reminder. Everywhere `walletReminder` / `wallet_reminder_sent_at` / `tg-wallet-reminder`
appears, add a parallel `photoReminder` / `photo_reminder_sent_at` / `tg-photo-reminder`.

Both reminders share the `sendTelegramMessage` + `sendCityGroupReminder` helpers and the
host-DM + city-group two-channel send. No new helpers needed.

## Changes

### DB / Prisma (apply to PROD before merge — preview shares prod backend+DB)
1. **New migration** `supabase/migrations/20260608_photo_reminder_sent_at.sql`:
   ```sql
   -- Track when photo reminders are sent for a party/city.
   -- Recorded when the TG photo-reminder endpoint successfully sends at least one message.
   ALTER TABLE parties ADD COLUMN IF NOT EXISTS photo_reminder_sent_at timestamptz;
   ```
2. **`backend/prisma/schema.prisma`** (after line 175, next to `walletReminderSentAt`):
   ```prisma
   photoReminderSentAt     DateTime? @map("photo_reminder_sent_at") @db.Timestamptz // When admin sent TG photo reminder
   ```

### Backend — `backend/src/routes/admin-payout.routes.ts`
3. `partyMetaSelect` (~line 295): add `photoReminderSentAt: true,`.
4. Both by-party projection sites (~2158-2164 and ~2295-2299): emit
   `photoReminderSentAt: <...>?.toISOString() ?? null` alongside the wallet one.
5. **Change the existing receipts message** (~line 6710) from
   `Make sure you've uploaded receipts and photos to rsv.pizza/${slug}` to
   `Make sure you've uploaded your receipts to rsv.pizza/${slug}`.
6. **New endpoint** `POST /:partyId/tg-photo-reminder` — clone of `tg-wallet-reminder`
   (~line 6772). Identical structure (`requireAuth` + `requireAnyAdminOrPaymentAdmin`,
   host DM + `sendCityGroupReminder`, per-channel success/skip response), with:
   - `text = \`Make sure you've uploaded your event photos to rsv.pizza/${slug}\``
   - persists `data: { photoReminderSentAt: new Date() }` on `hostDmSent || groupSent`
   - console marker `[tg-photo-reminder] party=... slug=... host_dm=... group=...`

### Frontend — types
7. **`frontend/src/types.ts`**: add `photoReminderSentAt?: string | null;` in BOTH places
   next to `walletReminderSentAt` (~line 343 Party type, ~line 2480 by-party projection type).

### Frontend — api
8. **`frontend/src/lib/api.ts`**: add `sendTgPhotoReminder(partyId)` — clone of
   `sendTgWalletReminder` (~line 598), POSTing `/api/admin/payouts/${partyId}/tg-photo-reminder`,
   returns `SendTgReceiptsReminderResponse` (reuse the existing response interface).

### Frontend — `frontend/src/components/payments-admin/PayoutsByPartyTable.tsx`
Clone every `walletReminder` touchpoint into a `photoReminder` sibling:
9. Import `sendTgPhotoReminder` (~line 67) and a `Camera` icon from lucide-react (~line 22-29).
10. `PayoutsByPartyTableProps`: add `onTgPhotoReminderResult?` (clone of `onTgWalletReminderResult`, ~line 280).
11. `CityActionsMenu`:
    - props: `onSendPhotoReminder`, `canSendPhotoReminder`, `photoReminderBusy`, `photoReminderSentAt`
      (clone wallet equivalents in destructure + type block).
    - state: `const [confirmPhotoReminder, setConfirmPhotoReminder] = useState(false);`
    - reset `setConfirmPhotoReminder(false)` everywhere `setConfirmWalletReminder(false)` is called
      (menu open/close + click-out overlay).
    - `hasMenuItems`: add `|| canSendPhotoReminder`.
    - new menu `<button>` after the wallet-reminder item (~line 924): two-click confirm, `Camera`
      icon, label "Send photo reminder" / "Click again to confirm", "Sent {date}" sub-label from
      `photoReminderSentAt`.
12. Parent `PayoutsByPartyTable`:
    - destructure `onTgPhotoReminderResult` (~2826).
    - state `const [photoReminderBusyPartyId, setPhotoReminderBusyPartyId] = useState<string|null>(null);`
    - `const canSendPhotoReminder = viewerRole === 'admin';`
    - `handleSendPhotoReminder(row)` — clone of `handleSendWalletReminder` calling `sendTgPhotoReminder`.
    - in the render loop: `const photoReminderBusy = photoReminderBusyPartyId === row.party.id;`
    - `<CityActionsMenu>`: pass `canSendPhotoReminder`, `photoReminderBusy`,
      `photoReminderSentAt={row.party.photoReminderSentAt}`, and
      `onSendPhotoReminder={canSendPhotoReminder ? () => handleSendPhotoReminder(row) : undefined}`.

### Frontend — `frontend/src/pages/PaymentsAdminPage.tsx`
13. Add an `onTgPhotoReminderResult={(_partyId, result) => {...}}` toast handler (~line 1574),
    cloned from `onTgWalletReminderResult`, toast prefix `Photo reminder:`.

## Out of scope
- No cron/automation — both reminders stay manual admin actions.
- No reminders log table — the single sent-at timestamp is the audit trail (matches existing).
- Underbosses don't see either action (admin-only gate, unchanged).

## Verification
- `cd frontend && npx tsc --noEmit` and `cd backend && npx tsc --noEmit` clean.
- Preview: on `/payments` by-city ⋮ menu, two distinct items ("Send receipts reminder",
  "Send photo reminder"), each two-click-confirm, each showing its own "Sent {date}" after firing.
- Receipts message no longer mentions photos; photo message mentions only photos.

## Deploy ordering (memory: apply migration before merging Prisma change)
1. Create `photo_reminder_sent_at` column in PROD (migration SQL).
2. Merge PR → backend auto-deploys from master.
3. No backfill needed (new column defaults NULL = "never sent", correct).
