# sfoglia-58543 — /photos type selector (group/pizza) + /photos/play slideshow thumbs-up

## Goal
Two related enhancements to the public Photos feature (both layer on top of the already-merged
crespelle-58543 slideshow + cannoli-58292 year selector, all on `master`):

1. **Slideshow thumbs-up** — add a working thumbs-up (vote) button to the `/photos/play` fullscreen
   slideshow (`PhotosSlideshowPage.tsx`), reusing the existing end-to-end vote feature
   (salame-58195 / napoletana-58210). Frontend-only, works on preview immediately.
2. **Type selector on /photos** — add a "Type" filter to the `/photos` feed filter bar that filters
   photos by `payout_role` (`group` / `box_stack` / `pizza`). Requires a backend feed change +
   frontend wiring.

## Base
Fresh branch off `origin/master`. Branch name: `sfoglia-58543-photos-type-vote`.
Do NOT reuse the recycled agent worktree — branch clean from master.

## Important caveats (read before implementing)
- **`payout_role` semantics**: it's a *single designated photo per role per event* (partial unique
  index on `(party_id, payout_role)`), used to gate payout submission — not a category on every
  uploaded photo. Values: `'group' | 'box_stack' | 'pizza'` (see `schema.prisma` Photo model,
  `RolePhotoPicker.tsx:9`).
- **Feed intersection**: the feed only surfaces `photos WHERE starred = true AND status = 'approved'`.
  A photo's `payout_role` is set independently of starring, so the type filter shows only starred
  photos that ALSO have a role. Expect sparse results for many year/type combos. This is expected /
  accepted scope — note it on the PR.
- **Backend deploy ordering**: the `type` query param is a NEW backend param. Preview branches share
  the PROD backend, which won't understand `type` until this merges to `master` (backend auto-deploys
  from master). So on the preview URL the Type filter will appear to do nothing (prod ignores the
  unknown param and returns unfiltered) until merge. The slideshow thumbs-up (frontend-only) works on
  preview right away. Call this out in the PR description.
- No DB migration needed (`payout_role` column already exists).

---

## Part 1 — Slideshow thumbs-up (frontend only)

File: `frontend/src/pages/PhotosSlideshowPage.tsx`

Mirror the existing vote logic from `PhotosFeedPage.tsx` `FeedLightbox` (lines ~908-923, 963-977):
1. Imports: add `ThumbsUp` from `lucide-react`; add `togglePhotoVote, togglePayoutPhotoVote` from
   `../lib/api`; add `useAuth` from `../contexts/AuthContext`.
2. State: `const { user } = useAuth();` and `const [voting, setVoting] = useState(false);`
3. `handleVote` (source-aware, same dispatch as the lightbox):
   ```ts
   const res = current.source === 'payout' && current.payoutId
     ? await togglePayoutPhotoVote(current.payoutId, current.id)
     : await togglePhotoVote(current.party.id, current.id);
   ```
   On success, update the loaded deck so the count/fill persist:
   `setPhotos(prev => prev.map(p => p.id === current.id ? { ...p, voteCount: res.voteCount, votedByMe: res.voted } : p));`
   Guard `if (!current || voting) return;` and no-op for anon (`!user`) — the slideshow has no lightbox
   to defer to, so for anon just disable the button (show count, `cursor-not-allowed`, title "Log in to vote").
4. Button placement: bottom-right control cluster next to Pause/Play (lines ~191-199). Add a pill/icon
   button styled like the existing overlay controls (`bg-black/40 hover:bg-black/70 text-white`,
   `rounded-full`), showing `<ThumbsUp>` (filled white when `current.votedByMe`) + `current.voteCount`.
   Keep it visually consistent with the existing exit / pause controls. Guard render on `photos.length > 0 && current`.
5. Don't let the button clicks bubble to any pause toggle; `e.stopPropagation()`.

No backend/API change — `getPhotosFeed` already returns `voteCount`/`votedByMe`/`source`/`payoutId`.

## Part 2 — Type selector on /photos

### 2a. Backend — `backend/src/routes/photo-feed.routes.ts`
- Parse the new param near the other filters in `GET /feed` (and in the ZIP `GET /feed/download`
  handler): `const roles = parseCsv(req.query.type).filter(r => ['group','box_stack','pizza'].includes(r));`
