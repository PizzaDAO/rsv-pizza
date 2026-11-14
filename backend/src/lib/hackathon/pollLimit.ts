/**
 * Hackathon polling reads vs the global per-IP /api limiter (500 / 15 min).
 *
 * The participant panel polls GET /hackathon/me, the host list polls GET
 * /hackathon/submissions and /hackathon/leaderboard, and judges poll GET
 * /api/hackathon-judge/:partyId/queue. On shared venue Wi-Fi every attendee has the same IP, so counting
 * those polls against the per-IP bucket would 429 everyone (check-in included). Like the host
 * guest-list read in index.ts, an AUTHENTICATED poll (valid JWT) skips the global limiter and
 * gets its own per-user bucket instead. Unauthenticated / invalid-token requests stay on the
 * per-IP limiter, so a forged header can't buy a fresh bucket.
 */
import type { Request } from 'express';
import jwt from 'jsonwebtoken';
import { rateLimit } from 'express-rate-limit';
import { getJwtSecret } from '../../config/secrets.js';

// /me (participant panel), /submissions + /leaderboard (host, PR 3-4), judge queue (PR 4),
// /voting (voter state on gallery / project pages) + /voting/host (host vote count poll, PR 7).
const POLL_PATH = /^\/api\/(parties\/[0-9a-fA-F-]{36}\/hackathon\/(me|submissions|leaderboard|voting|voting\/host)|hackathon-judge\/[0-9a-fA-F-]{36}\/queue)\/?$/;
// PR 7 vote writes: authenticated, with their own per-user limiter (20 / hour, voting routes).
const VOTE_PATH = /^\/api\/parties\/[0-9a-fA-F-]{36}\/hackathon\/votes\/?$/;

/** Verified user id from the bearer token, cached on the request. null when absent/invalid. */
function verifiedUserId(req: Request): string | null {
  const r = req as Request & { _hkPollUser?: string | null };
  if (r._hkPollUser !== undefined) return r._hkPollUser;
  let id: string | null = null;
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) {
    try {
      const d = jwt.verify(h.slice(7), getJwtSecret()) as { userId?: string };
      id = typeof d?.userId === 'string' && d.userId ? d.userId : null;
    } catch {
      id = null;
    }
  }
  r._hkPollUser = id;
  return id;
}

/** True for an authenticated GET of one of the hackathon poll paths above. */
export function isHackathonPollRead(req: Request): boolean {
  if (req.method !== 'GET') return false;
  if (!POLL_PATH.test((req.originalUrl || req.url).split('?')[0])) return false;
  return verifiedUserId(req) !== null;
}

/**
 * True for an authenticated vote write (POST / DELETE /hackathon/votes). A room of checked-in
 * attendees voting at once shares one venue IP, so these skip the global per-IP limiter; the
 * voting router's per-user voteLimiter bounds them instead.
 */
export function isHackathonVoteWrite(req: Request): boolean {
  if (req.method !== 'POST' && req.method !== 'DELETE') return false;
  if (!VOTE_PATH.test((req.originalUrl || req.url).split('?')[0])) return false;
  return verifiedUserId(req) !== null;
}

/** 300 / 15 min per user: a 60s poll is 15, so this only stops runaway clients. */
export const hackathonPollLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: 'You\'ve been rate limited. Please wait a few minutes before trying again.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  skip: (req) => !isHackathonPollRead(req),
  keyGenerator: (req) => 'hk:' + (verifiedUserId(req) ?? 'none'),
});
