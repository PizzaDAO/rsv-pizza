import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  fetchBrandDomain: vi.fn(), requestBrandDomain: vi.fn(), cancelBrandDomain: vi.fn(), checkBrandDomain: vi.fn(),
  attachBrandDomain: vi.fn(), cutoverBrandDomain: vi.fn(), rollbackBrandDomain: vi.fn(),
  fetchBrandEmailDomain: vi.fn(), saveBrandEmailDomain: vi.fn(), checkBrandEmailDomain: vi.fn(), removeBrandEmailDomain: vi.fn(),
}));
vi.mock('../../lib/brandAdminApi', async (orig) => ({ ...(await orig<typeof import('../../lib/brandAdminApi')>()), ...api }));

import { DomainPanel, domainChip } from './DomainPanel';
import { EmailDomainPanel, emailChip } from './EmailDomainPanel';
import { recordTone } from './DnsRecordsTable';

const SID = '11111111-1111-4111-8111-111111111111';
const domainState = (over: Record<string, unknown> = {}) => ({
  siteUrl: 'https://acme.example.org', aliases: [], domain: null, status: null, checkedAt: null, records: [], checks: null, steps: [],
  projectMapped: true, configured: { vercel: true, resend: true }, ...over,
});
const withDomain = (status: string, over: Record<string, unknown> = {}) => domainState({
  domain: 'events.partner.example.org', status,
  records: [
    { purpose: 'ownership', type: 'TXT', name: '_rsvpizza.events.partner.example.org', value: 'rsvpizza-verify=abc' },
    { purpose: 'site', type: 'CNAME', name: 'events.partner.example.org', value: 'cname.vercel-dns.com' },
  ], ...over,
});

beforeEach(() => { vi.clearAllMocks(); });

