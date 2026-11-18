import { describe, it, expect } from 'vitest';
import { isMarqueeHiddenPath } from './MarqueeBanner';

describe('isMarqueeHiddenPath', () => {
  it('hides on create, auth and host pages', () => {
    for (const p of ['/new', '/login', '/auth/verify', '/host/abc', '/host/abc/guests', '/run/x', '/account']) {
      expect(isMarqueeHiddenPath(p)).toBe(true);
    }
  });
  it('shows on public pages', () => {
    for (const p of ['/', '/events', '/austin', '/newark', '/gpp', '/hostile-takeover']) {
      expect(isMarqueeHiddenPath(p)).toBe(false);
    }
  });
});
