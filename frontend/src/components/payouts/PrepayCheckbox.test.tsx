import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// scam-flag-private: the prepay toggle must never send the full tag array (a stripped public list
// PATCHed by a payment admin would wipe 'possible-scam' / 'paid' / 'go' / caps).
const m = vi.hoisted(() => ({ updatePartyApi: vi.fn(), setParty: vi.fn(), party: null as any }));
vi.mock('../../lib/api', () => ({ updatePartyApi: m.updatePartyApi }));
vi.mock('../../contexts/PizzaContext', () => ({ usePizza: () => ({ party: m.party, setParty: m.setParty }) }));

import { PrepayCheckbox } from './PrepayCheckbox';

describe('PrepayCheckbox', () => {
  beforeEach(() => {
    m.updatePartyApi.mockReset().mockResolvedValue({ party: {} });
    m.setParty.mockReset();
  });

  it('renders nothing when only the public (stripped) tags are loaded', () => {
    m.party = { id: 'p1', eventTags: ['swc'], rawEventTagsLoaded: false };
    const { container } = render(<PrepayCheckbox partyId="p1" />);
    expect(container.innerHTML).toBe('');
  });

  it('sends a targeted { prepay } toggle, never eventTags', async () => {
    m.party = { id: 'p1', eventTags: ['swc', 'possible-scam', 'paid'], rawEventTagsLoaded: true };
    render(<PrepayCheckbox partyId="p1" />);
    await userEvent.click(screen.getByText('I need 50% prepayment for this event'));
    await waitFor(() => expect(m.updatePartyApi).toHaveBeenCalledTimes(1));
    expect(m.updatePartyApi).toHaveBeenCalledWith('p1', { prepay: true });
    expect(m.updatePartyApi.mock.calls[0][1]).not.toHaveProperty('eventTags');
  });

  it('unchecking sends prepay:false', async () => {
    m.party = { id: 'p1', eventTags: ['swc', 'prepay', '500'], rawEventTagsLoaded: true };
    render(<PrepayCheckbox partyId="p1" />);
    await userEvent.click(screen.getByText('I need 50% prepayment for this event'));
    await waitFor(() => expect(m.updatePartyApi).toHaveBeenCalledWith('p1', { prepay: false }));
  });
});
