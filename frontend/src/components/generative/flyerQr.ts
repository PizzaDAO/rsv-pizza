import QRCodeLib from 'qrcode';
import { brandUrl } from '../../config/brand';
import type { FlyerQrConfig } from './types';

/** Public event URL encoded in flyer QR codes: custom slug if set, else invite code (brand domain). */
export function flyerEventUrl(party: { customUrl?: string | null; inviteCode?: string | null }): string | null {
  const slug = party.customUrl || party.inviteCode;
  return slug ? brandUrl(slug) : null;
}

/** Quiet zone in modules (QR spec minimum is 4). */
export const QR_QUIET_MODULES = 4;
/** Share of the tile height used by the caption band when a caption is set. */
export const QR_CAPTION_BAND = 0.14;

export function qrCaptionBandHeight(qr: FlyerQrConfig): number {
  return qr.caption ? qr.size * QR_CAPTION_BAND : 0;
}

/**
 * Draw the QR tile onto a canvas. Generated locally (qrcode lib), error correction M.
 * `s` is the canvas scale factor (full-res / canvas px); modules are snapped to whole pixels
 * so the code stays crisp and scannable at any output size.
 */
export function drawFlyerQr(ctx: CanvasRenderingContext2D, qr: FlyerQrConfig, url: string, s: number): void {
  const code = QRCodeLib.create(url, { errorCorrectionLevel: 'M' });
  const n = code.modules.size;
  const data = code.modules.data;

  const T = qr.size * s;
  const x = qr.x * s;
  const y = qr.y * s;
  const band = qrCaptionBandHeight(qr) * s;
  const area = T - band;

  ctx.save();
  ctx.fillStyle = qr.tileColor;
  ctx.beginPath();
  const r = (qr.radius ?? 0) * s;
  if (r > 0 && ctx.roundRect) ctx.roundRect(x, y, T, T, r);
  else ctx.rect(x, y, T, T);
  ctx.fill();

  const m = Math.max(1, Math.floor(area / (n + QR_QUIET_MODULES * 2)));
  const qrPx = m * n;
  const ox = x + (T - qrPx) / 2;
  const oy = y + (area - qrPx) / 2;
  ctx.fillStyle = qr.dark;
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (data[row * n + col]) ctx.fillRect(Math.round(ox + col * m), Math.round(oy + row * m), m, m);
    }
  }

  if (qr.caption) {
    ctx.fillStyle = qr.captionColor ?? qr.dark;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${band * 0.62}px "Hub 191", "Comic Sans MS", sans-serif`;
    ctx.fillText(qr.caption, x + T / 2, y + T - band * 0.55);
  }
  ctx.restore();
}
