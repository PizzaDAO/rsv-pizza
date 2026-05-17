# zucchini-24569 — Host X avatar refetch lockout after partial-handle blur

**Priority:** P2 (focused bug fix)

## Problem

In the Hosts editor (both Add and Edit modals), the Twitter handle input has an `onBlur` that auto-fetches the user's X avatar via fxtwitter and mirrors it to Supabase storage. This works on the very first blur — but if the user blurs with an incomplete handle (e.g. "sn"), the lookup resolves *some* real short-handle user, writes their avatar URL into the avatar slot, and from that point forward the blur guard refuses to refetch. The user then finishes typing the full handle (e.g. "snaxhandle"), blurs, and nothing happens. The wrong avatar is stuck until they manually clear the avatar field and re-blur.

The same lockout pattern exists in `AccountPage.tsx` for the logged-in user's own profile picture (blurs on the X handle field), though it's slightly less likely to bite because users typically only set their own handle once.

`HostPage.tsx` line 274 (`fetchXAvatarToSupabase` in `SponsorCRM.onAddAsCoHost`) is a one-shot fire-and-forget on add — no blur lockout — and is out of scope.

## Root cause

The guard in all three blur handlers is:

```ts
if (avatarSlot.trim() && !isAutoFilledXAvatar(avatarSlot)) return;
```

`isAutoFilledXAvatar` (in `frontend/src/utils/avatarUtils.ts`) only matches legacy `https://unavatar.io/x/...` URLs. The current code path no longer writes unavatar URLs — it writes Supabase storage URLs via `proxyAvatarToStorage`. So after the first successful auto-fill, the avatar slot contains a Supabase URL, the guard classifies it as "user-set," and refuses to overwrite on subsequent blurs.

URL-sniffing can't distinguish "we auto-filled this Supabase URL" from "the user uploaded this Supabase URL" — both look identical. The fix has to track provenance in state instead.

## Approach

**Track avatar provenance in component state.** Add a new state field per modal that remembers the handle that produced the current avatar. Treat it as a small ownership flag:

- `null` → we don't own the avatar slot (either user-set or unknown — respect existing data)
- a string handle → we own the slot and it reflects that handle

Blur decision matrix:

