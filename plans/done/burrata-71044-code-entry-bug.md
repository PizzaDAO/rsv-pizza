# Code Entry "Try Again" / "Enter New Code" Bug Fix

**Task ID:** burrata-71044
**Priority:** High
**Status:** Planned

## Bug Description

The `AuthVerifyPage.tsx` component has confusing and broken behavior for the "Try Again" and "Enter New Code" buttons when a user fails to verify their 6-digit login code.

## Current Buggy Behavior

### Issue 1: "Try Again" Button Resubmits Failed Code

When code verification fails, clicking "Try Again" calls `handleRetry()` which resubmits the **exact same code** that just failed. This will always fail again for:
- `INVALID_CODE` - Code doesn't exist
- `CODE_EXPIRED` - Code has expired (15 min lifetime)
- `CODE_USED` - Code was already consumed
- `CODE_LOCKED` - Too many failed attempts

### Issue 2: Focus Management After "Enter New Code"

The `handleEnterNewCode()` function calls `focus()` synchronously before React re-renders, so focus may be lost.

### Issue 3: Misleading "Try Again" Link in Idle State

The "Didn't receive a code? Try again" link navigates to `/` (home page), which:
- Takes users out of the auth flow
- Loses the `isNewUser` session state
- Forces them to start over

## Root Cause

1. **Semantic confusion**: Two "Try Again" buttons with different behaviors
2. **Flawed retry logic**: Assumes the same code might work on retry
3. **Race condition**: Focus set before state update completes

## Proposed Fix

### 1. Simplify Error Recovery UI

Replace error state buttons with clearer options:

```tsx
{status === 'error' && (
  <>
    <AlertCircle className="w-16 h-16 text-[#ff393a] mx-auto mb-4" />
    <h1 className="text-2xl font-bold text-white mb-2">Verification Failed</h1>
    <p className="text-white/60 mb-6">{error}</p>
    <div className="flex flex-col gap-3">
      <button onClick={handleEnterNewCode} className="btn-primary">
        Enter Different Code
      </button>
      <button onClick={() => navigate('/login')} className="btn-secondary">
        Request New Code
      </button>
    </div>
  </>
)}
```

### 2. Fix Focus Management

Use `setTimeout` to ensure focus happens after re-render:

```tsx
function handleEnterNewCode() {
  setStatus('idle');
  setError(null);
  setCode(['', '', '', '', '', '']);
  setLastSubmittedCode(null);
  setTimeout(() => {
    if (isNewUser) {
      nameInputRef.current?.focus();
    } else {
      inputRefs.current[0]?.focus();
    }
  }, 100);
}
```

### 3. Fix "Try Again" Link

Change navigation from `/` to `/login`:

```tsx
<button
  onClick={() => navigate('/login')}
  className="text-[#ff393a] hover:underline"
>
  Request a new code
</button>
```

## Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/pages/AuthVerifyPage.tsx` | Error state buttons, focus management, navigation |

## Verification Steps

- [ ] Enter wrong code → error shows clear options
- [ ] Click "Enter Different Code" → form clears, first input focused
- [ ] Click "Request New Code" → navigates to `/login`
- [ ] Test with expired code → appropriate error message
- [ ] "Didn't receive a code?" link → goes to `/login` not `/`

## Critical Files

- `frontend/src/pages/AuthVerifyPage.tsx` - Main file with the bug
- `backend/src/routes/auth.routes.ts` - Error codes reference
- `frontend/src/pages/LoginPage.tsx` - Navigation pattern reference
