import { useEffect, useState } from 'react';
import QRCodeLib from 'qrcode';

interface QRCodeProps {
  /** Text/URL to encode. Rendered entirely in the browser; never sent to a third party. */
  value: string;
  /** Rendered width/height in CSS pixels (including the quiet-zone margin). */
  size: number;
  alt?: string;
  className?: string;
  /** Quiet zone in modules (default 1, matching the old qrserver look). */
  margin?: number;
  dark?: string;
  light?: string;
}

/** Local QR code (replaces api.qrserver.com so event / check-in links stay private). */
export function QRCode({ value, size, alt = 'QR code', className, margin = 1, dark = '#000000', light = '#ffffff' }: QRCodeProps) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCodeLib.toDataURL(value, {
      margin,
      width: size * 2, // 2x for crisp rendering on hi-dpi screens
      errorCorrectionLevel: 'M',
      color: { dark, light },
    })
      .then((d) => { if (!cancelled) setSrc(d); })
      .catch(() => { if (!cancelled) setSrc(null); });
    return () => { cancelled = true; };
  }, [value, size, margin, dark, light]);

  if (!src) {
    // Reserve the space so layout doesn't jump while the code renders.
    return <div className={className} style={{ width: size, height: size }} aria-hidden="true" data-qr-pending="true" />;
  }
  return <img src={src} alt={alt} width={size} height={size} className={className} data-qr-url={value} />;
}
