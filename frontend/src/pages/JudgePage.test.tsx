import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { JudgeQueueResponse, JudgeSubmissionResponse } from '../lib/hackathonApi';

const auth = vi.hoisted(() => ({ user: { id: 'u1', email: 'judge@example.com' }, loading: false, signOut: () => {} }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../components/Layout', () => ({ Layout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../components/LoginModal', () => ({ LoginModal: () => null }));
const EVENT = vi.hoisted(() => ({ id: 'party-1', name: 'Blitz' }));
vi.mock('../lib/api', () => ({ getEventBySlug: vi.fn(async () => EVENT) }));
const judgeApi = vi.hoisted(() => ({ queue: vi.fn(), submission: vi.fn(), score: vi.fn() }));
vi.mock('../lib/hackathonApi', async (orig) => ({ ...(await orig<typeof import('../lib/hackathonApi')>()), hackathonJudgeApi: judgeApi }));

import { JudgePage } from './JudgePage';

const CRIT = [{ id: 'c1', name: 'Impact', description: null, weight: 1, maxScore: 3, sortOrder: 0 }];
const item = (id: string, name: string) => ({ id, name, tagline: null, trackIds: [], tableNumber: null, cover: null, teamName: null, scored: false, myTotal: null, scoredAt: null });
const QUEUE: JudgeQueueResponse = {
  judge: { name: 'Ana', trackIds: [] }, judgingStatus: 'open', blindJudging: false, criteria: CRIT, tracks: [],
  queue: [item('A', 'Alpha'), item('B', 'Bravo')], progress: { scored: 0, total: 2 },
};
const detail = (id: string, name: string, myScore: JudgeSubmissionResponse['submission']['myScore'] = null): JudgeSubmissionResponse => ({
  judgingStatus: 'open', blindJudging: false,
  submission: { ...item(id, name), description: null, screenshots: [], linksLocked: false, links: null, team: null, myScore },
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const renderPage = () => render(
  <MemoryRouter initialEntries={['/judge/abc']}><Routes><Route path="/judge/:inviteCode" element={<JudgePage />} /></Routes></MemoryRouter>,
);

const openProject = async (name: string) => {
  const btn = (await screen.findAllByTestId('judge-queue-item')).find((b) => b.textContent?.includes(name))!;
  fireEvent.click(btn);
};

beforeEach(() => {
  Object.values(judgeApi).forEach((f) => f.mockReset());
  judgeApi.queue.mockResolvedValue(QUEUE);
  window.scrollTo = vi.fn() as any;
});

describe('JudgePage: switching projects can never save to the wrong one', () => {
  it('while B loads, A\'s form (and its Save) is gone; B opens with a fresh form', async () => {
    const bLoad = deferred<JudgeSubmissionResponse>();
    judgeApi.submission.mockImplementation((_p: string, id: string) => (id === 'A' ? Promise.resolve(detail('A', 'Alpha')) : bLoad.promise));
    renderPage();

    await openProject('Alpha');
    fireEvent.click(await screen.findByRole('radio', { name: 'Impact: 3 of 3' }));
    expect((screen.getByTestId('judge-save') as HTMLButtonElement).disabled).toBe(false);

    await openProject('Bravo');
    // A's scores and Save button must not be on screen while B is loading.
    expect(screen.queryByTestId('judge-save')).toBeNull();
    expect(screen.queryByTestId('judge-scoring')).toBeNull();
    expect(screen.getByTestId('judge-detail-loading')).toBeTruthy();

    await act(async () => { bLoad.resolve(detail('B', 'Bravo')); });
    await screen.findByRole('heading', { name: 'Bravo' });
    // Fresh form for B: A's pick isn't carried over, so Save stays disabled.
    expect(screen.getByRole('radio', { name: 'Impact: 3 of 3' }).getAttribute('aria-checked')).toBe('false');
    expect((screen.getByTestId('judge-save') as HTMLButtonElement).disabled).toBe(true);
    expect(judgeApi.score).not.toHaveBeenCalled();
  });

  it('a save posts to the project the form belongs to, and a late response for A never replaces B', async () => {
    const aSave = deferred<JudgeSubmissionResponse>();
    judgeApi.submission.mockImplementation((_p: string, id: string) => Promise.resolve(id === 'A' ? detail('A', 'Alpha') : detail('B', 'Bravo')));
    judgeApi.score.mockImplementation(() => aSave.promise);
    renderPage();

    await openProject('Alpha');
    fireEvent.click(await screen.findByRole('radio', { name: 'Impact: 2 of 3' }));
    fireEvent.click(screen.getByTestId('judge-save'));
    expect(judgeApi.score).toHaveBeenCalledWith('party-1', 'A', expect.objectContaining({ scores: { c1: 2 } }));

    await openProject('Bravo');
    await screen.findByRole('heading', { name: 'Bravo' });
    await act(async () => { aSave.resolve(detail('A', 'Alpha', { criterionScores: { c1: 2 }, total: 66.67, privateComment: null, teamFeedback: null, updatedAt: '2027-01-01T00:00:00Z' })); });
    await waitFor(() => expect(judgeApi.queue).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('heading', { name: 'Bravo' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Alpha' })).toBeNull();
    expect(judgeApi.score).toHaveBeenCalledTimes(1);
  });
});
