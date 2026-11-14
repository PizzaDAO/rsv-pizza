import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { SetupSection } from './SetupSection';
import type { HostHackathon } from '../../lib/hackathonApi';

const hk = (over: Partial<HostHackathon> = {}): HostHackathon => ({
  id: 'h1', partyId: 'p1', enabled: true, disabledAt: null, rules: 'Old rules',
  submissionsOpenAt: null, submissionDeadline: null, teamMinSize: 1, teamMaxSize: 5, maxTracksPerSubmission: 1,
  eligibility: 'registered', blindJudging: false, judgingStatus: 'not_started', galleryVisibility: 'after_reveal',
  publishedAt: null, resultsRevealedAt: null, tracks: [], prizes: [], criteria: [], judges: [],
  ...over,
});

const rules = () => screen.getByLabelText('Rules') as HTMLTextAreaElement;

describe('SetupSection unsaved edits (review L5)', () => {
  it('Publish/Unpublish (a new hackathon object, same id) keeps unsaved edits', () => {
    const props = { saving: false, onSave: vi.fn(async () => true), onDisable: vi.fn() };
    const { rerender } = render(<SetupSection hackathon={hk()} {...props} />);
    fireEvent.change(rules(), { target: { value: 'My draft rules' } });
    rerender(<SetupSection hackathon={hk({ publishedAt: '2027-01-01T00:00:00Z' })} {...props} />);
    expect(rules().value).toBe('My draft rules');
  });

  it('a different hackathon resets the form', () => {
    const props = { saving: false, onSave: vi.fn(async () => true), onDisable: vi.fn() };
    const { rerender } = render(<SetupSection hackathon={hk()} {...props} />);
    fireEvent.change(rules(), { target: { value: 'My draft rules' } });
    rerender(<SetupSection hackathon={hk({ id: 'h2', rules: 'Other event' })} {...props} />);
    expect(rules().value).toBe('Other event');
  });

  it('after a successful save the form takes the saved (server-normalized) values', async () => {
    const onSave = vi.fn(async () => true);
    const props = { saving: false, onSave, onDisable: vi.fn() };
    const { rerender } = render(<SetupSection hackathon={hk()} {...props} />);
    fireEvent.change(rules(), { target: { value: '  New rules  ' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Save setup/ })); });
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ rules: 'New rules' }));
    rerender(<SetupSection hackathon={hk({ rules: 'New rules' })} {...props} />);
    expect(rules().value).toBe('New rules');
    // ...and a later unrelated update (e.g. Publish) does not reset again.
    fireEvent.change(rules(), { target: { value: 'Draft 2' } });
    rerender(<SetupSection hackathon={hk({ rules: 'New rules', publishedAt: '2027-01-01T00:00:00Z' })} {...props} />);
    expect(rules().value).toBe('Draft 2');
  });
});
