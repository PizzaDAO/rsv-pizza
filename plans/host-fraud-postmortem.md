# Host fraud postmortem (template)

Purpose: document each case where a host took money from PizzaDAO under false pretenses, so the red flags in the Host Fast Pass review assist are grounded in real cases. Copy this file per incident (`plans/host-fraud-postmortem-<yyyy-mm>-<city>.md`) or fill in the first one below.

Facts the team has not confirmed are left as `[TO FILL]`. Do not guess. Do not paste wallet addresses, bank details or personal data into this file; reference the payout id instead.

## 1. Summary

- Incident: Party in Africa, approx. US$600 paid out and lost (amount per Snax's recollection, unconfirmed)
- Date paid: [TO FILL]
- Date discovered: [TO FILL]
- How discovered: [TO FILL] (e.g. no photos, guest complaint, underboss, duplicate receipt)
- Total loss (USD): [TO FILL] (recollection: ~600)
- Recovered (USD): [TO FILL]
- Writer / date: [TO FILL]

## 2. Identifiers (reference only, no secrets)

| Item | Value |
|---|---|
| Party id / invite code | [TO FILL] |
| City / country | [TO FILL] |
| Host user id | [TO FILL] |
| Payout id(s) | [TO FILL] |
| Payout method (usdc_base / mercury_card / wire) | [TO FILL] |
| Approved by (admin role) | [TO FILL] |
| Underboss / region owner at the time | [TO FILL] |

## 3. Timeline

| When | What happened | Source |
|---|---|---|
| [TO FILL] | Host account created | [TO FILL] |
| [TO FILL] | Party created / submitted | [TO FILL] |
| [TO FILL] | Budget or reimbursement requested | [TO FILL] |
| [TO FILL] | Receipts uploaded | [TO FILL] |
| [TO FILL] | Payout approved | [TO FILL] |
| [TO FILL] | Payout executed | [TO FILL] |
| [TO FILL] | Problem noticed | [TO FILL] |

## 4. What the scam looked like

- Claimed event vs. what actually happened: [TO FILL]
- Receipts: fake / edited / reused / real but for a different event: [TO FILL]
- Photos submitted: none / stock / reused from another event / real: [TO FILL]
- RSVPs on the party page (count, how real they looked): [TO FILL]
- Payee (wallet or bank) relationship to other hosts: [TO FILL]
- Contact channel used with the team (Telegram, email, other): [TO FILL]
- Social engineering used (urgency, "pay before the event", pressure on a named person): [TO FILL]

## 5. Why it was not caught

- Which checks existed at the time: [TO FILL]
- Which check should have fired and did not: [TO FILL]
- Was this payout reviewed by a human, and what did they see: [TO FILL]
- Time pressure / backlog at the time: [TO FILL]

## 6. Red flags that would have caught it

Fill the "Was it present?" column from the facts above. The right-hand column is the Host Fast Pass review-assist flag id that now checks for it (admin-only, in `backend/src/lib/hostTrackRecord.ts`). If a flag was present in this case but no automated check exists, add it to section 8.

| Red flag | Why it matters | Was it present? | Automated flag |
|---|---|---|---|
| Brand-new host account | Fraud accounts are created just before the payout | [TO FILL] | `new_account` |
| First-ever party, no history | No track record to lean on | [TO FILL] | `first_party` |
| Prior parties but no photos from them | Prior events may not have happened | [TO FILL] | `no_prior_photos` |
| Party has zero or very few RSVPs | Nobody in the city knew about it | [TO FILL] | `no_rsvps`, `low_rsvps` |
| Same wallet / bank payee as another host | One person running several host identities | [TO FILL] | `shared_payee` |
| Receipt matches one already used on another party | Reused or recycled receipts | [TO FILL] | `reused_receipts` |
| Requested amount above the city cap | Padded request | [TO FILL] | `over_cap` |
| No receipts at all before payment | Paying on a promise | [TO FILL] | `no_receipts` |
| Earlier rejected payout, duplicate receipt or scam tag | Known bad history | [TO FILL] | `prior_issues` |
| City has no existing community / underboss / group | Nobody local can vouch | [TO FILL] | none yet (see section 8) |
| Payout requested before the event happened | Money out before any proof | [TO FILL] | none yet (see section 8) |
| Host pushed for speed or for a one-off payment channel | Pressure is a classic sign | [TO FILL] | none (human judgment) |

## 7. Impact

- Money lost: [TO FILL]
- Other parties by the same person/payee found afterwards: [TO FILL]
- Reputation / community impact: [TO FILL]
- Reported to (platform, exchange, bank, police): [TO FILL]

## 8. Follow-ups

- [ ] New automated flags to add (only if a real, checkable signal existed): [TO FILL]
- [ ] Threshold changes for Fast Pass (account age, parties required, receipt deadline): [TO FILL]
- [ ] Policy: require photos/receipts before payout for first-time hosts in [region]: [TO FILL]
- [ ] Block or tag the offending payee / host (use the `possible-scam` event tag so history flags them): [TO FILL]
- [ ] Recovery attempt owner and status: [TO FILL]

## 9. Rules this reinforces

- Fast Pass is earned from history only. A new host never gets a pre-approved budget without a written manual-review note, and never while a high-severity flag is open.
- Pre-approval is a commitment of budget, not a payment. Admins still approve every payout.
- Flag details are for admins only. Hosts see their progress toward the Fast Pass, not how fraud is detected.
