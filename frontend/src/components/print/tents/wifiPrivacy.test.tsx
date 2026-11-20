import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn(() => Promise.resolve('data:image/png;base64,AAAA')) },
}));
const PARTY = { id: 'p1', name: 'Slice Night', inviteCode: 'abc', customUrl: 'slice', wifiInfo: null, date: null, timezone: null };
vi.mock('../../../contexts/PizzaContext', () => ({ usePizza: () => ({ party: PARTY, guests: [] }) }));
vi.mock('../../../lib/api', () => ({ getSponsors: vi.fn() }));

import { QRCode } from '../../QRCode';
import { TableTentPage } from './TableTentSheet';
import { TableTentBuilder } from './TableTentBuilder';
import { wifiQrString } from './wifiQr';

const SECRET = 'hunter2-s3cret';

describe('wifi password never reaches the DOM', () => {
  it('QRCode keeps data-qr-url by default but can opt out', async () => {
    const { container, rerender } = render(<QRCode value="https://x.test/a" size={50} alt="a" />);
    await waitFor(() => expect(container.querySelector('img')).toBeTruthy());
    expect(container.innerHTML).toContain('data-qr-url="https://x.test/a"');
    rerender(<QRCode value={`WIFI:T:WPA;S:n;P:${SECRET};;`} size={50} alt="a" exposeValue={false} />);
    await waitFor(() => expect(container.querySelector('img')).toBeTruthy());
    expect(container.innerHTML).not.toContain(SECRET);
    expect(container.innerHTML).not.toContain('data-qr-url');
  });

  it('tent page with a wifi payload has no password in innerHTML (front, back, caption)', async () => {
    const payload = wifiQrString({ ssid: 'Net', password: SECRET, security: 'WPA' })!;
    const data = { eventName: 'E', headline: 'WiFi', body: '', dateLine: null, qrUrl: payload, qrSensitive: true, logoUrl: null };
    const { container } = render(<TableTentPage paper="letter" data={data} backData={{ ...data, headline: 'Back' }} />);
    await waitFor(() => expect(container.querySelector('img')).toBeTruthy());
    expect(container.innerHTML).not.toContain(SECRET);
    expect(container.innerHTML).not.toContain('WIFI:');
  });

  it('builder: password field is masked with a toggle and the secret is not in innerHTML', async () => {
    const { container } = render(<TableTentBuilder />);
    fireEvent.click(screen.getByRole('radio', { name: 'print.tents.qrWifi' }));
    expect(screen.getByText('print.tents.wifiPasswordHint')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('print.tents.wifiSsidPlaceholder'), { target: { value: ' Net ' } });
    const pw = screen.getByPlaceholderText('print.tents.wifiPasswordPlaceholder') as HTMLInputElement;
    expect(pw.type).toBe('password');
    fireEvent.change(pw, { target: { value: SECRET } });
    expect(screen.queryByText('print.tents.wifiPasswordHint')).toBeNull();
    await waitFor(() => expect(container.querySelector('[data-tent-qr] img')).toBeTruthy());
    // Everything that prints (and the on-screen preview of it) must not carry the password.
    // (The masked input itself legitimately holds its own value.)
    const preview = screen.getByTestId('print-preview');
    expect(preview.innerHTML).not.toContain(SECRET);
    expect(preview.innerHTML).not.toContain('WIFI:');
    fireEvent.click(screen.getByRole('button', { name: 'print.tents.wifiShowPassword' }));
    expect(pw.type).toBe('text');
  });

  it('different back puts different text on the upside-down panel', () => {
    const base = { eventName: null, headline: 'Front', body: '', dateLine: null, qrUrl: null, logoUrl: null };
    const { container } = render(<TableTentPage paper="a4" data={base} backData={{ ...base, headline: 'Back side' }} />);
    expect(container.querySelector('[data-tent-top]')!.textContent).toContain('Back side');
    expect(container.querySelector('[data-tent-bottom]')!.textContent).toContain('Front');
  });
});
