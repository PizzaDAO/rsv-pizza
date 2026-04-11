# sicilian-25988 — Pizza photos in Participating Pizzerias section

**Task ID:** sicilian-25988
**Priority:** TBD (likely P2 — polish/visual enhancement on top of the just-landed PR #119)
**Type:** Research + implementation plan
**Related:** PR #119 (`stuffed-crust-53468-pizzerias`) — added the Participating Pizzerias section with map + list. Still draft at time of writing.

---

## 1. Summary

The new **Participating Pizzerias** section on the public event page currently shows each pizzeria as a text-only card (red MapPin icon, name, rating, address, distance, phone, website). There are **no photos**. This plan investigates every realistic way to show pizza / pizzeria photos in that section and recommends a primary + fallback approach.

**Spoiler recommendation:** Add `places.photos` to the existing Google Places Nearby Search field mask in the `search-pizzerias` edge function, hydrate `photos[]` for Place Details-fetchable places via a new lightweight `pizzeria-photo` edge function (proxy + CDN-cache), and fall back to a generic pizza-illustration SVG when no photo is available. Zero new third-party accounts, near-zero marginal cost at current scale, minimal frontend surface.

---

## 2. Current state

### What renders today (PR #119)
- **File:** `frontend/src/components/ParticipatingPizzerias.tsx`
- **What it shows per pizzeria:** a 40x40 rounded-red `MapPin` icon (no image), name, rating badge, distance-from-venue, address, phone link, website link.
- **Map:** `frontend/src/components/ParticipatingPizzeriasMap.tsx` — red pins with name labels, blue venue pin.

### Data we already have
Looking at `frontend/src/types.ts` (lines 314-332), the `Pizzeria` interface **already declares** an optional `photos?: string[]` field. It's also mirrored in `supabase/functions/_shared/types.ts` (line 18). So the **data model is already primed** — we just never populate it. Zero TypeScript churn for adding photos.

### How pizzerias are stored
- **DB:** `parties.selected_pizzerias` is a `Json?` column on Prisma `Party` (`backend/prisma/schema.prisma` line 68). Stored as a JSONB array of Pizzeria objects.
- **API plumbing:** `selected_pizzerias` is in the `safeColumns` list and mapped by `dbPartyToParty` + `updateParty` (`frontend/src/lib/supabase.ts` lines 408, 469, 1300, 1347).
- **Key consequence:** **no DB migration is needed** to add photos to pizzerias. The 6-places gotcha does NOT apply — that's only for adding scalar columns on `parties`. Here we're stuffing another field into an already-JSONB blob.

### How pizzerias are discovered
Three flows, each sourcing pizzerias differently:

1. **Nearby autosuggest** — `PizzeriaSelection.tsx` calls `searchPizzerias(lat,lng)` → `supabase/functions/search-pizzerias/index.ts` → Google Places **Nearby Search (New)** with this field mask (line 39):
   ```
   places.id,places.displayName,places.formattedAddress,places.location,
   places.rating,places.userRatingCount,places.priceLevel,
   places.currentOpeningHours,places.nationalPhoneNumber
   ```
   **No `places.photos` field requested.** Each pizzeria gets a real `place.id` / `placeId` which can be used for follow-up Place Details or Place Photos requests.

2. **Custom add via autocomplete** — `PlaceAutocomplete.tsx` uses the **legacy** `google.maps.places.Autocomplete` JS widget (not the new web service). Its `fields` array does NOT include `'photos'`, but the legacy Autocomplete *does* support a `'photos'` field (returns a `PlacePhoto[]` with a `getUrl({maxWidth, maxHeight})` method). Place still gets a valid `place_id`.

3. **Custom add manual mode** — user types a name + address. **No `place_id`, no way to get a Google photo at all.** This is the only flow where we genuinely have no external photo source.

### What we're missing
- The `photos` field on the Pizzeria object is defined but never populated, never saved to `selected_pizzerias`, and never read by the ParticipatingPizzerias UI.
- No fallback image asset, no placeholder, no hero-image layout slot in the pizzeria card.

---

## 3. Options investigated

### Dimension legend
- **Source:** where photos come from
- **Auth:** API keys / accounts required
- **Cost:** per-request and free-tier specifics (April 2026 pricing)
- **Quality:** is it the actual pizzeria's food? Generic? User-submitted?
- **Freshness:** do they go stale?
- **License:** attribution / ToS restrictions
- **Effort:** rough LOC + infra
- **Risk:** privacy / legal / reliability concerns

---

### Option A — Google Places Photos (New)

| Dimension | Notes |
|---|---|
| **Source** | Google Places. Each Place object returned by Nearby Search / Place Details has a `photos[]` array when `places.photos` is in the field mask. Each photo has a `name` (opaque reference like `places/ChIJ.../photos/AWU5eFh...`) and `authorAttributions`. |
| **Auth** | Already configured: `GOOGLE_PLACES_API_KEY` secret in the `search-pizzerias` edge function. No new keys. |
| **Cost** | Two separate SKUs:<br>1. **Nearby Search Pro SKU** — triggered as soon as `places.photos` is included in the field mask (Google treats `photos` as a Pro-tier field). Pro SKU for Nearby Search is ~$32 per 1,000 requests in 2026 (up from the old ~$17/1k Essentials tier). We're likely on Essentials today since our field mask doesn't touch Pro fields.<br>2. **Place Photo (New) SKU** — ~$7 per 1,000 when we actually fetch the image bytes (or follow the redirect to the photo URL). Only charged when a photo is actually rendered.<br>**$200/mo free credit** covers approx 6,000 Nearby Pro + 28,000 Photo fetches, and we're nowhere near that today. |
| **Quality** | The photos array on a pizza restaurant is overwhelmingly **actual food photos of actual pizzas from that exact pizzeria**, plus some interior/exterior shots. Ordered by Google (best first). Typically 3-10 photos. Curated / moderated by Google. This is the highest-quality option for "show me a pizza from THIS pizzeria." |
| **Freshness** | Photos stay current — Google refreshes as users upload new ones. The `name` reference expires (Google recommends re-fetching the `name` from a recent Place Details / Search call before fetching the photo). The `photoUri` returned from a `photos.getMedia` call is **short-lived** (minutes) and **not cacheable** per ToS. |
| **License** | You **must display author attribution** (`authorAttributions.displayName` linking to `authorAttributions.uri`) proximal to the photo. Legacy API called this `html_attributions`; new API returns it inside each photo object. Photos **must not** be persisted / cached beyond short-term display caches per Maps Platform ToS section 3.2.3. Proxying through our edge function to bypass URL expiry while not persisting bytes is allowed (and common). |
| **Effort** | ~60-100 LOC total:<br>• Edge function: add `places.photos` to field mask (1 line) — but this upgrades the SKU to Pro, so confirm impact first. Extract `photos[0..2]` names + authorAttributions into the Pizzeria shape.<br>• New edge function `get-pizzeria-photo`: takes a `photoName` + max dimensions, forwards to `places.photos/{name}/media?skipHttpRedirect=true`, returns the short-lived `photoUri` (or streams the bytes). Cache-Control: public, max-age=3600. ~40 LOC.<br>• Frontend: `<PizzeriaPhoto />` component that hits `/functions/v1/get-pizzeria-photo?name=...` and shows an `<img>` with `loading="lazy"`, fallback on error. ~40 LOC.<br>• Modify `ParticipatingPizzerias.tsx` to render the photo + attribution. ~20 LOC. |
| **Risk** | ✅ We already use Google Places, so no new vendor onboarding. ⚠️ Adding `places.photos` to the Nearby Search field mask bumps the SKU from Essentials to Pro (~2x price per search). Mitigation: run a quick `sku-details` check in staging / check recent billing. ⚠️ Must not cache photo bytes — only metadata / short-lived URIs. ⚠️ Pizzerias from the **manual-entry flow** (no `place_id`) get no photo. |

**Verdict:** highest quality, lowest marginal cost (free credit), already integrated. **Strong primary candidate.**

---

### Option B — Yelp Fusion API (Business Photos)

| Dimension | Notes |
|---|---|
| **Source** | Yelp. `GET /businesses/{id}` returns up to 3 `photos[]` URLs (Plus plan) or 3+ (Enterprise). Requires matching our Google Place to a Yelp `business_id` via `/businesses/search?term&latitude&longitude` or `/businesses/matches`. |
| **Auth** | Need a new Yelp Fusion API key + a Yelp developer account. |
| **Cost** | **No free tier** as of 2026 — Yelp shut it down. Starter plan is 300 calls/day (trial), Plus plan (paid) unlocks photos (3 per business). Real production is ~$229/mo minimum for Plus. Each pizzeria = 2 API calls minimum (search + details). |
| **Quality** | Yelp photos are often high-quality, food-focused, and explicitly user-uploaded-with-intent-to-share. Plus plan caps at 3 photos per business. |
| **Freshness** | Stays fresh, same model as Google. |
| **License** | Must display "Powered by Yelp" attribution + link back to Yelp listing. Photos must not be cached > 24h. |
| **Effort** | ~200+ LOC: matching logic (Yelp IDs ≠ Google place IDs), new edge function, new secrets, new plan field mapping, new vendor billing. |
| **Risk** | ❌ Cost starts at hundreds per month. ❌ New vendor. ❌ Matching accuracy (fuzzy name+lat/lng) is imperfect for chains / foreign characters. ❌ Duplicates the responsibility we already have with Google. |

**Verdict:** redundant with Google for this use case, costs money, adds integration surface. **Rejected.**

---

### Option C — Instagram (by pizzeria handle)

| Dimension | Notes |
|---|---|
| **Source** | Instagram posts from a pizzeria's handle. |
| **Auth** | Instagram **Basic Display API was shut down December 4, 2024**. Only **Instagram Graph API** remains, which requires:<br>• A Facebook Page linked to a Business/Creator Instagram account<br>• **An access token from THAT specific account** (you can't read arbitrary handles without their consent)<br>• App review for anything beyond the owner's own content. |
| **Cost** | Free (if we could use it), but effectively unusable for third-party pizzerias. |
| **Quality** | Excellent when available — literally curated by the pizzeria. |
| **Freshness** | Live. |
| **License** | Meta ToS prohibits scraping. No official API for reading arbitrary public Instagram handles. |
| **Effort** | N/A. |
| **Risk** | ❌ No legal API path for reading third-party handles. ❌ Scraping violates ToS, breaks with every Instagram HTML change, risks IP bans. |

**Verdict:** **Rejected** — no legal API path exists for our use case.

---

### Option D — Pizzeria website scraping (og:image)

| Dimension | Notes |
|---|---|
| **Source** | Scrape the `url` field on the Pizzeria object (if present), fetch the HTML, parse `<meta property="og:image">` / `<meta name="twitter:image">`. |
| **Auth** | None. |
| **Cost** | Free (bandwidth-only). |
| **Quality** | Wildly variable. Many small pizzeria sites use a logo as og:image, not a pizza photo. Some use stock photos. Some have no og:image. Some are WordPress sites with giant hero images. Estimated hit rate for "actual pizza photo from this pizzeria": 30-50%. |
| **Freshness** | Stays fresh whenever their site updates. |
| **License** | Gray area. og:image is meant for social sharing so displaying it with attribution (a link to their site) is generally accepted, but it's not a bulletproof license grant. Some sites will block scrapers via Cloudflare / bot-detection. |
| **Effort** | ~80 LOC for an edge function scraper (fetch HTML, parse meta tags with regex or a tiny parser, return the resolved URL). Need to handle relative URLs, redirects, timeouts, 4xx/5xx. |
| **Risk** | ⚠️ Unreliable (scraper breaks silently). ⚠️ Inconsistent quality. ⚠️ Introduces our edge function as a request proxy for arbitrary URLs (server-side request forgery / SSRF surface — need URL allowlist or same-origin checks). ⚠️ Some pizzerias have no `url`. ⚠️ Attribution unclear — linking to their site is the right courtesy but may not be legally sufficient. |

**Verdict:** decent **second-tier fallback** for pizzerias that have a `url` but no Google photo. Worth considering as a supplement, not a primary. Risk/value ratio is meh.

---

### Option E — Manual upload by host

| Dimension | Notes |
|---|---|
| **Source** | Host uploads 1-3 photos per pizzeria in the Pizza & drinks tab. |
| **Auth** | None (uses existing Supabase auth + `event-images` bucket). |
| **Cost** | Free (storage is already in Supabase plan; 10MB limit per photo already enforced elsewhere). |
| **Quality** | Whatever the host provides — potentially the best ("here's the pie I tried last week") or worst ("I'll skip it"). |
| **Freshness** | Manual. |
| **License** | Host is attesting they have the right to upload (same as existing event photos, sponsor logos, etc.). |
| **Effort** | ~150 LOC: UI in `PizzeriaSelection.tsx` (photo picker per selected pizzeria), wiring to a new `uploadPizzeriaPhoto()` helper in `lib/supabase.ts` (clone of `uploadSponsorLogo`), store URLs in the pizzeria JSON blob, render in card. |
| **Risk** | ✅ Full control, ✅ no external API, ⚠️ friction for hosts (they have to remember to upload), ⚠️ hosts already have a lot to do when setting up an event. |

**Verdict:** **Great as a complementary override** — let hosts replace an auto-fetched Google photo if they want. Not great as the *only* source because of friction.

---

### Option F — Foursquare Places API

| Dimension | Notes |
|---|---|
| **Source** | Foursquare Places API — `/places/{fsq_id}/photos` endpoint. |
| **Auth** | New Foursquare developer account + API key. |
| **Cost** | **Photos are a Premium endpoint — NO free tier.** Starts at $18.75 per 1,000 calls. Free tier (10K/mo → 500/mo from June 2026) only covers "Pro" endpoints, not Premium. |
| **Quality** | Generally good — Foursquare has a history of rich food/venue photos from their check-in days. Quality is comparable to Google but smaller dataset for small / neighborhood pizzerias. |
| **Freshness** | Stays fresh. |
| **License** | Requires "powered by Foursquare" attribution. |
| **Effort** | ~150 LOC: matching (Google place → Foursquare fsq_id via `/places/search?ll=...&query=...`), new edge function, new secrets. |
| **Risk** | ❌ No free tier for photos. ❌ New vendor. ⚠️ Coverage is weaker than Google for small independent pizzerias. |

**Verdict:** redundant with Google, costs money. **Rejected.**

---

### Option G — Unsplash generic pizza search (fallback)

| Dimension | Notes |
|---|---|
| **Source** | Unsplash search API, query "pizza" (or "neapolitan pizza", "wood fired pizza" — rotated). |
| **Auth** | Free Unsplash developer account + API key. Demo mode = 50 requests/hour; production (after approval) = 5,000/hour. |
| **Cost** | Free. |
| **Quality** | Beautiful, professional stock pizza photos. **NOT pizzeria-specific.** Every event with a fallback photo will look the same. Won't help users recognize "oh that's the pizza from X". |
| **Freshness** | N/A (generic). |
| **License** | Free to use with **photographer attribution** (display name + link to their Unsplash profile). |
| **Effort** | ~30 LOC if we already pick a fixed set of ~20 photos at build-time and bundle them; ~80 LOC if we do a runtime API call per pizzeria without a photo. |
| **Risk** | ⚠️ Every pizzeria that lacks a real photo looks identical → diminishes the "Participating Pizzerias" section visual distinctiveness. ⚠️ Attribution text clutters each card. |

**Verdict:** worse than a simple static SVG illustration for the "no photo available" case. An illustrated placeholder is more tasteful and attribution-free. **Rejected** (but see "Hybrid fallback" in §6).

---

### Comparison table (summary)

| Option | Cost | Quality | Specificity | Effort | Risk | Primary? |
|---|---|---|---|---|---|---|
| **A. Google Places Photos (New)** | ~$7/1k photos + Pro-tier Nearby Search upgrade; covered by free credit at our scale | High | Pizzeria-specific | Low (60-100 LOC) | Low | ✅ YES |
| **B. Yelp Fusion** | $229+/mo minimum | High | Pizzeria-specific | Medium (200+ LOC) | High (cost, vendor) | ❌ |
| **C. Instagram** | Free but no API path | Excellent when available | Pizzeria-specific | N/A | ❌ Impossible legally | ❌ |
| **D. Website og:image scrape** | Free | Variable (30-50% hit) | Partially specific | Medium (80 LOC) | Medium (SSRF, unreliable) | 🤷 Fallback candidate |
| **E. Host manual upload** | Free | Host-controlled | Fully specific (if they bother) | Medium (150 LOC) | Low | ✅ YES (as an override, not primary) |
| **F. Foursquare** | $18.75/1k photo calls | Good | Pizzeria-specific | Medium (150 LOC) | High (cost, vendor) | ❌ |
| **G. Unsplash fallback** | Free | Professional but generic | ❌ Not specific | Low | Low | ❌ (static SVG is better) |

---

## 4. Recommendation

### Primary: **Google Places Photos (Option A)** with a lightweight proxy edge function.

**Rationale:** We already use Google Places for Nearby Search, so there's zero new vendor integration. Google Places photos are the highest-quality, most-pizzeria-specific, and most-cost-effective option. The `photos?: string[]` field is already declared on the Pizzeria type. At our current scale (hundreds of events/month, each with ≤3 pizzerias) the free $200/mo Maps credit more than covers Place Photo fetches.

### Secondary (host override): **Manual upload (Option E)**

Add a small photo-picker on each selected pizzeria card in `PizzeriaSelection.tsx`. When a host uploads a photo, store the URL in the pizzeria's `photos[0]` (prepended, so it wins over the Google photo). Useful for chains, remote areas with poor Google coverage, or hosts who want to use a specific signature pie.

### Fallback (no photo at all): **Static SVG illustration**

When a pizzeria has no Google photo AND no host upload AND no Place ID (manual-entry flow), render a stylized pizza SVG (or just the existing red MapPin icon in a larger hero-image container). No external API, no attribution clutter, consistent visual identity.

### Rejected as primary: og:image scraping

Briefly considered as a mid-tier fallback (between Google photo and SVG) for manual-entry pizzerias that have a `url`. **Decision: skip it for v1** — unreliable hit rate and SSRF surface not worth the incremental coverage. Revisit later if host feedback says "I added my favorite spot manually and it has no photo — why?"

---

## 5. Implementation sketch

### 5.1 Backend / edge function changes

**(a) `supabase/functions/search-pizzerias/index.ts`**

Add `places.photos` to the `X-Goog-FieldMask` header:

```
places.id,places.displayName,places.formattedAddress,places.location,
places.rating,places.userRatingCount,places.priceLevel,
places.currentOpeningHours,places.nationalPhoneNumber,
places.photos
```

In the `.map()` over `data.places`, extract the first 1-3 photo names + author attributions into a new shape:

```typescript
photos: (place.photos || []).slice(0, 3).map((p: any) => ({
  name: p.name, // e.g. "places/ChIJ.../photos/AWU5eFh..."
  widthPx: p.widthPx,
  heightPx: p.heightPx,
  authorAttributions: p.authorAttributions || [],
}))
```

**⚠️ IMPORTANT:** this upgrades the Nearby Search SKU from Essentials to Pro. Confirm with Snax that the cost bump (~2x per search) is acceptable. With ~20 searches/event × ~200 events/mo = 4,000 searches/mo, Pro-tier cost is ~$128/mo (still covered by free credit) vs ~$68/mo Essentials.

**(b) New edge function `supabase/functions/pizzeria-photo/index.ts`**

Thin proxy + caching wrapper. Accepts a `photoName` query param, validates it's a Google Places photo name format (`places/[^/]+/photos/[^/]+`), calls:

```
GET https://places.googleapis.com/v1/{photoName}/media?maxHeightPx=400&maxWidthPx=400&skipHttpRedirect=true
X-Goog-Api-Key: GOOGLE_PLACES_API_KEY
```

Returns the resolved `photoUri` (JSON) OR 302-redirects to it (simpler). Response headers: `Cache-Control: public, max-age=3600` (1hr — safely under the undocumented photoUri TTL but long enough to batch-hit for a page load).

**Note:** we must NOT persist the photo bytes. We proxy-redirect or proxy-stream but don't cache to Supabase storage.

### 5.2 Data model changes

**None to Postgres / Prisma.** Pizzerias are stored as a JSONB blob on `parties.selected_pizzerias`, so we're just adding a new optional field to the in-blob shape.

**TypeScript:** change `photos?: string[]` on the Pizzeria interface to something richer:

```typescript
interface PizzeriaPhoto {
  name: string; // Google Places photo resource name (for refetching via proxy)
  authorAttribution?: { displayName: string; uri: string };
  // For host-uploaded photos, name is a Supabase public URL and no attribution is needed.
  // Distinguish with a 'source' field:
  source: 'google' | 'host-upload';
}
interface Pizzeria {
  ...
  photos?: PizzeriaPhoto[];
}
```

Update both copies: `frontend/src/types.ts` and `supabase/functions/_shared/types.ts`.

### 5.3 Frontend component changes

**(a) `frontend/src/components/PizzeriaPhoto.tsx` — NEW**

~40 LOC. Props: `photo: PizzeriaPhoto | undefined`, `pizzeriaName: string`, `className?: string`.

- If `photo.source === 'host-upload'`: render `<img src={photo.name} />` directly (Supabase URL).
- If `photo.source === 'google'`: render `<img src={`${SUPABASE_URL}/functions/v1/pizzeria-photo?name=${encodeURIComponent(photo.name)}`} />`. Show the author attribution in tiny text below (`text-[10px] text-white/40`).
- On error: render the fallback SVG placeholder.
- If `photo` is undefined: render the fallback SVG placeholder.
- `loading="lazy"` always.

**(b) `frontend/src/components/ParticipatingPizzerias.tsx`**

Redesign the pizzeria card. Current: horizontal flex with a 40x40 icon on the left. New:

- **Option 1 (hero):** Full-width photo on top (aspect ratio ~16:9 or 3:2, ~140px tall), pizzeria info overlaid on bottom with gradient, or below the photo as a card body.
- **Option 2 (thumbnail):** Square thumbnail on the left (w-20 h-20 instead of w-10 h-10), current text on the right.

**Recommendation: Option 2 (thumbnail).** Lower visual risk, matches existing design language, keeps the section compact when there are 3 pizzerias. Hero-image mode can be a future v2 if Snax wants more "wow" factor.

Render the first photo (`pizzeria.photos?.[0]`) via `<PizzeriaPhoto />`.

**(c) `frontend/src/components/PizzeriaSelection.tsx` (host side)**

Add a small "Upload photo" button on each selected pizzeria row (similar to the existing X / Order buttons). Opens a file picker. On upload: call a new `uploadPizzeriaPhoto(file, partyId, pizzeriaId)` helper (clone of `uploadSponsorLogo`), get back a Supabase URL, prepend `{ name: url, source: 'host-upload' }` to the pizzeria's `photos` array, save via `savePizzerias`.

Also show the existing photo (Google or host-uploaded) as a thumbnail next to the pizzeria name so the host can see what the public page will show.

**(d) `frontend/src/components/PlaceAutocomplete.tsx`**

Add `'photos'` to the legacy Autocomplete `fields` array. When `place.photos` is present, map each `PlacePhoto` to our shape via `{ name: photo.getUrl({ maxWidth: 800 }), source: 'google' }`. **Caveat:** legacy Autocomplete's `getUrl` returns a URL string directly (NOT a resource name), so for custom-added pizzerias the photo URLs are pre-resolved and will expire on roughly the same TTL. Acceptable for v1 — we'll re-fetch on the next event load if the user revisits the host page and resaves.

Better long-term: when a custom pizzeria is added, save the `place_id` AND use the proxy edge function to fetch a fresh name on demand. But that means calling Place Details from our edge function for every render, which defeats the point. For now, just save the expiring URL and re-save when stale.

### 5.4 Storage / caching strategy

- **Google photos:** served via our edge function proxy → redirects to Google's short-lived `photoUri`. `Cache-Control: public, max-age=3600` on the redirect. Browser caches the image bytes for 1hr. Supabase edge function itself is cheap ($ per invocation, free tier covers us). **We never persist photo bytes.**
- **Host-uploaded photos:** stored in the existing `event-images` bucket under `pizzeria-photos/{party_id}/{pizzeria_id}/{timestamp}.{ext}`. Public URLs stored directly in the pizzeria's `photos[]` array (already public per existing bucket policy).
- **Photo `name` staleness:** when the host loads the event page, the pizzeria JSON blob might contain Google photo names that are weeks/months old. If the edge function gets a 404/400 from Google, return 404 to the client, and `<PizzeriaPhoto />` falls through to the placeholder. A future enhancement could auto-refresh stale names by re-calling Place Details on a cron, but that's not v1.

### 5.5 Fallback handling

Order of precedence in `<PizzeriaPhoto />`:
1. `photos[0]` where `source === 'host-upload'` (host explicitly overrode)
2. `photos[0]` where `source === 'google'` (fetched from Google)
3. Static SVG placeholder (`frontend/src/assets/pizza-placeholder.svg`) — tasteful illustrated pizza, no attribution needed

---

## 6. Open questions for Snax

1. **Cost ceiling** — are we OK with the Nearby Search SKU bumping from Essentials (~$17/1k) to Pro (~$32/1k) once `places.photos` is in the field mask? At current scale this stays well under the free credit, but worth a sanity check before merging.
2. **Card layout** — thumbnail (Option 2) vs hero image (Option 1)? The plan recommends thumbnail for v1; hero can be a v2. Want to confirm before building.
3. **Host upload flow** — should the host upload feature ship in v1 alongside Google photos, or v2 after we see how good the Google photos look in practice? (Plan assumes v2; the primary win is Google photos automatically appearing.) Alternatively, we could ship both and let hosts override from day one.
4. **Attribution placement** — Google requires the author attribution be "proximal to the image". The plan suggests tiny text (10px) below the photo. Is that acceptable visually, or do we want a tooltip / info icon instead?
5. **Static placeholder design** — do we want a custom SVG illustration (~30min to design or source from Heroicons / Phosphor / custom), or just scale up the existing MapPin icon? Lean toward SVG illustration for the visual improvement to be worth shipping at all.
6. **Manual-entry pizzerias** — these have no `place_id` and no website in many cases. Ship them with only the SVG placeholder? Or require a host upload for those to appear in the section?
7. **Photo count per pizzeria** — v1 recommends **one hero photo per pizzeria** (the first one Google returns). Future: a carousel / lightbox showing 3-5. Confirm v1 is single-photo-only.
8. **`google.maps.places.Autocomplete` (legacy) is deprecated** — Google is migrating to `PlaceAutocompleteElement`. This is orthogonal to this plan but worth flagging: the legacy widget is on a sunset path and any future photo work on `PlaceAutocomplete.tsx` may need a rewrite anyway.

---

## 7. Gotchas

1. **Pro SKU trigger.** The moment `places.photos` appears in the field mask, Nearby Search jumps from Essentials to Pro. There's no way to "just peek at photos at Essentials price." Audit billing after first deploy.
2. **Photo `name` vs `photoUri`.** The `name` (e.g. `places/.../photos/...`) is what we save long-term. The `photoUri` returned by `photos.getMedia?skipHttpRedirect=true` is **short-lived** (minutes) and must be re-fetched on every page load. Never save `photoUri` to the DB.
3. **Legacy vs New API mismatch.** `PlaceAutocomplete.tsx` uses the legacy `google.maps.places.Autocomplete` (JS, browser-side), whose photo object has a `.getUrl()` method returning a pre-resolved URL — NOT a resource name. These URLs also expire. Either:
   - Save the expiring URL and accept refresh churn.
   - Save the `place_id` and re-fetch on the server side via Place Details (New) to get fresh photo names. Adds ~1 extra API call per custom-add, worth it for durability.
4. **Maps Platform ToS section 3.2.3 — no caching.** We can cache metadata (photo names, attributions) indefinitely; we can cache the resolved `photoUri` / image bytes only very short-term (an hour, a session). Our edge function must NOT save image bytes to Supabase storage.
5. **Attribution must be displayed proximal to the image.** Not buried in a footer. A tooltip or tiny text beneath the image is acceptable. Must include the photographer/contributor name AND link to their profile (`authorAttributions.uri`).
6. **SSRF / URL validation in the proxy function.** Even though we only hit Google's API, the proxy function must strictly validate the input `photoName` against the `^places/[^/]+/photos/[^/]+$` format before concatenating into a URL. Otherwise someone can make our edge function fetch arbitrary internal URLs.
7. **CORS.** The new `pizzeria-photo` edge function needs the same CORS headers as `search-pizzerias` (wide-open Origin) so that `<img src>` works cross-origin without canvas taint.
8. **Preview deploys share production backend.** Because preview frontends talk to the production backend, the new `pizzeria-photo` edge function and the updated `search-pizzerias` field mask must be **deployed to production first** (via `supabase functions deploy`) BEFORE the frontend branch merges. Otherwise preview frontends calling the new function will 404. This matches the existing gotcha documented in `CLAUDE.md`.
9. **`photos?: string[]` type change is a breaking change to the Pizzeria shape.** Old pizzerias in the DB have no photos; that's fine. But if anything else in the codebase reads `pizzeria.photos as string[]`, it will break. `grep` the monorepo for `.photos` accesses on Pizzeria to make sure nothing else depends on the old shape. (Initial scan: nothing does — it's declared but never populated.)
10. **Host-upload image dimensions.** Use the existing `getImageDimensions` helper from `uploadEventPhoto`. Enforce 10MB max (matches `event-images` bucket limits). Validate MIME types (jpeg/png/webp).
11. **Google photo SKU per-image-bytes vs per-request.** The $7/1k SKU charges per `photos.getMedia` call, NOT per unique photo. If the same photo is fetched 100 times because we don't cache well, that's 100 billing events. Hence the edge function's `Cache-Control: public, max-age=3600` is important.
12. **Event page render count.** Each event page load with 3 pizzerias = 3 photo fetches. At 1,000 views/event and 200 events/month = 600,000 photo fetches/mo = ~$4,200/mo at list price. This is where the 1hr browser cache matters — with a high cache hit rate (repeat visitors, back-button navigations) the actual billable fetches drop by 5-10x. Still, **watch billing after launch and consider upping `max-age` to 6-24hrs** if ToS allows. (Per Google's own blog posts, short-term caching for performance is acceptable; long-term is not.)

---

## 8. Estimated total effort

| Phase | LOC | Effort |
|---|---|---|
| Edge function — `search-pizzerias` field mask update | ~15 | 10 min |
| Edge function — new `pizzeria-photo` proxy | ~60 | 1 hr |
| TypeScript type updates (2 files) | ~20 | 10 min |
| Frontend — `PizzeriaPhoto.tsx` | ~60 | 45 min |
| Frontend — `ParticipatingPizzerias.tsx` layout update | ~30 | 30 min |
| Frontend — `PlaceAutocomplete.tsx` photo field | ~15 | 15 min |
| SVG placeholder asset | ~5 | 15 min |
| (v2) Host upload in `PizzeriaSelection.tsx` | ~150 | 2 hrs |
| **Total v1 (Google only)** | **~205** | **~3 hrs** |
| **Total v2 (+ host upload)** | **~355** | **~5 hrs** |

---

## 9. Deployment checklist (for the implementation agent)

- [ ] Deploy updated `search-pizzerias` edge function to production (`npx supabase functions deploy search-pizzerias --project-ref znpiwdvvsqaxuskpfleo`)
- [ ] Deploy new `pizzeria-photo` edge function to production
- [ ] Verify Google Places API key has "Places API (New)" AND "Place Photos (New)" both enabled in GCP Console
- [ ] Smoke-test the proxy: `curl "https://znpiwdvvsqaxuskpfleo.supabase.co/functions/v1/pizzeria-photo?name=places/XXX/photos/YYY" -I` returns 302 to a `lh3.googleusercontent.com` URL
- [ ] Open Vercel preview for the PR branch, pick a real pizzeria with photos on Google, save it on a test event, verify the photo renders on the public event page
- [ ] Check billing dashboard 24hrs after launch for unexpected SKU changes
- [ ] Add a ToS-compliant fallback message if Google photos 404 (graceful degrade to SVG placeholder, no error banner)

---

## 10. Out of scope for this task

- Photo carousel / lightbox per pizzeria (v2)
- Automatic refresh of stale Google photo names via cron (v2)
- og:image scraping fallback (considered, rejected for v1)
- Video support (Google Places doesn't return video; not a goal)
- Moderation of host-uploaded pizzeria photos (existing `photoModeration` flag is for guest event photos, not pizzeria cards)
- Showing multiple photos per pizzeria on the map InfoWindow (v2)
