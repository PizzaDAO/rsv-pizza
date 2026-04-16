# buffalo-57565 — Partner dashboard: title-as-link

**Priority**: Low (UX polish)

## Goal

On the partner dashboard event cards, remove the `ExternalLink` icon in the top-right and make the event title clickable instead.

## File

`frontend/src/pages/PartnerDashboardPage.tsx`

## Changes

### 1. Wrap the title in an anchor (line 574)

**Before:**
```tsx
<h2 className="text-base font-semibold text-theme-text truncate">{event.name}</h2>
```

**After:**
```tsx
<h2 className="text-base font-semibold truncate">
  <a
    href={`/${event.slug}`}
    target="_blank"
    rel="noopener noreferrer"
    className="text-theme-text hover:text-theme-text-secondary transition-colors"
    title="View event page"
  >
    {event.name}
  </a>
</h2>
```

### 2. Remove the ExternalLink anchor (lines 600-608)

Delete the entire block:
```tsx
<a
  href={`/${event.slug}`}
  target="_blank"
  rel="noopener noreferrer"
  className="text-theme-text-faint hover:text-theme-text-secondary transition-colors"
  title="View event page"
>
  <ExternalLink size={14} />
</a>
```

### 3. Remove `ExternalLink` from imports (line 10)

It's no longer used elsewhere on the page.

**Before:**
```tsx
import {
  Loader2, Shield, Tag, ExternalLink, Users,
  ...
} from 'lucide-react';
```

**After:**
```tsx
import {
  Loader2, Shield, Tag, Users,
  ...
} from 'lucide-react';
```

## Verification

1. Open `/partner` dashboard on Vercel preview (logged in as a partner / admin viewing partner view)
2. Each event card no longer shows the link-out icon in the top-right
3. The event title is clickable and opens the event page in a new tab
4. Hover state on title shows the lighter color
5. The "Report" button (when present) still works