| `avatarFromX` | new handle | avatar slot   | Action               |
|---------------|------------|---------------|----------------------|
| `null`        | empty      | —             | no-op                |
| `null`        | non-empty  | empty or legacy unavatar | first-time fetch |
| `null`        | non-empty  | user-set      | no-op (respect user) |
| `"foo"`       | `"foo"`    | —             | no-op (already current) |
| `"foo"`       | `"bar"`    | —             | refetch unconditionally |
| `"foo"`       | empty      | —             | no-op (don't blank an existing avatar; user can clear manually) |

State lifecycle:

- On opening the Edit modal → initialize `avatarFromX` to `null` (provenance of any saved avatar is unknown).
- On the Add modal mount/reset → `null`.
- After a successful auto-fill → set `avatarFromX` to the handle that produced it.
- On manual file upload (`handleNew/EditAvatarFileChange`) → set to `null` (user is taking ownership).
- On the "Clear" button click → set to `null` (slot is empty; future blur falls to the first-time-fetch branch).

This avoids URL sniffing entirely and correctly distinguishes "we own this slot" from "user owns this slot." `isAutoFilledXAvatar` stays in place for the first-fetch path so we can still replace legacy unavatar URLs from old data.

## Secondary improvements (in scope per task)

1. **Minimum-handle-length gate.** In `cleanXHandle` (`avatarUtils.ts`), `HANDLE_RE` already enforces `{1,15}` — too permissive. Add a separate min-length check in the blur handler before calling `fetchXAvatarToSupabase`: skip the fetch if `handle.length < 4`. Don't change `cleanXHandle` itself (still useful as a normalizer in other call sites). This is a guard at the call site only.
2. **Loading state on the Twitter input.** Add a `xAvatarFetching` boolean per modal. While `true`, the Twitter input is `disabled` and a small `Loader2` spinner renders next to it. Clear on success/failure.
3. **Console-warn on failure.** In `fetchXAvatarToSupabase` (`avatarUtils.ts`), replace the silent `return null` branches with `console.warn` so this class of bug isn't invisible in the future. Cases: (a) handle didn't pass `cleanXHandle`, (b) fxtwitter HTTP failure, (c) fxtwitter `code !== 200` / missing `avatar_url`, (d) `catch` block. `proxyAvatarToStorage` already has `console.error` in both fail paths — verify on read and leave alone.

## Out of scope

- Don't refactor Add and Edit modals into a shared component.
- Don't migrate or remove `isAutoFilledXAvatar` — old data may still hold legacy unavatar URLs.
- Don't touch `FlyerGenerator.tsx` line ~353 or `HostPage.tsx` line ~274 (`SponsorCRM.onAddAsCoHost`) — both are one-shot, no blur lockout.

## Files to change

### 1. `frontend/src/components/HostsManager.tsx`

State additions (near existing avatar state):

```ts
const [editHostAvatarFromX, setEditHostAvatarFromX] = useState<string | null>(null);
const [newCoHostAvatarFromX, setNewCoHostAvatarFromX] = useState<string | null>(null);
const [editXAvatarFetching, setEditXAvatarFetching] = useState(false);
const [newXAvatarFetching, setNewXAvatarFetching] = useState(false);
```

Edit modal blur handler (replacing lines ~587–596) — `onBlur` for the Twitter input becomes:

```ts
onBlur={async () => {
  const handle = stripToHandle(editHostTwitter);
  setEditHostTwitter(handle);
  if (!handle) return;
  if (handle.length < 4) return;
  if (editHostAvatarFile) return;
  if (editHostAvatarFromX === handle) return;
  if (editHostAvatarFromX == null) {
    if (editHostAvatarUrl.trim() && !isAutoFilledXAvatar(editHostAvatarUrl)) return;
  }
  setEditXAvatarFetching(true);
  try {
    const fetched = await fetchXAvatarToSupabase(handle);
    if (fetched) {
      setEditHostAvatarUrl(fetched);
      setEditHostAvatarFromX(handle);
    }
  } finally {
    setEditXAvatarFetching(false);
  }
}}
disabled={editXAvatarFetching}
```

Add modal blur handler — mirror the same logic with `newCoHostAvatarFromX` / `newCoHostAvatarUrl` / `newCoHostAvatarFile` / `setNewXAvatarFetching`.

Spinner: render a `Loader2` (import from `lucide-react` — `Upload` is already imported from there, just add `Loader2` to the import list) inline next to the Twitter input. Keep it visually minimal — small size (14–16px), spinning, only when fetching.

Provenance resets:

- In `handleEditAvatarFileChange`: after setting file/url, add `setEditHostAvatarFromX(null);`.
- In `handleNewAvatarFileChange`: add `setNewCoHostAvatarFromX(null);`.
- In the Edit modal "Clear" button onClick: add `setEditHostAvatarFromX(null);`.
- In the Add modal "Clear" button onClick: add `setNewCoHostAvatarFromX(null);`.
- In `startEditingHost`: add `setEditHostAvatarFromX(null);`.
- In `cancelEditingHost`: add `setEditHostAvatarFromX(null);` and `setEditXAvatarFetching(false);`.
- In the `addCoHost` reset block: add `setNewCoHostAvatarFromX(null);` and `setNewXAvatarFetching(false);`.

### 2. `frontend/src/utils/avatarUtils.ts`

Add `console.warn` to each failure path in `fetchXAvatarToSupabase`:

```ts
export async function fetchXAvatarToSupabase(handleOrUrl: string): Promise<string | null> {
  const handle = cleanXHandle(handleOrUrl);
  if (!handle) {
    console.warn('fetchXAvatarToSupabase: invalid handle', handleOrUrl);
    return null;
  }
  try {
    const res = await fetch(`https://api.fxtwitter.com/${encodeURIComponent(handle)}`);
    if (!res.ok) {
      console.warn('fetchXAvatarToSupabase: fxtwitter HTTP', res.status, handle);
      return null;
    }
    const json = await res.json();
    if (json.code !== 200 || !json.user?.avatar_url) {
      console.warn('fetchXAvatarToSupabase: fxtwitter no avatar', { code: json.code, handle });
      return null;
    }
    const big = String(json.user.avatar_url).replace(/_normal(\.[a-zA-Z0-9]+)$/, '_400x400$1');
    return await proxyAvatarToStorage(big);
  } catch (err) {
    console.warn('fetchXAvatarToSupabase: fetch threw', handle, err);
    return null;
  }
}
```

Do **not** modify `cleanXHandle` or `isAutoFilledXAvatar`.

### 3. `frontend/src/pages/AccountPage.tsx`

Apply the same provenance pattern to the own-profile X-handle blur (around line 462). State additions next to the existing avatar state:

```ts
const [profilePictureFromX, setProfilePictureFromX] = useState<string | null>(null);
const [xAvatarFetching, setXAvatarFetching] = useState(false);
```

Replace the existing blur handler with:

```ts
onBlur={async () => {
  if (profilePictureFile) return;
  const handle = twitter.trim();
  if (!handle) return;
  if (handle.length < 4) return;
  if (profilePictureFromX === handle) return;
  if (profilePictureFromX == null) {
    if (profilePicture && !isAutoFilledXAvatar(profilePicture)) return;
  }
  setXAvatarFetching(true);
  try {
    const avatarUrl = await fetchXAvatarToSupabase(twitter);
    if (avatarUrl) {
      setProfilePicture(avatarUrl);
      setProfilePictureFromX(handle);
    }
  } finally {
    setXAvatarFetching(false);
  }
}}
disabled={xAvatarFetching}
```

Provenance resets:
- In `handleProfilePictureChange`: after `setProfilePictureFile(file); setProfilePicture(objectUrl);` add `setProfilePictureFromX(null);`.
- On initial profile load: leave `profilePictureFromX` as `null`.

Add the small spinner next to the X input (use `Loader2` from `lucide-react`).

### 4. `frontend/src/lib/supabase.ts`

No code changes. Verify `proxyAvatarToStorage` already logs `console.error` on both failure paths.

### 5. `frontend/src/pages/HostPage.tsx`

No changes.
