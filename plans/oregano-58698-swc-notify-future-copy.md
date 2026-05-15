# oregano-58698: Remove "future" from SWC notify checkbox copy

**Priority:** P3
**Type:** Copy / i18n

## Problem
The Stand With Crypto opt-in checkbox (used for CA/AU/EU/UK) reads "Notify me about **future** Stand With Crypto events." The word "future" is redundant (a notification is implicitly forward-looking) and was supposed to have been removed earlier.

Affected key: `swcNotify` in `frontend/src/i18n/locales/{lang}/rsvp.json`.

The `swcBrNotify` key (Juntos por Cripto) already lacks "future" and should NOT be touched.

## Exact edits

For each locale, replace only the `swcNotify` line:

| Locale | Before | After |
|---|---|---|
| en | `Notify me about future Stand With Crypto events.` | `Notify me about Stand With Crypto events.` |
| de | `Benachrichtigen Sie mich über zukünftige Stand With Crypto Events.` | `Benachrichtigen Sie mich über Stand With Crypto Events.` |
| fr | `Me notifier des futurs événements Stand With Crypto.` | `Me notifier des événements Stand With Crypto.` |
| es | `Notificarme sobre futuros eventos de Stand With Crypto.` | `Notificarme sobre eventos de Stand With Crypto.` |
| pt | `Notifique-me sobre futuros eventos Stand With Crypto.` | `Notifique-me sobre eventos Stand With Crypto.` |
| ja | `今後のStand With Cryptoイベントについて通知を受け取る。` | `Stand With Cryptoイベントについて通知を受け取る。` |
| zh | `通知我未来的 Stand With Crypto 活动。` | `通知我 Stand With Crypto 活动。` |

(8th locale is whichever else lives under `frontend/src/i18n/locales/`; only edit `swcNotify` in that file too if present, otherwise skip.)

## Files to modify
- `frontend/src/i18n/locales/en/rsvp.json`
- `frontend/src/i18n/locales/de/rsvp.json`
- `frontend/src/i18n/locales/fr/rsvp.json`
- `frontend/src/i18n/locales/es/rsvp.json`
- `frontend/src/i18n/locales/pt/rsvp.json`
- `frontend/src/i18n/locales/ja/rsvp.json`
- `frontend/src/i18n/locales/zh/rsvp.json`

## Out of scope
- Do NOT touch `swcJoin`, `swcBrNotify`, or any `swc*Modal.*` keys.
- Do NOT touch database fields, schema, or backend.
- Do NOT change the i18n key name.

## Verification
- `grep -ri "future" frontend/src/i18n/locales/*/rsvp.json` returns no SWC-related matches.
- `grep -ri "futur" frontend/src/i18n/locales/*/rsvp.json` returns nothing related to SWC (fr/es/pt).
- `grep -ri "zukünftig" frontend/src/i18n/locales/de/rsvp.json` returns nothing.
- `grep "今後" frontend/src/i18n/locales/ja/rsvp.json` returns nothing in the swc block.
- `grep "未来" frontend/src/i18n/locales/zh/rsvp.json` returns nothing.
- JSON files are still valid (the agent should run `node -e "JSON.parse(require('fs').readFileSync(p))"` on each).

## Branch
`oregano-58698-swc-notify-future`
