import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const PARTY = { id: 'p1', name: 'Slice Night', inviteCode: 'abc', customUrl: 'slice', wifiInfo: null, date: null, timezone: null };
vi.mock('../../../contexts/PizzaContext', () => ({ usePizza: () => ({ party: PARTY, guests: [] }) }));

const getSponsors = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/api', () => ({ getSponsors }));

import { TableTentBuilder } from './TableTentBuilder';

beforeEach(() => {
  getSponsors.mockReset();
  getSponsors.mockResolvedValue({
    sponsors: [
      { id: 's1', name: 'Acme', logoUrl: '/acme.png', status: 'yes' },
      { id: 's2', name: 'NoLogo', logoUrl: null, status: 'yes' },
      { id: 's3', name: 'Pending', logoUrl: '/p.png', status: 'contacted' },
    ],
  });
});

describe('TableTentBuilder sponsors gate', () => {
  it('without Partners access never fetches sponsors or shows the toggle', () => {
    render(<TableTentBuilder canViewSponsors={false} />);
    expect(getSponsors).not.toHaveBeenCalled();
    expect(screen.queryByTestId('tent-sponsors')).toBeNull();
  });
  it('with access lists only confirmed sponsors with logos', async () => {
    render(<TableTentBuilder canViewSponsors />);
    await waitFor(() => expect(getSponsors).toHaveBeenCalledWith('p1'));
    fireEvent.click(screen.getByText('print.tents.sponsorsShow'));
    await waitFor(() => expect(screen.getByTestId('tent-sponsors').textContent).toContain('Acme'));
    const box = screen.getByTestId('tent-sponsors').textContent ?? '';
    expect(box).not.toContain('NoLogo');
    expect(box).not.toContain('Pending');
  });
});

describe('TableTentBuilder wifi', () => {
  it('shows ssid/password inputs only for the wifi QR target', () => {
    render(<TableTentBuilder />);
    expect(screen.queryByPlaceholderText('print.tents.wifiSsidPlaceholder')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'print.tents.qrWifi' }));
    expect(screen.getByPlaceholderText('print.tents.wifiSsidPlaceholder')).toBeTruthy();
    expect(screen.getByPlaceholderText('print.tents.wifiPasswordPlaceholder')).toBeTruthy();
  });
});
