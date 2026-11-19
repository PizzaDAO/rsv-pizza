import { useEffect, useState } from 'react';
import QRCodeLib from 'qrcode';

/**
 * One QR data URL for the whole sheet, generated once (not once per badge). Returns null while
 * generating or when `value` is empty. Same options as QRCode.tsx; stays in the browser.
 */
export function useQrDataUrl(value: string | null, size = 240, margin = 1): string | null {
  const [state, setState] = useState<{ value: string; src: string } | null>(null);
  useEffect(() => {
    if (!value) return;
    let cancelled = false;
    QRCodeLib.toDataURL(value, { margin, width: size * 2, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } })
      .then((src) => {
        if (!cancelled) setState({ value, src });
      })
      .catch(() => {
        if (!cancelled) setState(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value, size, margin]);
  return value && state && state.value === value ? state.src : null;
}
