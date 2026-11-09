import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReelMaker } from './ReelMaker';
import type { ReelsOverview } from '../../lib/reelsApi';

const fetchReels = vi.hoisted(() => vi.fn());
const makeReel = vi.hoisted(() => vi.fn());
vi.mock('../../lib/reelsApi', async (orig) => ({
  ...(await orig<typeof import('../../lib/reelsApi')>()),
  fetchReels,
  makeReel,
}));

const base: ReelsOverview = {
  eligible: true,
  reason: null,
  reasonCode: null,
  photoCount: 10,
  minPhotos: 3,
  tracks: [{ key: 'songs/band/slice.mp3', title: 'slice', folder: 'band' }],
  reels: [],
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe('ReelMaker', () => {
  it('explains why a host cannot make a reel yet', async () => {
    fetchReels.mockResolvedValue({ ...base, eligible: false, reason: 'Reels can be made once the event has started' });
    render(<ReelMaker partyId="p1" defaultTitle="Slice Night" />);
    expect(await screen.findByText(/once the event has started/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /make a sizzle reel/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('queues a reel with the chosen title and music', async () => {
    fetchReels.mockResolvedValue(base);
    makeReel.mockResolvedValue({});
    render(<ReelMaker partyId="p1" defaultTitle="Slice Night" />);
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByRole('combobox'), 'none');
    await user.click(screen.getByRole('button', { name: /make a sizzle reel/i }));
    await waitFor(() => expect(makeReel).toHaveBeenCalledWith('p1', { title: 'Slice Night', musicKey: 'none' }));
  });

  it('shows downloads for a finished reel', async () => {
    fetchReels.mockResolvedValue({
      ...base,
      reels: [{
        id: 'r1', status: 'ready', progress: 100, error: null, title: 'Slice Night', musicTitle: null,
        durationSeconds: 30, createdAt: '2026-05-23T00:00:00Z', finishedAt: '2026-05-23T00:05:00Z',
        outputs: { '9x16_nomusic': 'https://example.com/r1/9x16_nomusic.mp4', poster: 'https://example.com/r1/poster.jpg' },
      }],
    });
    render(<ReelMaker partyId="p1" />);
    const link = await screen.findByRole('link', { name: /download/i });
    expect(link.getAttribute('href')).toBe('https://example.com/r1/9x16_nomusic.mp4');
    expect(screen.getByText(/no music/i, { selector: 'span' })).toBeTruthy();
  });
});
