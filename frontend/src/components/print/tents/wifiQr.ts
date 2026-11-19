export type WifiSecurity = 'WPA' | 'WEP' | 'nopass';

/** Escape the characters that are special in the WIFI: payload: \ ; , : " */
export function escapeWifi(s: string): string {
  return s.replace(/[\\;,:"]/g, '\\$&');
}

/**
 * Standard Wi-Fi join payload: WIFI:T:WPA;S:<ssid>;P:<pw>;;
 * Returns null without an SSID. Open networks omit the password. The password is only ever
 * passed through here at render time; callers must never persist or log it.
 */
export function wifiQrString(opts: { ssid: string; password: string; security: WifiSecurity }): string | null {
  if (!opts.ssid.trim()) return null;
  const ssid = escapeWifi(opts.ssid);
  if (opts.security === 'nopass') return `WIFI:T:nopass;S:${ssid};;`;
  return `WIFI:T:${opts.security};S:${ssid};P:${escapeWifi(opts.password)};;`;
}
