# DRAFT spec: standalone tax-form page (`/tax-form`)

Status: approved by Snax 2026-10-18 (task calzone-70821).

## Why
Rare Pizzas has to collect W-9 / W-8BEN / W-8BEN-E forms from 64 past payees for its late 1099 filings (crew, artists, hosts and bank-paid vendors). Today rsv.pizza only collects tax forms inside the payout flow (`TaxFormSection` on `NewPayoutForm`). Most of these payees will never open that flow. We need one link per payee that collects the form directly.

## Goal
- A page at `https://rsv.pizza/tax-form?payee=<token>`, outside the event and payout flow.
- The token identifies one payee request, made by **Rare Pizzas** (the requester entity).
- The payee picks a form type, fills it in, signs and submits. The PDF goes to the existing **private `tax-forms` bucket** through `uploadTaxFormPdf`.
- Admins can see each request's status: not opened, draft, submitted, verified or rejected.

## Reuse (don't rebuild)
- Frontend:
  - `components/payouts/tax/TaxFormPicker.tsx`, `W9Form.tsx`, `W8BENForm.tsx`, `W8BENEForm.tsx`, `CountryPicker.tsx`
  - `TaxFormSection.tsx`'s state machine (pick, edit, review, submit). Pull it into a hook or wrapper that takes an API adapter, so it works with the user API (`/api/tax-forms/*`) and the token API below.
  - `Layout`, `IconInput`, `Checkbox` per CLAUDE.md
- Admin: `components/payments-admin/TaxFormReviewPanel.tsx` (takes `taxFormId`), plus the existing verify/reject endpoints.
- Backend:
  - `services/taxFormPdf.service.ts` (generate*PDF)
  - `services/taxFormStorage.service.ts` (`uploadTaxFormPdf`, `getSignedTaxFormUrl`)
  - The validation and serialize helpers in `routes/tax-form.routes.ts`. Factor out the draft/submit core so `req.userId` becomes a parameter.

## Data model
`tax_forms.user_id` is NOT NULL and many payees have no rsv.pizza account. Add a request table and keep `tax_forms` as the single store:

```
tax_form_requests
  id uuid pk
  token text unique          -- random 32+ bytes, url-safe; the link secret
  requester text             -- 'rare_pizzas' (enum/check; future: 'pizzadao')
  payee_label text           -- display name, e.g. "Don Malbec"
  payee_email text null
  payee_wallet text null     -- lowercased
  payee_handle text null     -- discord/telegram
  suggested_form_type text null  -- w9|w8ben|w8bene hint
  tax_year_note text null    -- e.g. "2021-2026 payments"
  user_id text null fk User  -- set if/when linked to an account
  tax_form_id uuid null fk tax_forms  -- latest form for this request
  status text                -- 'sent'|'opened'|'draft'|'submitted'|'verified'|'rejected'
  opened_at, submitted_at, created_at, updated_at timestamptz
  revoked_at timestamptz null
```

Change `tax_forms.user_id` to nullable and add `tax_forms.request_id uuid null fk`. Add a CHECK that `user_id` or `request_id` is set. Storage path: `requests/{requestId}/{formType}-{ts}.pdf`, so `uploadTaxFormPdf` needs an owner-key parameter instead of only a userId. Copy the migration patterns from `migrations/` (RLS on, no public access, backend-only via service role).

## API
Public, token-authed and rate-limited (the token is the credential; never expose other payees' data):
- `GET  /api/tax-form-requests/:token`: returns `{ payeeLabel, requester: 'Rare Pizzas', suggestedFormType, status, currentDraft? }` and stamps `opened_at`. Never returns `form_data` for submitted forms, and never returns TINs.
- `POST /api/tax-form-requests/:token/draft`: same body as `/api/tax-forms/draft`.
- `POST /api/tax-form-requests/:token/submit`: same as `/api/tax-forms/submit`. Generates the PDF, uploads it to the private bucket and sets the request to `submitted`. Lock the token after submit; the payee can only resubmit if an admin rejects the form.
- If the visitor is logged in, also set `user_id` on the request and the form. This lets `getLatestSubmittedTaxFormForUser` reuse the form in the payout gate later.

Admin (`requireAnyAdmin`, under `/api/admin/tax-form-requests`):
- `POST /` creates one request or a bulk CSV of requests (label, email, wallet, handle, suggested type) and returns the links.
- `GET /?requester=rare_pizzas&status=` lists requests with status and dates. Metadata only.
- `POST /:id/revoke` and `POST /:id/regenerate-token`.
- Verify and reject reuse `/api/admin/tax-forms/:id/verify|reject`. Mirror the status onto the request.

## Frontend
- Route `/tax-form` in `App.tsx` (public, no login required), page `pages/TaxFormRequestPage.tsx`.
  - Header: "Rare Pizzas is requesting a tax form for payments made to you." Show the payee label.
  - Picker, then the form editor, then sign and submit. The success screen says "Thanks, Rare Pizzas has your form." It shows no PDF link and no TIN echo.
  - States: invalid or revoked token, already submitted (locked), rejected (show `rejected_reason`, allow a resubmit).
- Admin: a "Tax form requests" tab or section in the payments admin.
  - A table with payee, requester, channel or contact, status, opened, submitted and form type.
  - Copy-link button and CSV import.
  - Clicking a row opens `TaxFormReviewPanel`.
  - Export a status CSV with no form contents, for Sam's finance tracker.

## Security
- Token: 256-bit random, compared in constant time, revocable. Rate-limit the GET and POST routes by IP and token.
- Keep PDFs in the private bucket with signed URLs only (the same rule as salame-92110). Never log `form_data`.
- No TIN in any API response except the admin detail endpoint, which already exists and is gated.
- Record the signer's IP and user agent with `signed_at` for the audit trail (optional, check with Sam).

## Out of scope
1099 generation, the W-8 expiry cron, emailing or DMing links from the app (Sam sends them by hand for now).

## Acceptance
1. An admin bulk-creates requests from `w9-request-list.csv` and gets 64 links.
2. A logged-out payee opens a link, submits a W-9, and the PDF lands in `tax-forms/requests/...`. The request shows `submitted` in admin.
3. An admin verifies the form through `TaxFormReviewPanel` and the request shows `verified`.
4. A revoked or invalid token shows an error page and leaks no payee data.
5. The existing payout-flow `TaxFormSection` still works (regression check).
