# AI ordering through pizza-mcp: environment and pilot runbook (basil-14648)

Plan: `openpizza/plans/rsv-pizza-ordering.md`. rsv.pizza is an OPOP client of pizza-mcp. It places and tracks
orders, and never computes a binding price, never talks to Bland, never sees an OTP. The host approves on
pizza-mcp's `/confirm/<id>` page with a code emailed to them. The legacy Bland / `ai-phone` code is untouched
(removed in P2).

## PRECONDITION: the migration reaches prod BEFORE this code does

Prisma selects every declared column of a model. `PayoutDocument` now declares `source` and `pizzaOrderId`, so the
moment this code is live against a database without migration `20261031_pizza_orders`, **every `payout_documents` query
(payments, receipts, reimbursement, admin) fails with a missing-column error**, whether or not anyone uses AI ordering.
Order of operations, no exceptions:

1. Apply `backend/prisma/migrations/20261031_pizza_orders/migration.sql` to prod (additive; idempotent; safe to re-run),
   with `SET lock_timeout` first (see below).
2. `npm --prefix backend run check:schema-drift` (and the `migrations-applied` CI check) must pass.
3. Only then merge / deploy the backend. Frontend previews share the prod backend, so they are unaffected until step 3.

The same note belongs in the PR description. (The raw SQL receipt gates also read `payout_documents.source`.)

**Apply it with a lock timeout.** The `payout_documents` statements take strong locks on a table every payout screen reads.
Without a timeout, one waiting `ALTER TABLE` queues every later query behind it. Set the timeout in the same session (a direct
or session-mode connection, not transaction pooling), so a blocked statement fails instead of queueing:

```bash
psql "$DIRECT_DATABASE_URL" -v ON_ERROR_STOP=1 -c "SET lock_timeout = '5s'" -f backend/prisma/migrations/20261031_pizza_orders/migration.sql
```

If it times out, run the same command again: every statement is idempotent. If this file was already applied, apply it
again before deploying: `pizza_orders.confirmed_at` was added later and the code needs it.

## What it adds

| Piece | Where |
|---|---|
| Typed OPOP client (JWT mint, `Idempotency-Key`, problem -> `AppError`) | `backend/src/services/pizzaMcp.client.ts` (types generated: `npm run gen:pizza-mcp --workspace=backend`) |
| Host endpoints, `/api/parties/:id/pizza/*` | `backend/src/routes/pizza-order.routes.ts` |
| Signed webhook `POST /api/pizza-mcp/webhook` | `backend/src/routes/pizza-mcp-webhook.routes.ts` |
| `GET /.well-known/jwks.json` | `backend/src/routes/jwks.routes.ts` |
| Tables `pizza_orders`, `pizza_carts`, `pizza_webhook_events`; `payout_documents.source`, `.pizza_order_id` | `backend/prisma/migrations/20261031_pizza_orders/` |
| UI | `PizzaOrderFlow`, `ShopPicker`, `CartReview`, `OrderStatus` |

## Environment

Backend (Vercel project for `api.rsv.pizza`):

| Var | Required | Value |
|---|---|---|
| `PIZZA_MCP_URL` | yes | pizza-mcp base URL, e.g. `https://api.openpizza.xyz`. Also the token `aud`. |
| `PIZZA_MCP_SIGNING_KEY` | yes | ES256 PKCS8 PEM. Create: `bash backend/scripts/gen-pizza-mcp-key.sh` (prints, writes nothing). |
| `PIZZA_MCP_WEBHOOK_SECRET` | yes | `whsec_...` (32+ random chars), same as pizza-mcp's webhook secret for `rsv.pizza`. Comma separate to rotate. |
| `PIZZA_ORDERING_PARTY_IDS` | yes | Comma separated party UUIDs. Empty or unset = feature off for everyone. |
| `PIZZA_MCP_ISSUER` | no | Default `https://api.rsv.pizza`. Must equal the `issuer` in pizza-mcp's trusted-issuer entry. |
| `PIZZA_MCP_AUDIENCE` | no | Default `PIZZA_MCP_URL`. pizza-mcp also accepts `<url>/api/mcp`. |
| `PIZZA_MCP_SIGNING_KID`, `PIZZA_MCP_JWKS_EXTRA` | no | Key id override; old public JWKs to keep publishing while rotating. |
| `RESEND_API_KEY`, `TELEGRAM_BOT_TOKEN` | existing | Used for the "confirmed" host notice. |

Frontend: `VITE_AI_ORDERING=1` builds the UI in (a Vercel preview env var is enough). The allowlist is the real switch.

pizza-mcp side (its own docs: `pizza-mcp/docs/CLIENTS.md`):

