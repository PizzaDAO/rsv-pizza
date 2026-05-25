import { loadImg } from '../flyer/renderFlyer';
import type { Party } from '../../types';

/**
 * napoli-93184: Pure render function that draws a 1200x630 host-progress
 * card to the provided canvas. No React — call from a hook or event handler.
 *
 * Per FlyerGenerator prior-art (`FlyerGenerator.tsx`): we use the native
 * Canvas 2D API rather than html-to-image / html2canvas, because DOM-snapshot
 * libs mangle the project's custom font ("Hub 191 Display"). Same reason
 * applies here for the hero number.
 *
 * Only same-origin assets are drawn — `pizzadao-logo.svg` is local. We
 * deliberately skip `party.eventImageUrl` (could be cross-origin and would
 * taint the canvas, blocking `toBlob`).
 */

export interface DrawProgressCardOpts {
  party: Pick<Party, 'name' | 'date' | 'customUrl' | 'inviteCode'>;
  totalRsvps: number;
  rank: { rank: number; total: number } | null;
}

const CANVAS_W = 1200;
const CANVAS_H = 630;

const RED = '#ff393a';
const WHITE = '#ffffff';
const WHITE_DIM = 'rgba(255,255,255,0.85)';

const TEXT_FONT = '"Hub 191", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
const HERO_FONT = '"Hub 191 Display", "Hub 191", -apple-system, BlinkMacSystemFont, system-ui, sans-serif';

/**
 * Resize the given canvas to 1200x630 and draw the progress card.
 * Caller is responsible for awaiting `document.fonts.ready` before calling.
 */
export async function drawProgressCard(
  canvas: HTMLCanvasElement,
  opts: DrawProgressCardOpts,
): Promise<void> {
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('drawProgressCard: 2D context unavailable');

  // 1) Solid red background
  ctx.fillStyle = RED;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // 2) Soft white radial gradient overlay top-left (12% peak alpha)
  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 900);
  grad.addColorStop(0, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  ctx.textBaseline = 'top';

  // 3) Top-left: event name (48px) + date (24px)
  ctx.fillStyle = WHITE;
  ctx.font = `48px ${TEXT_FONT}`;
  const eventName = (opts.party.name || '').trim() || 'Event';
  // Soft truncation: cap to ~700px width
  const nameMaxW = 700;
  let displayName = eventName;
  if (ctx.measureText(displayName).width > nameMaxW) {
    while (displayName.length > 1 && ctx.measureText(displayName + '…').width > nameMaxW) {
      displayName = displayName.slice(0, -1);
    }
    displayName = displayName + '…';
  }
  ctx.fillText(displayName, 60, 60);

  // Date row — hide if no date
  if (opts.party.date) {
    let dateText = '';
    try {
      const d = new Date(opts.party.date);
      if (!Number.isNaN(d.getTime())) {
        const lang = typeof navigator !== 'undefined' ? navigator.language : 'en-US';
        dateText = d.toLocaleDateString(lang, { dateStyle: 'long' });
      }
    } catch {
      dateText = '';
    }
    if (dateText) {
      ctx.fillStyle = WHITE_DIM;
      ctx.font = `24px ${TEXT_FONT}`;
      ctx.fillText(dateText, 60, 130);
    }
  }

  // 4) Center hero — totalRsvps (240px, Hub 191 Display)
  const heroText = String(opts.totalRsvps ?? 0);
  ctx.fillStyle = WHITE;
  ctx.font = `240px ${HERO_FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(heroText, CANVAS_W / 2, 220);

  // Label beneath
  ctx.font = `32px ${TEXT_FONT}`;
  ctx.fillStyle = WHITE_DIM;
  ctx.fillText('RSVPs', CANVAS_W / 2, 480);

  ctx.textAlign = 'left';

  // 5) Bottom-left: leaderboard rank (only if present)
  if (opts.rank && opts.rank.total > 0) {
    ctx.fillStyle = WHITE;
    ctx.font = `28px ${TEXT_FONT}`;
    ctx.fillText(`#${opts.rank.rank} of ${opts.rank.total}`, 60, 540);
  }

  // 6) Bottom-right: pizzadao logo (80x80) + URL
  try {
    const logo = await loadImg('/pizzadao-logo.svg');
    ctx.drawImage(logo, 1040, 470, 80, 80);
  } catch {
    // Logo failed to load — skip silently, card still useful.
  }

  const slug = opts.party.customUrl || opts.party.inviteCode || '';
  const urlText = slug ? `rsv.pizza/${slug}` : 'rsv.pizza';
  ctx.fillStyle = WHITE_DIM;
  ctx.font = `20px ${TEXT_FONT}`;
  ctx.textAlign = 'right';
  ctx.fillText(urlText, 1140, 570);
  ctx.textAlign = 'left';
}
