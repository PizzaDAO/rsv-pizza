# Fix iOS Status Bar Tap-to-Scroll

**Task ID:** bellpepper-71328
**Priority:** High
**Status:** Planned

## Problem

Native iOS status bar tap-to-scroll doesn't work on RSV.Pizza. Tapping the status bar (time/wifi/battery area) should scroll any page to top, but it's broken.

## Root Cause

Two CSS issues create a custom scroll container that breaks iOS's native detection:

### Issue 1: `index.css` (lines 204-209)

```css
html, body {
  height: 100%;           /* Constrains body to viewport */
  overflow-x: hidden;     /* Creates overflow context */
  -webkit-overflow-scrolling: touch;  /* Problematic on modern iOS */
}
```

### Issue 2: `RSVPModal.tsx` (lines 104-110)

```typescript
document.body.style.overflow = 'hidden';  /* Direct body manipulation */
```

The combination makes iOS treat the body as a custom scroll container instead of the main viewport.

## Solution

### Fix 1: Update `frontend/src/index.css`

Replace lines 204-209:

```css
html {
  height: 100%;
}

body {
  margin: 0;
  padding: 0;
  min-height: 100%;
  /* Remove overflow-x: hidden and -webkit-overflow-scrolling */
}

#root {
  min-height: 100vh;
}
```

### Fix 2: Update `frontend/src/components/RSVPModal.tsx`

Replace direct body overflow manipulation with a CSS class approach:

```typescript
// Instead of:
document.body.style.overflow = 'hidden';

// Use:
document.body.classList.add('modal-open');

// And in CSS:
body.modal-open {
  overflow: hidden;
}
```

Or use a fixed backdrop overlay that captures scroll events without modifying body.

## Files to Modify

| File | Change |
|------|--------|
| `frontend/src/index.css` | Remove problematic overflow/height rules |
| `frontend/src/components/RSVPModal.tsx` | Replace body.style.overflow with class toggle |

## Verification Steps

1. Open RSV.Pizza on iOS Safari
2. Navigate to any page with scrollable content
3. Scroll down
4. Tap iOS status bar
5. Page should scroll to top smoothly
6. Open RSVP modal, close it, verify scroll still works

## Additional Benefits

- Better scroll performance (no custom scroll containers)
- Improved iOS Safari compatibility
- Standard accessibility behavior
