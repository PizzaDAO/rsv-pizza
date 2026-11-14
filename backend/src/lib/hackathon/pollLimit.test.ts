/**
 * Hackathon polling vs the global per-IP limiter: authenticated polls of /hackathon/me and
 * /hackathon/submissions skip the per-IP bucket (venue Wi-Fi) and get a per-user one.
 * The app below wires the limiters exactly like backend/src/index.ts.
 */
import { describe, it, expect, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { rateLimit } from 'express-rate-limit';

const SECRET = 'test-secret-hackathon-poll-0123456789';
const saved = process.env.JWT_SECRET;
process.env.JWT_SECRET = SECRET;
afterAll(() => {
  if (saved === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = saved;
});

import { hackathonPollLimiter, isHackathonPollRead, isHackathonVoteWrite } from './pollLimit.js';

const PARTY = '11111111-1111-4111-8111-111111111111';
const tok = (userId: string) => `Bearer ${jwt.sign({ userId, email: `${userId}@x.com` }, SECRET, { expiresIn: '1h' })}`;

function app(globalMax: number) {
  const a = express();
  // Same shape as index.ts: the global per-IP limiter skips authenticated hackathon polls.
  a.use('/api', rateLimit({ windowMs: 60_000, max: globalMax, validate: false, skip: (req) => isHackathonPollRead(req) }));
  a.use('/api', hackathonPollLimiter);
  a.get('/api/parties/:id/hackathon/me', (_req, res) => res.json({ ok: true }));
  a.get('/api/parties/:id/hackathon/submissions', (_req, res) => res.json({ ok: true }));
  a.post('/api/parties/:id/checkin', (_req, res) => res.json({ ok: true }));
  return a;
}

describe('isHackathonPollRead', () => {
  const req = (method: string, url: string, auth?: string) => ({ method, originalUrl: url, url, headers: auth ? { authorization: auth } : {} }) as any;
  it('only authenticated GETs of /me and /submissions', () => {
    expect(isHackathonPollRead(req('GET', `/api/parties/${PARTY}/hackathon/me`, tok('u1')))).toBe(true);
    expect(isHackathonPollRead(req('GET', `/api/parties/${PARTY}/hackathon/submissions?x=1`, tok('u1')))).toBe(true);
    expect(isHackathonPollRead(req('GET', `/api/parties/${PARTY}/hackathon/me`))).toBe(false);
    expect(isHackathonPollRead(req('GET', `/api/parties/${PARTY}/hackathon/me`, 'Bearer forged.token.here'))).toBe(false);
    expect(isHackathonPollRead(req('POST', `/api/parties/${PARTY}/hackathon/me`, tok('u1')))).toBe(false);
    expect(isHackathonPollRead(req('GET', `/api/parties/${PARTY}/hackathon/export.csv`, tok('u1')))).toBe(false);
    expect(isHackathonPollRead(req('GET', `/api/parties/${PARTY}/hackathon`, tok('u1')))).toBe(false);
  });

  it('PR 4: host leaderboard and judge queue polls; not judge detail reads or score writes', () => {
    expect(isHackathonPollRead(req('GET', `/api/parties/${PARTY}/hackathon/leaderboard`, tok('u1')))).toBe(true);
    expect(isHackathonPollRead(req('GET', `/api/hackathon-judge/${PARTY}/queue`, tok('u1')))).toBe(true);
    expect(isHackathonPollRead(req('GET', `/api/hackathon-judge/${PARTY}/queue`))).toBe(false);
    expect(isHackathonPollRead(req('GET', `/api/hackathon-judge/${PARTY}/submissions/${PARTY}`, tok('u1')))).toBe(false);
    expect(isHackathonPollRead(req('PUT', `/api/hackathon-judge/${PARTY}/submissions/${PARTY}/score`, tok('u1')))).toBe(false);
    expect(isHackathonPollRead(req('GET', `/api/hackathon-judge/not-a-uuid/queue`, tok('u1')))).toBe(false);
  });
});

describe('PR 7 voting', () => {
  const req = (method: string, url: string, auth?: string) => ({ method, originalUrl: url, url, headers: auth ? { authorization: auth } : {} }) as any;
  it('voter state + host vote-count polls are poll reads when authenticated', () => {
    expect(isHackathonPollRead(req('GET', `/api/parties/${PARTY}/hackathon/voting`, tok('u1')))).toBe(true);
    expect(isHackathonPollRead(req('GET', `/api/parties/${PARTY}/hackathon/voting/host`, tok('u1')))).toBe(true);
    expect(isHackathonPollRead(req('GET', `/api/parties/${PARTY}/hackathon/voting`))).toBe(false);
    expect(isHackathonPollRead(req('PUT', `/api/parties/${PARTY}/hackathon/voting`, tok('u1')))).toBe(false);
    // gallery + project pages: logged-in readers skip the global per-IP limiter too
    expect(isHackathonPollRead(req('GET', `/api/parties/${PARTY}/hackathon/gallery`, tok('u1')))).toBe(true);
    expect(isHackathonPollRead(req('GET', `/api/parties/${PARTY}/hackathon/projects/slice-router`, tok('u1')))).toBe(true);
    expect(isHackathonPollRead(req('GET', `/api/parties/${PARTY}/hackathon/gallery`))).toBe(false);
    expect(isHackathonPollRead(req('GET', `/api/parties/${PARTY}/hackathon/projects/a/b`, tok('u1')))).toBe(false);
  });
  it('authenticated vote writes skip the per-IP limiter (they have a per-user one); nothing else does', () => {
    expect(isHackathonVoteWrite(req('POST', `/api/parties/${PARTY}/hackathon/votes`, tok('u1')))).toBe(true);
    expect(isHackathonVoteWrite(req('DELETE', `/api/parties/${PARTY}/hackathon/votes?trackId=x`, tok('u1')))).toBe(true);
    expect(isHackathonVoteWrite(req('POST', `/api/parties/${PARTY}/hackathon/votes`))).toBe(false);
    expect(isHackathonVoteWrite(req('POST', `/api/parties/${PARTY}/hackathon/votes`, 'Bearer forged.token.here'))).toBe(false);
    expect(isHackathonVoteWrite(req('GET', `/api/parties/${PARTY}/hackathon/votes`, tok('u1')))).toBe(false);
    expect(isHackathonVoteWrite(req('POST', `/api/parties/${PARTY}/hackathon/voting/open`, tok('u1')))).toBe(false);
    expect(isHackathonVoteWrite(req('POST', `/api/parties/${PARTY}/hackathon/teams`, tok('u1')))).toBe(false);
  });
});

describe('limiter wiring', () => {
  it('one IP, many logged-in pollers: polls never drain the per-IP bucket', async () => {
    const a = app(5);
    for (let i = 0; i < 40; i++) {
      const r = await request(a).get(`/api/parties/${PARTY}/hackathon/me`).set('Authorization', tok(`user${i}`));
      expect(r.status).toBe(200);
    }
    // Check-in on the same IP still has its whole per-IP budget.
    expect((await request(a).post(`/api/parties/${PARTY}/checkin`)).status).toBe(200);
  });

  it('anonymous / forged-token polls stay on the per-IP limiter', async () => {
    const a = app(3);
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await request(a).get(`/api/parties/${PARTY}/hackathon/me`).set('Authorization', 'Bearer nope')).status);
    expect(codes).toEqual([200, 200, 200, 429]);
  });

  it('per-user cap (300 / 15 min) still applies', async () => {
    const a = app(10_000);
    let last = 0;
    for (let i = 0; i < 301; i++) last = (await request(a).get(`/api/parties/${PARTY}/hackathon/submissions`).set('Authorization', tok('greedy'))).status;
    expect(last).toBe(429);
    expect((await request(a).get(`/api/parties/${PARTY}/hackathon/submissions`).set('Authorization', tok('other'))).status).toBe(200);
  });
});