- **Newest handler** (raw UNION SQL, ~line 268): add a parameter-bound fragment
  `const roleFilter = roles.length > 0 ? Prisma.sql\`AND p.payout_role = ANY(${roles}::text[])\` : Prisma.empty;`
  Insert it in the **photos** SELECT WHERE block (alongside `regionFilter`/`countryFilter`/`partnerTagFilter`,
  ~line 305-307). For the **payout_documents** UNION side (which has no `payout_role`): when
  `roles.length > 0`, gate it — include it only if `'pizza' ∈ roles`, else add `AND FALSE`
  (it's "effectively empty in practice" per the napoletana-58211 comment, so this is mostly defensive).
- **Random handler** `handleRandomFeed` (~line 419): thread `roles` through `opts`, build the same
  `roleFilter`, and add it to the ids query WHERE (~line 468-470). Random mode already skips the payout union.
- **ZIP download handler** (`GET /feed/download`): apply the same `roleFilter` for parity so a filtered
  ZIP matches the on-screen filter. Find it and mirror the fragment.
- No change to `FeedItem` shape or the JSON response — this is filter-only, not a new output field.

### 2b. Frontend API — `frontend/src/lib/api.ts`
- Add `type?: string[];` to the `PhotosFeedFilters` interface (~lines 6750-6761).
- In `getPhotosFeed` (~6763-6797), append `type` as a CSV query param when non-empty
  (mirror how `regions`/`countries` are serialized).

### 2c. Frontend page — `frontend/src/pages/PhotosFeedPage.tsx`
Follow the `activeYear` / `YearFilterButton` pattern exactly (it's the closest analog), but multi-select
(like `RegionFilterButton`) since a user may want group OR pizza:
- State: `const [activeType, setActiveType] = useState<string[]>(() => parseCsvParam(searchParams.get('type')));`
- Ref: `const typeRef = useRef(activeType); typeRef.current = activeType;`
- URL sync effect: `if (activeType.length > 0) next.set('type', activeType.join(','));`
  (add `activeType` to the effect dep array).
- `loadPage` filters object: add `type: typeRef.current`.
- `filterKey` memo: append `|${activeType.slice().sort().join(',')}` and add `activeType` to deps.
- `clearAllFilters`: `setActiveType([]);`
- `anyFiltersActive`: `|| activeType.length > 0`.
- `buildDownloadParams`: append `type` CSV when non-empty.
- Render a new `<TypeFilterButton>` in the sticky filter bar, right after `<YearFilterButton>`
  (~line 383). Build it on `FilterDropdownShell` like `RegionFilterButton`, multi-select checkboxes:
  options `[{id:'group',label:'Group'},{id:'box_stack',label:'Box stack'},{id:'pizza',label:'Pizza'}]`,
  label `"Type"`, `count={selected.length}`.
  (Include all three roles — box_stack is a valid role and cheap to expose; Snax's ask was "group or pizza".)
- The existing Play/slideshow `<Link>` already serializes `searchParams` (~line 429), so `type`
  propagates into the slideshow automatically.

### 2d. Slideshow honors the type filter — `frontend/src/pages/PhotosSlideshowPage.tsx`
- Read `type` from the URL once (like the other filters, ~lines 40-44):
  `const types = parseCsvParam(searchParams.get('type'));`
- Add `type: types` to `filtersRef` (~line 68) and pass `type: filtersRef.current.type` into the
  `getPhotosFeed(...)` call (~lines 77-84).

---

## Verification
- Frontend typecheck: `cd frontend && npx tsc --noEmit` (vite build does NOT typecheck — see repo memory).
- Backend: `cd backend && npx tsc --noEmit` for the route change.
- Manual on preview: slideshow thumbs-up toggles + count updates + persists across advance/loop; logged-out
  user sees the count but can't vote. Type filter UI renders + updates URL (`?type=pizza`) — note it won't
  actually filter on preview until merged (prod backend). Confirm no regressions to year/shuffle/country/region.

## PR
- Draft PR off master. Title: `sfoglia-58543: /photos type filter + slideshow thumbs-up`.
- In the body, call out: (1) type filter needs master merge before it filters on preview (new backend
  param); (2) `payout_role`×`starred` intersection means sparse results are expected; (3) frontend-only
  slideshow vote works on preview immediately; (4) no migration.
