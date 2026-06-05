# arancini-58492: Natural-language Event Assistant

## Goal
Let a host type a plain-English instruction on their dashboard, have gpt-4o
propose a structured set of edits, show the host a per-change diff with toggles,
and apply the accepted subset through the **existing** `PATCH /api/parties/:id`
path so all current auth / validation / whitelists / webhooks apply unchanged.

## Core safety principle
The LLM **never writes to the DB**. It only produces a *candidate* patch. The
trusted write path is unchanged — if gpt-4o emits an admin-only field like
`reimbursement_cap_usd`, the backend drops it for non-admins exactly as today.
Defense in depth. The feature never auto-applies; every change is host-confirmed.

## Decisions (from Snax)
- **LLM:** OpenAI gpt-4o, reusing `getOpenAI()` from `backend/src/lib/openai.ts`
  with tool calling (`tool_choice` forces a single `propose_event_changes` call).
- **Field scope:** everything a host can edit, with backend field-level auth still
  enforced via the existing PATCH (admin-only fields excluded from the catalog for
  non-admin requesters so they are never proposed).
- **Confirm UX:** per-change diff, each row has an accept/reject toggle (default on).
- **Entry point:** an assistant box on the Host dashboard (HostPage), above tabs.
- **Dates:** relative dates are resolved server-side to an absolute datetime and
  always shown old→new in the event timezone; the host confirms. No forced
  clarifying question for dates — the diff is the safety net.

## Architecture
```
Host instruction
  -> POST /api/parties/:id/assistant   (requireAuth + canUserEditParty)
       1. load current party
       2. build field catalog -> OpenAI tool schema (filtered by requester role)
       3. gpt-4o, tool_choice forces propose_event_changes()
       4. validate returned patch vs catalog (types, enums, clamps, drop unknown)
       5. diff vs current values -> only changed fields
       6. return { assistantMessage, clarifyingQuestion?, proposedChanges[] }
       (NO write here)
  -> frontend renders per-change toggles (default ON)
  -> "Apply selected" -> existing updateParty(party.id, {…toggled subset})
       -> mergeParty() in place (no reload) -> toast
```

## New artifact: field catalog (single source of truth)
`backend/src/lib/eventEditSchema.ts` — one entry per editable field:
```ts
{ key: 'max_guests',        // snake_case, matches updateParty whitelist
  type: 'number',           // string|number|boolean|string[]|enum|datetime|object
  label: 'Guest cap',
  description: 'Maximum RSVPs allowed',
  adminOnly?: false,        // filtered out for non-admin requesters
  enum?: [...],             // e.g. nft_chain
  format(value): string }   // human-readable for the diff
```
Derive from this one catalog: (a) the OpenAI tool JSON schema, (b) server-side
validation, (c) human labels/formatters for the diff.

**Drift guard:** a unit test asserts every catalog key is a subset of the backend
PATCH whitelist. This catalog is effectively a *third* hand-enumerated field list
alongside `updateParty` (supabase.ts), `updatePartyApi` (api.ts), and the route
handler — the test prevents the known silent-save class of bug.

## Field-specific handling
- **date / time** — system prompt includes the event timezone **and today's date**
  so "move it to next Friday 7pm" resolves server-side. Endpoint emits PATCH-ready
  `date` (UTC ISO) + recomputed `duration`; frontend formats back to tz-local for
  the diff.
- **array fields** (available_beverages, available_toppings,
  available_dietary_options, suggested_amounts, external_links, event_tags) — model
  proposes the full new array; diff renders chips with +added / −removed.
- **co_hosts** — allow **removal / reorder only, never add** via NL (adding needs an
  email; avoids the known canEdit-without-email broken-dashboard footgun).
- **custom_url** — model may propose, but backend format + uniqueness validation is
  authoritative; rejection on apply surfaces as an inline error.
- **admin-only fields** (reimbursement_cap_usd, tax_form_required, protected `go`
  tag) — excluded from the catalog for non-admin requesters.

## Backend
1. `backend/src/lib/eventEditSchema.ts` — catalog + tool-schema/validator generators.
2. `backend/src/services/eventAssistant.service.ts` — build prompt (event context +
   tz + today), call `getOpenAI()` with `tool_choice` forcing
   `propose_event_changes`, validate, diff.
3. Route `POST /:id/assistant` mounted under `/api/parties` (mirror the payout
   pattern): path-scoped `requireAuth`, `canUserEditParty`, per-user rate limit
   ~30/hr (like the OCR limiter), instruction length cap + bounded conversation
   history for cost. Do **not** require `assertPartyApproved` (hosts edit
   pre-approval).
4. Response: `proposedChanges` as PATCH-ready
   `{ key, value, label, currentDisplay, proposedDisplay, reason }[]` plus optional
   `clarifyingQuestion` (a zero-change turn for ambiguous asks).

## Frontend
1. `EventAssistant.tsx` — chat-style box on the HostPage dashboard (above tabs).
   Input + send, assistant message bubble, a `ProposedChanges` card. Reuse
   `IconInput` for the input. Follow existing card/modal styling.
2. `ProposedChanges` — one row per change: label, `currentDisplay → proposedDisplay`,
   per-row toggle (default on, use `Checkbox`), reason on hover. Clarifying questions
   render as a normal assistant turn (conversation continues).
3. **Apply** — collect toggled-on `{ key: value }` into one object ->
   `updateParty(party.id, patch)` (the canonical path every tab uses) ->
   `mergeParty()` in place (NO `loadParty` reload) -> success toast.

## Guardrails
- LLM output never trusted directly; trusted write path unchanged.
- Never auto-applies — always host-confirmed.
- Rate-limited + input-capped for cost.
- Field-level auth preserved by reusing the existing PATCH.
- Prompt-injection surface (event description fed as context) is low-risk: output is
  schema-constrained and host-confirmed. Noted, not blocking.

## Deployment ordering (repo-specific)
Preview frontends call the **production** backend, so the new `/assistant` endpoint
must be merged + deployed to master before the dashboard box works on a preview
branch. Single PR, but verify the endpoint is live on prod backend before testing
the frontend preview URL. **No new DB columns** in v1.

## Out of scope (v1)
- `assistant_edit_log` audit table (clean Phase 2 add).
- Multi-turn memory beyond the current proposal.
- Image/flyer generation via NL.
- Bulk cross-event edits.

## Verification
- `cd backend && npx tsc --noEmit` and `cd frontend && npx tsc --noEmit` clean.
- Drift-guard unit test passes (catalog keys ⊆ backend PATCH whitelist).
- Manual on preview (after backend deploy): "rename to X, cap at 50, turn on
  approval, move to next Friday 7pm" → diff shows 4 rows with correct old→new in the
  event tz; toggling off one row excludes it; Apply persists only the kept changes
  and the dashboard updates in place without a reload.
