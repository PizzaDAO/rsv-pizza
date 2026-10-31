# AI ordering through pizza-mcp: environment and pilot runbook (basil-14648)

Plan: `openpizza/plans/rsv-pizza-ordering.md`. rsv.pizza is an OPOP client of pizza-mcp. It places and tracks
orders, and never computes a binding price, never talks to Bland, never sees an OTP. The host approves on
pizza-mcp's `/confirm/<id>` page with a code emailed to them. The legacy Bland / `ai-phone` code is untouched
(removed in P2).

## What it adds

| Piece | Where |
|---|---|
| Typed OPOP client (JWT mint, `Idempotency-Key`, problem -> `AppError`) | `backend/src/services/pizzaMcp.client.ts` (types generated: `npm run gen:pizza-mcp --workspace=backend`) |
| Host endpoints, `/api/parties/:id/pizza/*` | `backend/src/routes/pizza-order.routes.ts` |
| Signed webhook `POST /api/pizza-mcp/webhook` | `backend/src/routes/pizza-mcp-webhook.routes.ts` |
| `GET /.well-known/jwks.json` | `backend/src/routes/jwks.routes.ts` |
| Tables `pizza_orders`, `pizza_webhook_events`; `payout_documents.source`, `.pizza_order_id` | `backend/prisma/migrations/20261031_pizza_orders/` |
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

1. **Migration first.** Apply `backend/prisma/migrations/20261031_pizza_orders/migration.sql` to prod BEFORE merging
   (CLAUDE.md rule; it is additive, defaulted/nullable, RLS on). Then `npm --prefix backend run check:schema-drift`.
2. **Key.** `bash backend/scripts/gen-pizza-mcp-key.sh`, store the output as `PIZZA_MCP_SIGNING_KEY` on the backend project.
3. **Backend env** (table above), with `PIZZA_ORDERING_PARTY_IDS` = the single pilot party's UUID. Deploy the backend.
4. **Check JWKS:** `curl https://api.rsv.pizza/.well-known/jwks.json` returns one EC P-256 key.
5. **pizza-mcp env** (above), including `OUTBOUND_PROVIDER` and Bland settings on its side, and the shop allow-list for the
   pilot (shops that agreed in advance). Check `GET <PIZZA_MCP_URL>/api/v1/pizzerias?near=...` answers.
6. **Frontend:** set `VITE_AI_ORDERING=1` on the frontend project (preview first) and redeploy.
7. **Smoke test as the party's host:** open the party's host page > pizza order card. You should see "AI Ordering - Pilot".
   Pick a pilot shop, build the order, set a ceiling, approve: a new tab opens pizza-mcp's `/confirm` page, enter the emailed code.
   Status moves `awaiting_approval` -> `calling` -> `confirmed_by_shop`; the payments page shows a draft receipt row.
8. **Turn off:** clear `PIZZA_ORDERING_PARTY_IDS` (instant, no deploy needed beyond the env change) or unset `VITE_AI_ORDERING`.

## Behaviour to know

- Every party route needs a logged-in host or edit-enabled co-host AND an allowlisted party; anything else is a 404.
- Reimbursement cap (`parties.reimbursement_cap_usd` or numeric event tag) is sent as `max_total_cents` and also checked here.
- The draft receipt (`payout_documents.source = 'ai_call'`) has no file and no `ocr_amount`; the shop's total is in `ocr_raw`.
  The host attaches the real receipt as before. The draft never adds to a payout sum.
- Webhook: raw-body HMAC (5 minute window), dedupe on `Webhook-Id` inside the upsert transaction, stale (shorter timeline) events ignored.
- Co-hosts see an order but not its approval link; only the host who placed it is polled / notified.
