import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useContext } from 'react';
import { walletComponent } from './WalletGate';
import { WalletInsideContext } from './walletContext';

// Passthrough stand-in for the heavy wagmi/ConnectKit providers.
vi.mock('./WalletProviders', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="providers">{children}</div>,
}));

function Probe({ label }: { label: string }) {
  const inside = useContext(WalletInsideContext);
  return <span>{label}:{inside ? 'inside' : 'outside'}</span>;
}

describe('walletComponent', () => {
  it('shows the fallback, then renders the component inside the wallet providers', async () => {
    const Lazy = walletComponent<{ label: string }>(
      () => Promise.resolve({ default: Probe }),
      <span>loading-wallet</span>,
    );
    render(<Lazy label="a" />);
    expect(screen.getByText('loading-wallet')).toBeTruthy();
    expect(await screen.findByText('a:inside')).toBeTruthy();
    expect(screen.getByTestId('providers')).toBeTruthy();
  });

  it('does not double-wrap when nested inside an existing wallet provider', async () => {
    const Inner = walletComponent<{ label: string }>(() => Promise.resolve({ default: Probe }));
    await Inner.preload();
    render(
      <WalletInsideContext.Provider value={true}>
        <Inner label="n" />
      </WalletInsideContext.Provider>,
    );
    expect(screen.getByText('n:inside')).toBeTruthy();
    expect(screen.queryByTestId('providers')).toBeNull();
  });
});
