import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OpenInWallet } from './OpenInWallet';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Safari';

describe('OpenInWallet', () => {
  beforeEach(() => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE);
  });
  afterEach(() => vi.restoreAllMocks());

  it('renders nothing on desktop', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Windows NT 10.0) Chrome/120');
    const { container } = render(<OpenInWallet getHandoffUrl={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('does not mint on mount; mints when opened, and again after each tap', async () => {
    const getUrl = vi.fn().mockResolvedValue('https://example.org/auth/verify?token=t');
    render(<OpenInWallet getHandoffUrl={getUrl} />);
    expect(getUrl).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /open this page in your wallet app/i }));
    await waitFor(() => expect(getUrl).toHaveBeenCalledTimes(1));
    const link = await screen.findByRole('link', { name: 'MetaMask' });
    expect(link.getAttribute('href')).toContain('https://link.metamask.io/dapp/example.org/auth/verify');

    link.addEventListener('click', (e) => e.preventDefault());
    await userEvent.click(link);
    // The tapped link stays rendered right after the tap; a fresh URL arrives later.
    expect(screen.getByRole('link', { name: 'MetaMask' })).toBe(link);
    await waitFor(() => expect(getUrl).toHaveBeenCalledTimes(2), { timeout: 2000 });
  });
});
