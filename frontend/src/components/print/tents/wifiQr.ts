export type WifiSecurity = 'WPA' | 'WEP' | 'nopass';

/** Escape the characters that are special in the WIFI: payload: \ ; , : " */
export function escapeWifi(s: string): string {
  return s.replace(/[\\;,:"]/g, '\\$&');
}

/**
 * Standard Wi-Fi join payload: WIFI:T:WPA;S:<ssid>;P:<pw>;;
 * Returns null without an SSID, or for WPA/WEP without a password. Open networks omit the password. The password is only ever
 * passed through here at render time; callers must never persist or log it.
 */
export function wifiQrString(opts: { ssid: string; password: string; security: WifiSecurity }): string | null {
  const trimmed = opts.ssid.trim();
  if (!trimmed) return null;
  const ssid = escapeWifi(trimmed);
  if (opts.security === 'nopass') return `WIFI:T:nopass;S:${ssid};;`;
  // A secured network needs a password; a code without one would just fail to join.
  if (!opts.password) return null;
  return `WIFI:T:${opts.security};S:${ssid};P:${escapeWifi(opts.password)};;`;
}
