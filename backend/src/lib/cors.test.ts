import { describe, it, expect } from 'vitest';
import { isAllowedOrigin } from './cors.js';

const ALLOWED = ['https://rsv.pizza'];

describe('isAllowedOrigin', () => {
  it.each([
    'https://rsv.pizza',
    'https://rsvpizza-git-my-branch-pizza-dao.vercel.app',
    'https://rsvpizza-abc123xyz-pizza-dao.vercel.app',
    'https://rsvpizza-team1-git-wl-audit-fixes-pizza-dao.vercel.app',
    'https://rsvpizza-team1-abc123xyz-pizza-dao.vercel.app',
    'https://rsvpizza-monad-git-foo-pizza-dao.vercel.app',
    'https://rsvpizza-monad-abc123xyz-pizza-dao.vercel.app',
    'https://rsvpizza.vercel.app',
  ])('allows %s', (o) => expect(isAllowedOrigin(o, ALLOWED)).toBe(true));

  it.each([
    'https://rsvpizza-evil.vercel.app',
    'https://rsvpizza-git-x-attacker-team.vercel.app',
    'https://rsvpizza.evil.com',
    'https://rsvpizza-pizza-dao.vercel.app.evil.com',
    'http://rsvpizza-git-x-pizza-dao.vercel.app',
    'https://evil-rsvpizza-git-x-pizza-dao.vercel.app',
    'https://rsvpizza-git-x-pizza-dao.vercel.app/',
    'https://other.example',
  ])('rejects %s', (o) => expect(isAllowedOrigin(o, ALLOWED)).toBe(false));
});