describe('DomainPanel', () => {
  it('requests a domain from the placeholder-only input', async () => {
    api.fetchBrandDomain.mockResolvedValue(domainState());
    api.requestBrandDomain.mockResolvedValue(withDomain('requested'));
    render(<DomainPanel seriesId={SID} isSuperAdmin={false} />);
    const input = await screen.findByPlaceholderText('events.yourdomain.com');
    expect(screen.getByRole('button', { name: 'Request this domain' })).toBeDisabled();
    fireEvent.change(input, { target: { value: 'events.partner.example.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request this domain' }));
    await waitFor(() => expect(api.requestBrandDomain).toHaveBeenCalledWith(SID, 'events.partner.example.org'));
    expect(await screen.findByText('_rsvpizza.events.partner.example.org')).toBeTruthy();
    expect(screen.getByText('rsvpizza-verify=abc')).toBeTruthy();
    expect(screen.getByText('Waiting for your DNS records')).toBeTruthy();
  });

  it('brand admins never see the PizzaDAO admin buttons', async () => {
    api.fetchBrandDomain.mockResolvedValue(withDomain('ready'));
    render(<DomainPanel seriesId={SID} isSuperAdmin={false} />);
    await screen.findByTestId('domain-panel');
    await screen.findAllByText('events.partner.example.org');
    expect(screen.queryByTestId('domain-super-admin')).toBeNull();
    expect(screen.queryByText(/Cut over/)).toBeNull();
    expect(screen.queryByText(/Attach to site project/)).toBeNull();
    expect(screen.queryByText(/Roll back/)).toBeNull();
  });

  it('super-admin: attach only at dns_ok; cutover needs ready plus the acknowledgement; shows the manual steps', async () => {
    api.fetchBrandDomain.mockResolvedValue(withDomain('dns_ok'));
    api.attachBrandDomain.mockResolvedValue(withDomain('attached'));
    const { unmount } = render(<DomainPanel seriesId={SID} isSuperAdmin />);
    const attach = await screen.findByRole('button', { name: 'Attach to site project' });
    expect(attach).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Cut over to this domain' })).toBeDisabled();
    fireEvent.click(attach);
    await waitFor(() => expect(api.attachBrandDomain).toHaveBeenCalledWith(SID));
    unmount();

    api.fetchBrandDomain.mockResolvedValue(withDomain('ready'));
    api.cutoverBrandDomain.mockResolvedValue(withDomain('live', { steps: ['Update VITE_BRAND_DOMAIN to events.partner.example.org'] }));
    render(<DomainPanel seriesId={SID} isSuperAdmin />);
    const cut = await screen.findByRole('button', { name: 'Cut over to this domain' });
    expect(cut).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /log in again/ }));
    expect(cut).toBeEnabled();
    fireEvent.click(cut);
    await waitFor(() => expect(api.cutoverBrandDomain).toHaveBeenCalledWith(SID, true));
    expect(await screen.findByTestId('domain-steps')).toHaveTextContent('VITE_BRAND_DOMAIN');
    expect(screen.getByRole('button', { name: 'Roll back' })).toBeEnabled();
  });

  it('check now shows the live results and a clear error on a failure', async () => {
    api.fetchBrandDomain.mockResolvedValue(withDomain('requested'));
    api.checkBrandDomain.mockResolvedValueOnce(withDomain('dns_ok', { changed: true, checks: { txtOk: true, cnameOk: false } }));
    render(<DomainPanel seriesId={SID} isSuperAdmin={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check now' }));
    expect(await screen.findByText('Ownership record found')).toBeTruthy();
    expect(screen.getByText('Domain not pointing at the site yet')).toBeTruthy();

    api.checkBrandDomain.mockRejectedValueOnce(Object.assign(new Error('Too many checks.'), { code: 'RATE_LIMITED' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many checks.');
  });

  it('a server that is not configured gets a plain message', async () => {
    api.fetchBrandDomain.mockResolvedValue(withDomain('dns_ok'));
    api.attachBrandDomain.mockRejectedValue(Object.assign(new Error('x'), { code: 'NOT_CONFIGURED' }));
    render(<DomainPanel seriesId={SID} isSuperAdmin />);
    fireEvent.click(await screen.findByRole('button', { name: 'Attach to site project' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not set up on the server');
  });

  it('chips', () => {
    expect(domainChip(null).text).toBe('No custom domain');
    expect(domainChip('live').tone).toBe('ok');
    expect(domainChip('attached').tone).toBe('warn');
  });
});

const emailState = (over: Record<string, unknown> = {}) => ({
  emailDomain: null, emailFromAddress: null, verified: false, verifiedAt: null, status: null, records: [],
  configured: { vercel: true, resend: true }, ...over,
});
const withEmail = (over: Record<string, unknown> = {}) => emailState({
  emailDomain: 'mail.partner.example.org', emailFromAddress: 'events@mail.partner.example.org', status: 'pending',
  records: [
    { purpose: 'email', type: 'TXT', name: 'resend._domainkey.mail.partner.example.org', value: 'p=KEY', status: 'pending', note: 'DKIM' },
    { purpose: 'email', type: 'MX', name: 'send.mail.partner.example.org', value: 'feedback-smtp.us-east-1.amazonses.com', priority: 10, status: 'verified', note: 'SPF' },
  ], ...over,
});

describe('EmailDomainPanel', () => {
  it('saves a sender and shows the records and per-record status', async () => {
    api.fetchBrandEmailDomain.mockResolvedValue(emailState());
    api.saveBrandEmailDomain.mockResolvedValue(withEmail());
    render(<EmailDomainPanel seriesId={SID} />);
    fireEvent.change(await screen.findByPlaceholderText(/Sending subdomain/), { target: { value: 'mail.partner.example.org' } });
    fireEvent.change(screen.getByPlaceholderText(/From address/), { target: { value: 'events@mail.partner.example.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and get DNS records' }));
    await waitFor(() => expect(api.saveBrandEmailDomain).toHaveBeenCalledWith(SID, 'mail.partner.example.org', 'events@mail.partner.example.org'));
    expect(await screen.findByText('resend._domainkey.mail.partner.example.org')).toBeTruthy();
    expect(screen.getByText('Found')).toBeTruthy();
    expect(screen.getByText('Waiting')).toBeTruthy();
  });

  it('check now verifies and reports it', async () => {
    api.fetchBrandEmailDomain.mockResolvedValue(withEmail());
    api.checkBrandEmailDomain.mockResolvedValue(withEmail({ verified: true, verifiedAt: '2026-11-17T10:00:00Z', status: 'verified' }));
    render(<EmailDomainPanel seriesId={SID} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check now' }));
    expect(await screen.findByText(/Your emails now come from your address/)).toBeTruthy();
    expect(screen.getByText('Verified, sending from your address')).toBeTruthy();
  });

  it('the Save button stays disabled until something changed', async () => {
    api.fetchBrandEmailDomain.mockResolvedValue(withEmail());
    render(<EmailDomainPanel seriesId={SID} />);
    expect(await screen.findByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('chips and record tones', () => {
    expect(emailChip({ emailDomain: null, verified: false, status: null }).text).toBe('Using the default sender');
    expect(emailChip({ emailDomain: 'm.example.org', verified: false, status: 'failed' }).tone).toBe('error');
    expect(emailChip({ emailDomain: 'm.example.org', verified: true, status: 'verified' }).tone).toBe('ok');
    expect(recordTone('verified')).toBe('ok');
    expect(recordTone('not_started')).toBe('warn');
  });
});