```
PIZZA_MCP_TRUSTED_ISSUERS=[{"issuer":"https://api.rsv.pizza","jwks_url":"https://api.rsv.pizza/.well-known/jwks.json","client_id":"rsv.pizza"}]
PIZZA_MCP_CLIENT_WEBHOOKS=[{"client_id":"rsv.pizza","url":"https://api.rsv.pizza/api/pizza-mcp/webhook","secret":"<PIZZA_MCP_WEBHOOK_SECRET>"}]
PIZZA_MCP_CANONICAL_URL=<PIZZA_MCP_URL>
```

Note the webhook path is `/api/pizza-mcp/webhook` (the example in CLIENTS.md uses `/webhooks/pizza-mcp`).

## Pilot runbook (one party)

1. **Migration first.** Apply `backend/prisma/migrations/20261031_pizza_orders/migration.sql` to prod BEFORE merging, with
   `SET lock_timeout` as shown above (CLAUDE.md rule; it is additive, defaulted/nullable, RLS on). Then `npm --prefix backend run check:schema-drift`.
2. **Key.** `bash backend/scripts/gen-pizza-mcp-key.sh`, store the output as `PIZZA_MCP_SIGNING_KEY` on the backend project.
3. **Backend env** (table above), with `PIZZA_ORDERING_PARTY_IDS` = the single pilot party's UUID. Deploy the backend.
4. **Check JWKS:** `curl https://api.rsv.pizza/.well-known/jwks.json` returns one EC P-256 key.
5. **pizza-mcp env** (above), including its outbound-call (Bland) settings and the shop allow-list for the
   pilot (shops that agreed in advance). Check `GET <PIZZA_MCP_URL>/api/v1/pizzerias?near=...` answers.
6. **Frontend:** set `VITE_AI_ORDERING=1` on the frontend project (preview first) and redeploy.
7. **Smoke test as the party's host:** open the party's host page > pizza order card. You should see "AI Ordering - Pilot".
   Pick a pilot shop, build the order, set a ceiling, approve: a new tab opens pizza-mcp's `/confirm` page, enter the emailed code.
   Status moves `awaiting_approval` -> `calling` -> (`calling`, "The call ended and the result is being checked.") ->
   `confirmed_by_shop`; only then does the payments page show a draft receipt row.
8. **Turn off:** clear `PIZZA_ORDERING_PARTY_IDS` (instant, no deploy needed beyond the env change) or unset `VITE_AI_ORDERING`.

## Testing before the real pilot

- **Frontend previews share the prod backend.** A preview with `VITE_AI_ORDERING=1` talks to `api.rsv.pizza`, and pizza-mcp fetches
  our JWKS from `https://api.rsv.pizza/.well-known/jwks.json` (and posts webhooks to `https://api.rsv.pizza/api/pizza-mcp/webhook`).
  So **a test call needs this backend deployed to prod first** (migration first, then code), with the pilot party id allowlisted.
  A preview alone cannot complete an order.

## Behaviour to know

- **Budget:** a party with no reimbursement cap (null or $0) cannot order. The quote, the order's `max_total_cents` and the
  ceiling limit are the REMAINING budget: cap minus eligible uploaded receipts minus the ceilings (or confirmed totals) of
  open orders. A confirmed order and its real receipt count once (see Receipts below). If an order uses up the budget, the
  `CAP_EXHAUSTED` error and `/config` name it, and the UI links to it.
- **One order per party at a time.** An order that blocks also holds budget. A new order is then refused with
  `ORDER_IN_PROGRESS` unless the host explicitly confirms "place a second order" (it must still fit the remaining budget):
  - Blocks: anything live, including `approval_timeout` whatever its `outcome` says (approving it sends the call back to the
    shop), and every confirmed order, even with its receipt uploaded.
  - Blocks: an ended order (`needs_review`, `refused`, `unreachable`, `canceled`, `shop_requires_prepay`) when pizza-mcp's `outcome`
    says `nothing_ordered: false`, meaning an order may exist. Only that boolean counts: `outcome.reason` is never listed in code, so a new
    reason needs no change here. On `approval_timeout` either value still blocks and holds: it is not a final status.
  - Free: an ended order with `nothing_ordered: true`, a released order, and an expired approval (`awaiting_approval` with nothing to open).
  - With no `outcome` from pizza-mcp: `needs_review` blocks only if the shop gave a total inside the ceiling. `refused`, `unreachable`,
    `canceled` and `shop_requires_prepay` are free.
  The idempotency key is derived on the server; the browser cannot choose it.
