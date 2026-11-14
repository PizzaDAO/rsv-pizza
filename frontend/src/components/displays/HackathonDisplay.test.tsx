import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HackathonDisplay, foregroundFor } from './HackathonDisplay';
import { resolveDisplayMode, videoEmbedUrl, awardLabel, type DisplayHackathonData } from '../../lib/hackathonGalleryApi';

const base: DisplayHackathonData = {
  submissionsOpenAt: null,
  submissionDeadline: new Date(Date.now() + 3 * 3600_000).toISOString(),
  resultsRevealedAt: null,
  galleryOpen: false,
  tracks: [{ id: 't1', name: 'DeFi' }],
  projects: [],
  winners: [],
};
const project = { slug: 'slice', name: 'Slice Router', tagline: 'Split the bill', trackIds: ['t1'], cover: null, teamName: 'Crust', tableNumber: 'A3', awards: [] };
const winner = { prizeName: 'Grand Prize', prizeAmount: '$5,000', trackName: null, place: 1, multi: false, projectSlug: 'slice', projectName: 'Slice Router', projectTagline: null, teamName: 'Crust', cover: null };

const props = { backgroundColor: '#000000', rotationInterval: 10, galleryUrl: 'https://x/e/projects', eventUrl: 'https://x/e' };

describe('hackathon display (PR 6)', () => {
  it('resolveDisplayMode: auto picks winners > gallery > countdown; fixed modes stick', () => {
    expect(resolveDisplayMode('auto', base)).toBe('countdown');
    expect(resolveDisplayMode(undefined, { ...base, galleryOpen: true, projects: [project] })).toBe('gallery');
    expect(resolveDisplayMode('auto', { ...base, galleryOpen: true, projects: [project], resultsRevealedAt: 'x', winners: [winner] })).toBe('winners');
    expect(resolveDisplayMode('auto', { ...base, resultsRevealedAt: 'x', winners: [] })).toBe('countdown');
    expect(resolveDisplayMode('winners', base)).toBe('winners');
    expect(resolveDisplayMode('auto', null)).toBe('countdown');
  });

  it('countdown mode', () => {
    render(<HackathonDisplay {...props} config={{ mode: 'auto' }} data={base} />);
    expect(screen.getByTestId('hk-display').getAttribute('data-mode')).toBe('countdown');
    expect(screen.getByText('Submissions close in')).toBeTruthy();
    expect(screen.getByTestId('hk-display-qr')).toBeTruthy();
  });

  it('gallery mode before the gallery opens shows a placeholder, never projects', () => {
    render(<HackathonDisplay {...props} config={{ mode: 'gallery' }} data={base} />);
    expect(screen.getByText('Projects appear here soon')).toBeTruthy();
  });

  it('gallery + winners modes render the data; QR can be turned off', () => {
    const { unmount } = render(<HackathonDisplay {...props} config={{ mode: 'gallery' }} data={{ ...base, galleryOpen: true, projects: [project] }} />);
    expect(screen.getByText('Slice Router')).toBeTruthy();
    expect(screen.getByText('Table A3')).toBeTruthy();
    unmount();
    render(<HackathonDisplay {...props} config={{ mode: 'winners', showQr: false }} data={{ ...base, resultsRevealedAt: 'x', winners: [winner] }} />);
    expect(screen.getByTestId('hk-display-winner').textContent).toContain('Grand Prize · $5,000');
    expect(screen.queryByTestId('hk-display-qr')).toBeNull();
  });

  it('winners mode before the reveal', () => {
    render(<HackathonDisplay {...props} config={{ mode: 'winners' }} data={base} />);
    expect(screen.getByText('Winners will be announced soon')).toBeTruthy();
  });

  it('null data (unpublished)', () => {
    render(<HackathonDisplay {...props} config={{}} data={null} />);
    expect(screen.getByText("The hackathon isn't public yet")).toBeTruthy();
  });

  it('foregroundFor: light text on dark backgrounds, dark on light', () => {
    expect(foregroundFor('#000000').dark).toBe(true);
    expect(foregroundFor('#fff').dark).toBe(false);
    expect(foregroundFor('#6E54FF').fg).toBe('#ffffff');
    expect(foregroundFor('nonsense').dark).toBe(true);
  });
});

describe('gallery helpers (PR 6)', () => {
  it('videoEmbedUrl: allowlisted hosts with validated ids only', () => {
    expect(videoEmbedUrl('https://youtu.be/dQw4w9WgXcQ')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(videoEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(videoEmbedUrl('https://vimeo.com/123456789')).toBe('https://player.vimeo.com/video/123456789');
    expect(videoEmbedUrl('https://www.loom.com/share/0123456789abcdef0123456789abcdef')).toBe('https://www.loom.com/embed/0123456789abcdef0123456789abcdef');
    expect(videoEmbedUrl('https://evil.example/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(videoEmbedUrl('https://youtube.com.evil.example/watch?v=x')).toBeNull();
    expect(videoEmbedUrl('http://youtu.be/dQw4w9WgXcQ')).toBeNull();
    expect(videoEmbedUrl('https://www.youtube.com/watch?v="><script>')).toBeNull();
    expect(videoEmbedUrl(null)).toBeNull();
  });

  it('awardLabel shows the place only for multi-slot prizes', () => {
    expect(awardLabel({ prizeName: 'Best Game', prizeAmount: null, trackName: null, place: 2, multi: true })).toBe('Best Game · 2nd');
    expect(awardLabel({ prizeName: 'Grand', prizeAmount: null, trackName: null, place: 1, multi: false })).toBe('Grand');
  });
});
