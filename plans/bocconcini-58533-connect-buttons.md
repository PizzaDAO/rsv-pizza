# bocconcini-58533 — connect buttons on group reminders

Follow-up to suppli-58533 (host DM submissions to Molto Benny).

## Problem
Group Telegram reminders link hosts to the connect deeplink
(`https://t.me/<bot>?start=submit_<token>`) via an inline HTML `<a>` "DM them to me"
link. Telegram does NOT reliably re-send the `/start <payload>` for a bot the host
has already started, so the host taps the link, lands in a DM that doesn't re-bind,
and dead-ends at "I'm not sure which event this is for yet!" when they send a
photo/number.

## Change
Add an inline keyboard to every group reminder (receipts / photos / attendance /
wallet) with two buttons:
1. **URL button** → the same `submit_<token>` deeplink (more reliable than an inline
   text link).
2. **📋 Copy connect code** (`copy_text`, Bot API 7.11+) → copies the literal
   `/start submit_<token>` so the host can paste it into the DM and bind regardless
   of whether the tap fired the payload.

moltobene already binds a pasted `/start submit_<token>` — no bot change needed.

Also update the dead-end DM reply to point hosts at the copy button.

## Files touched (rsvpizza-only, backend-only, no migration, no frontend)
- `backend/src/services/cityTelegramGroup.ts` — `sendToCityGroup` gains an optional
  4th `replyMarkup` param, spread into the `sendMessage` body (covers both the
  initial send and the supergroup-migration retry, which share the `send` closure).
- `backend/src/routes/admin-payout.routes.ts`
  - `resolveSubmitDeeplink` now returns `{ deeplink, token }` (or `null`) so the
    raw token is available for the copy button.
  - New `buildSubmitKeyboard(deeplink, token, verb)` helper.
  - `sendCityGroupReminder` gains an optional 4th `replyMarkup` param, passed through.
  - All four reminder routes build a `groupKeyboard` and pass it as the 4th arg.
    Per-type URL-button verb: receipts/photos = "DM them to me",
    attendance = "DM me the number", wallet = "DM it to me".
- `backend/src/routes/telegram-inbound.routes.ts` — dead-end "not sure which event"
  reply now points at the "📋 Copy connect code" button.

`buildReminderCopy` still takes the deeplink STRING (or null); body copy / inline
`<a>` link unchanged — the buttons are additive.