- **Checking (pizza-mcp 662d51c):** nothing is `confirmed_by_shop` before pizza-mcp's call judge has read the call. When the shop agrees,
  the order stays `calling` with `call.checking = { message }` (the API view also carries it as `checking`) until the judge moves it to
  `confirmed_by_shop` or `needs_review`. No webhook is sent when checking starts, so the page's poll (which runs for every non-final
  status, `calling` included) shows the message: "Checking the call with <shop>", not confirmed. No draft receipt, no "confirmed" email or
  Telegram notice, no confirmed total and no `confirmedAt` before `confirmed_by_shop`; the ceiling stays held. Nothing is redialed meanwhile.
  It normally takes seconds; if the call record never arrives the order goes to `needs_review` / `no_call_record` within about an hour.
  A confirmed phone total includes tax (pizza-mcp's gates refuse one that does not), and the copy says "with tax".
- **Cancel:** the placing host can cancel an order that is waiting for approval, and a `calling` order while its dial is deferred
  (`call.deferred`: no call is on the line yet) (`POST .../orders/:id/cancel`). If the dial starts first, pizza-mcp answers 409 and the
  host sees that error. Once a call is live, or while the finished call is being checked, the button is not shown and the route answers 409.
- **Release:** an ended order that blocks can be released by any host or edit-enabled co-host, after a confirmation prompt: "Nothing was
  ordered" (`POST .../orders/:id/settle {action:'nothing_ordered'}`). A released order holds no budget and blocks nothing. It is the host's word,
  so it is offered only after they have checked with the shop. Confirmed orders cannot be released.
- **pizza-mcp e62620e:** `call_check_timeout` (an earlier call's check never finished, so the callback was never made) ends
  `needs_review` with `nothing_ordered: false`, until every call shows no order. `pending_operator_review` now means only a
  judge-unavailable quarantine. A `price_approval_timeout` is `nothing_ordered: false` unless a verdict shows no order, so it reads "Approval
  timed out ... check with the shop" and never says nothing is ordered. A `canceled` order after an approval timeout is `outcome_unclear`
  / `false`: held, blocking, releasable. `outcome` can change after the status is final (`change: "outcome"`), including a late verdict after
  `call_check_timeout`. Callbacks can wait longer under `call_check_pending` and each re-deferral may send `order.updated` calling to
  calling: applied cheaply, and only a first `confirmed_by_shop` ever sends an email or Telegram message. A spoken card no longer changes
  an outcome (`card_spoken` is gone); stored transcripts keep prices and only phones and other long numbers are removed. rsv stores no transcript.
- **pizza-mcp 4cbebfe:** no schema or reason-code changes (spec and generated types are byte-identical). An `order.updated` with `change: "outcome"`
  can now carry only a new `outcome.message` (same reason, same `nothing_ordered`), e.g. `call_check_timeout` once the late check has finished
  ("the shop most likely took your order", or "could not tell"). rsv applies every event whole, so it stores the latest message and the status
  line shows it; blocking, the hold, the draft and the notices are unchanged. A same-reason re-deferral no longer sends `calling` -> `calling`
  (rsv handles both). rsv does not match on the `TIER_UNAVAILABLE` detail text, only on the code. pizza-mcp's own host emails ("Your order with X is
  likely real", "Nothing was ordered from X") come from pizza-mcp; rsv sends nothing for `needs_review`, so nothing contradicts them.
- **pizza-mcp 4353198:** no API or schema change (spec and generated types byte-identical). Behaviour only: `outcome.nothing_ordered` is `false` in more cases
  (a judge `not_placed` on a call where the tools recorded a line, total or price question, and any call whose end the provider never confirmed), and
  `call_check_timeout` has more message variants ("could not confirm in time that the earlier call had ended", "found no order in the part of the call we
  have"). All are `false`, so rsv holds and blocks as before and shows pizza-mcp's message. There are fewer late-check emails from pizza-mcp (none for
  "could not tell", none when stale, none after a timeout email that already carried the finding); rsv sends none of its own. The judge reads raw
  transcripts; rsv still stores and shows none.
- **pizza-mcp 5320d6a:** no API or schema change (spec and generated types byte-identical). When the AI ends a call on the shop's refusal (`cant_fulfill`,
  `over_limit`, `shop_closed`, `wrong_number`, `refused_ai`, `asked_not_to_call`, `requires_prepay`, `host_declined`, `transfer_to_host`) the status event now has
  `nothing_ordered: false` and "not finished checking" wording. Once the call is checked, an `order.updated` with `change: "outcome"` flips it to `true` (the new
  message says nothing was ordered); if the check cannot confirm it, it stays `false` with a "could not confirm" message. rsv switches only on `nothing_ordered`:
  held and blocking while `false`, released when `true`, and it shows the latest message. `shop_answered_no_order`, `no_answer` and `unreachable` can now be
  `outcome_unclear` / `false`. The host email for these reasons is delayed and sent once, by pizza-mcp; rsv sends none.
- **Copy:** nothing may say "nothing was ordered", or suggest ordering again is safe, unless `nothing_ordered` is true. A released order says a
  host said so. The one reason the copy names is `judge_unavailable` (pizza-mcp faf6855: its call judge could not read the call): it
  adds that the call is waiting for a person at pizza-mcp to read it and that the host need not wait for that, since the check does not
  report back. It blocks and holds like any `nothing_ordered: false`. `call.attempts` is never shown (since pizza-mcp 9ad5364 it no longer counts `not_dialed` rows, but the outcome is what the host reads). A `calling` order can last up to 60 minutes
  before pizza-mcp moves it to `needs_review`, so after 10 minutes the page says it is still waiting; `call.deferred` shows as delayed or scheduled, not calling.
- **Receipts:** only a receipt uploaded after the order can count for it, and an order that ended but may exist at the shop can have one. One that matches the confirmed total (5% or $1) does so
  automatically. "I uploaded the receipt" (`action:'receipt_uploaded'`) is refused with `NO_RECEIPT_FOUND` until such a receipt exists, and it
  only pairs them: the receipt offsets the order up to its own amount, so the party's total stays at least the order's total. If the shop gave no
  total, the receipt replaces the ceiling hold. A receipt OCR has not read yet offsets nothing until it has an amount.
- **Coming back later:** the flow reopens a releasable or confirmed order with no receipt yet, for any host who can act on it.
- A confirmed order keeps being polled for 20 minutes from when it entered `confirmed_by_shop`. Since 662d51c the judge rules before that
  status, so a downgrade is no longer expected; the window is a cheap safety net.
- **Menu fit:** sizes map to the shop's nearest offered size (shown to the host); toppings the shop does not list become a
  per-pizza choice (leave it off, or skip that pizza). Nothing is ordered until every question is answered.

- Every party route needs a logged-in host or edit-enabled co-host AND an allowlisted party; anything else is a 404.
- Reimbursement cap (`parties.reimbursement_cap_usd` or numeric event tag) is sent as `max_total_cents` and also checked here.
- The reminder line (`payout_documents.source = 'ai_call'` / `'opop_native'`) has no file and no `ocr_amount`; the shop's total is
  in `ocr_raw` and shown in the Receipts list. It is **never** counted as a receipt: every receipt gate (submission readiness,
  admin approve/execute `payoutHasReceipt`, fast pass, refund tags, counts, sums, OCR and price-index jobs) filters
  `source = 'upload'`, enforced by `backend/src/lib/receiptSource.test.ts`. The host uploads the real receipt as usual and can
  remove the reminder line. A later downgrade (`needs_review`) or cancel removes it; a changed total updates it.
- Webhook: raw-body HMAC (5 minute window), dedupe on `Webhook-Id` inside the upsert transaction, stale (shorter timeline) events ignored.
  pizza-mcp (9ad5364 on) also sends `order.updated` with `change: "outcome"` when only `order.outcome` changed (same status, same timeline,
  `previous_status` equal to the status), for example a late call record on an order that already ended. Every event is applied whole, on
  final statuses too, so blocking and the budget hold follow the latest `outcome`. Equal-timeline events are ordered by the webhook's
  `created_at` only: a poll or a cancel response is applied but never stamps the row with this server's clock. Since faf6855 a status
  change found by pizza-mcp's sweep comes as a plain status `order.updated` (no `change`), and a body never changes under one `Webhook-Id`.
- **Shop can't be called:** pizza-mcp answers `place_order` with 422 `CALLS_NOT_AVAILABLE_HERE` when it won't phone the shop (for example
  `details.reasons: ["possible_opt_out"]`: the shop may have asked not to be called, and calls to the number are paused until an operator
  checks it). `["pending_operator_review"]` is different: an earlier call to the shop could not be checked automatically and waits for a
  person; nothing suggests an opt-out, so the host gets its own words ("...could not be checked automatically... This is not because of
  anything <shop> said.") and the error carries `reason`. Nothing is created; the host is told so, sent back to the shop list with that shop marked "call it yourself", and can order
  elsewhere with no override. The same refusal can come on pizza-mcp's approval page; the order then stays waiting for approval, and the
  status copy tells the host to cancel it and pick another pizzeria (canceling frees it). An order never dialed because its number was
  quarantined ends `unreachable` with `nothing_ordered: true` (`not_dialed`, or `pending_operator_review` when the hold is an unread
  call) and holds nothing.
- Co-hosts see an order but not its approval link; only the host who placed it is polled / notified.
