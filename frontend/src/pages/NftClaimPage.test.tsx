import '../i18n';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';

const wallet = vi.hoisted(() => ({ address: undefined as string | undefined }));
vi.mock('wagmi', () => ({ useAccount: () => ({ address: wallet.address, isConnected: !!wallet.address }) }));
vi.mock('connectkit', () => ({
  ConnectKitButton: { Custom: ({ children }: { children: (p: { show: () => void }) => React.ReactNode }) => <>{children({ show: () => {} })}</> },
}));
vi.mock('../components/OpenInWallet', () => ({ OpenInWallet: () => null }));
vi.mock('../components/Layout', () => ({ Layout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('react-helmet-async', () => ({ Helmet: () => null }));

const brand = vi.hoisted(() => ({ nftMinting: true }));
vi.mock('../config/brandScope', () => ({ BRAND_FEATURES: brand }));

const api = vi.hoisted(() => ({ getNftClaim: vi.fn(), submitNftClaim: vi.fn() }));
vi.mock('../lib/api', async () => ({ ...(await vi.importActual<typeof import('../lib/api')>('../lib/api')), ...api }));

import { NftClaimPage } from './NftClaimPage';
import { NftClaimError } from '../lib/api';

const TOKEN = 'T'.repeat(43);
const ADDR = '0x' + 'ab'.repeat(20);
const INFO = {
  partyName: 'Slice Night',
  eventImageUrl: null,
  chain: 'base',
  expiresAt: '2027-01-01T00:00:00Z',
  paused: false,
  status: 'issued',
  txHash: null,
  explorerUrl: null,
  maskedRecipient: null,
};

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={[`/nft/claim/${TOKEN}`]}>
      <Routes>
        <Route path="/nft/claim/:token" element={<NftClaimPage />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  wallet.address = undefined;
  brand.nftMinting = true;
  api.getNftClaim.mockResolvedValue(INFO);
});

describe('NftClaimPage', () => {
  it('shows the event, the chain badge and a placeholder-only wallet field', async () => {
    renderPage();
    expect(await screen.findByText(/Slice Night/)).toBeInTheDocument();
    expect(screen.getByTestId('nft-chain-badge')).toHaveTextContent('Base');
    expect(screen.getByPlaceholderText(/Wallet address or ENS name/)).toBeInTheDocument();
    expect(document.querySelector('label')).toBeNull();
  });

  it('auto-fills the field from a connected wallet', async () => {
    wallet.address = ADDR;
    renderPage();
    const input = (await screen.findByPlaceholderText(/Wallet address or ENS name/)) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe(ADDR));
  });

  it('confirms the address before minting, then shows the explorer link', async () => {
    api.submitNftClaim.mockResolvedValue({ status: 'minted', txHash: '0xabc', explorerUrl: 'https://basescan.org/tx/0xabc', maskedRecipient: '0xabab...abab' });
    renderPage();
    const user = userEvent.setup();
    await user.type(await screen.findByPlaceholderText(/Wallet address or ENS name/), ADDR);
    await user.click(screen.getByRole('button', { name: 'Claim NFT' }));

    expect(await screen.findByTestId('nft-claim-confirm')).toHaveTextContent(ADDR);
    expect(screen.getByTestId('nft-claim-confirm')).toHaveTextContent('Base');
    expect(api.submitNftClaim).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Confirm and mint' }));
    expect(await screen.findByTestId('nft-claim-done')).toBeInTheDocument();
    expect(api.submitNftClaim).toHaveBeenCalledWith(TOKEN, ADDR);
    expect(screen.getByRole('link', { name: /View transaction/ })).toHaveAttribute('href', 'https://basescan.org/tx/0xabc');
  });

  it('lets the guest go back and change the address', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.type(await screen.findByPlaceholderText(/Wallet address or ENS name/), 'alice.eth');
    await user.click(screen.getByRole('button', { name: 'Claim NFT' }));
    await user.click(await screen.findByRole('button', { name: 'Change address' }));
    expect(screen.getByPlaceholderText(/Wallet address or ENS name/)).toHaveValue('alice.eth');
  });

  it('shows the error from a failed mint and keeps the form', async () => {
    api.submitNftClaim.mockRejectedValue(new NftClaimError('x', 'invalid_address', 400));
    renderPage();
    const user = userEvent.setup();
    await user.type(await screen.findByPlaceholderText(/Wallet address or ENS name/), 'nonsense');
    await user.click(screen.getByRole('button', { name: 'Claim NFT' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm and mint' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/valid 0x address/);
    expect(screen.getByPlaceholderText(/Wallet address or ENS name/)).toBeInTheDocument();
  });

  it('expired / unknown link: friendly not-valid state', async () => {
    api.getNftClaim.mockRejectedValue(new NftClaimError('nope', 'not_found', 404));
    renderPage();
    expect(await screen.findByText("This link isn't valid")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Wallet address/)).toBeNull();
  });

  it('already minted: shows the result, no form', async () => {
    api.getNftClaim.mockResolvedValue({ ...INFO, status: 'minted', maskedRecipient: '0xabab...abab', explorerUrl: 'https://basescan.org/tx/0x1' });
    renderPage();
    expect(await screen.findByTestId('nft-claim-already')).toHaveTextContent('Already claimed');
    expect(screen.queryByPlaceholderText(/Wallet address/)).toBeNull();
  });

  it('minting paused (no daily cap): friendly message, no form', async () => {
    api.getNftClaim.mockResolvedValue({ ...INFO, paused: true });
    renderPage();
    expect(await screen.findByText('Claiming opens soon')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Wallet address/)).toBeNull();
  });

  it('branded build: not available, and the API is never called', async () => {
    brand.nftMinting = false;
    renderPage();
    expect(await screen.findByText('Not available here')).toBeInTheDocument();
    expect(api.getNftClaim).not.toHaveBeenCalled();
  });
});
