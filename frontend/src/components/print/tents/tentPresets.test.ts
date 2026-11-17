import { describe, it, expect } from 'vitest';
import { BRAND } from '../../../config/brand';
import { flyerEventUrl } from '../../generative/flyerQr';
import { tentQrUrl, isHttpUrl, presetContent, qrCaption } from './tentPresets';

const party = { customUrl: 'slice-night', inviteCode: 'abc' };

describe('tentPresets', () => {
  it('event QR equals flyerEventUrl and uses the brand origin', () => {
    expect(tentQrUrl('event', party, '')).toBe(flyerEventUrl(party));
    expect(tentQrUrl('event', party, '')!.startsWith(BRAND.url)).toBe(true);
  });
  it('booth URL', () => {
    expect(tentQrUrl('booth', party, '')).toBe(`${BRAND.url}/slice-night/booth`);
    expect(tentQrUrl('booth', { customUrl: null, inviteCode: 'abc' }, '')).toBe(`${BRAND.url}/abc/booth`);
  });
  it('custom URLs only accepted if http(s)', () => {
    expect(tentQrUrl('custom', party, 'https://example.com/x')).toBe('https://example.com/x');
    expect(tentQrUrl('custom', party, 'javascript:alert(1)')).toBeNull();
    expect(tentQrUrl('custom', party, 'example.com')).toBeNull();
    expect(isHttpUrl('ftp://x.y')).toBe(false);
    expect(tentQrUrl('none', party, '')).toBeNull();
  });
  it('presets', () => {
    const s = { rsvpHeadline: 'Scan', rsvpBody: 'b', wifiHeadline: 'WiFi' };
    expect(presetContent('rsvp', {}, s).qr).toBe('event');
    expect(presetContent('wifi', { wifiInfo: 'net / pw' }, s)).toMatchObject({ headline: 'WiFi', body: 'net / pw', qr: 'none' });
    expect(presetContent('custom', {}, s).headline).toBe('');
  });
  it('caption drops scheme', () => {
    expect(qrCaption('https://x.test/a/')).toBe('x.test/a');
  });
});
