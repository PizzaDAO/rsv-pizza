import { describe, it, expect } from 'vitest';
import { escapeWifi, wifiQrString } from './wifiQr';

describe('wifiQr', () => {
  it('escapes backslash, semicolon, comma, colon and quote', () => {
    expect(escapeWifi('a\\b;c,d:e"f')).toBe('a\\\\b\\;c\\,d\\:e\\"f');
    expect(escapeWifi('plain')).toBe('plain');
  });
  it('encodes WPA', () => {
    expect(wifiQrString({ ssid: 'My Net', password: 'p;w:1', security: 'WPA' })).toBe('WIFI:T:WPA;S:My Net;P:p\\;w\\:1;;');
  });
  it('encodes WEP and open networks', () => {
    expect(wifiQrString({ ssid: 'x', password: 'k', security: 'WEP' })).toBe('WIFI:T:WEP;S:x;P:k;;');
    expect(wifiQrString({ ssid: 'x', password: 'ignored', security: 'nopass' })).toBe('WIFI:T:nopass;S:x;;');
  });
  it('needs an SSID', () => {
    expect(wifiQrString({ ssid: '  ', password: 'k', security: 'WPA' })).toBeNull();
  });
});
