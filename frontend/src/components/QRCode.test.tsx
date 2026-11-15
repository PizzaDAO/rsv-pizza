import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QRCode } from './QRCode';

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn(() => Promise.resolve('data:image/png;base64,AAAA')) },
}));

describe('QRCode', () => {
  it('renders a local data-URL image at the requested size, with no network QR service', async () => {
    render(<QRCode value="https://example.com/checkin/abc/g1" size={250} alt="Check-in QR code" />);
    const img = await waitFor(() => screen.getByAltText('Check-in QR code'));
    expect(img.getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(img.getAttribute('width')).toBe('250');
    expect(img.getAttribute('height')).toBe('250');
    expect(img.getAttribute('src')).not.toContain('qrserver');
  });
});
