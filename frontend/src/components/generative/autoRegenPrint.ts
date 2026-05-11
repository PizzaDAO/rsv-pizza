/**
 * Auto-regenerate poster and rollup images when event details change.
 *
 * Exports:
 *   triggerPosterRegen(party)   — debounced (10s)
 *   triggerRollupRegen(party)   — debounced (10s)
 *   cancelPosterRegen(partyId)
 *   cancelRollupRegen(partyId)
 */

import { renderCanvas } from './renderCanvas';
import { POSTER_CONFIG } from './configs/posterConfig';
import { ROLLUP_CONFIG } from './configs/rollupConfig';
import type { FormatConfig, CanvasPositions } from './types';
import { uses12Hour, formatFlyerTime } from '../flyer/renderFlyer';
import { getDateTimeInTimezone } from '../../utils/dateUtils';
import { uploadEventImage, updateParty } from '../../lib/supabase';
import { getSponsors } from '../../lib/api';
import type { Party } from '../../types';

// Debounce maps
const posterTimers = new Map<string, ReturnType<typeof setTimeout>>();
const rollupTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function cancelPosterRegen(partyId: string): void {
  const timer = posterTimers.get(partyId);
  if (timer) {
    clearTimeout(timer);
    posterTimers.delete(partyId);
  }
}

export function cancelRollupRegen(partyId: string): void {
  const timer = rollupTimers.get(partyId);
  if (timer) {
    clearTimeout(timer);
    rollupTimers.delete(partyId);
  }
}

function triggerRegen(
  party: Party,
  config: FormatConfig,
  timers: Map<string, ReturnType<typeof setTimeout>>,
  cancelFn: (id: string) => void,
): void {
  if (party.eventType !== 'gpp') return;

  // Skip if localStorage has custom positions (no DB override)
  const customKey = config.storageKey(party.id);
  try {
    if (localStorage.getItem(customKey)) return;
  } catch {
    // localStorage unavailable — continue
  }

  cancelFn(party.id);

  const timer = setTimeout(() => {
    timers.delete(party.id);
    doRegen(party, config).catch((err) => {
      console.error(`[autoRegenPrint] ${config.id} regen failed:`, err);
    });
  }, 10000);

  timers.set(party.id, timer);
}

export function triggerPosterRegen(party: Party): void {
  triggerRegen(party, POSTER_CONFIG, posterTimers, cancelPosterRegen);
}

export function triggerRollupRegen(party: Party): void {
  triggerRegen(party, ROLLUP_CONFIG, rollupTimers, cancelRollupRegen);
}

// Font loading (shared)
let _fontsLoaded = false;
async function ensureFonts(): Promise<void> {
  if (_fontsLoaded) return;
  try {
    const regular = new FontFace('Hub 191', 'url(/fonts/Hub-191-Regular.otf)');
    const display = new FontFace('Hub 191 Display', 'url(/fonts/Hub-191-Display.otf)');
    const [reg, disp] = await Promise.all([regular.load(), display.load()]);
    document.fonts.add(reg);
    document.fonts.add(disp);
    _fontsLoaded = true;
  } catch (err) {
    console.warn('[autoRegenPrint] font load failed:', err);
  }
}

function parseCityFromName(name: string): string {
  return name.replace(/^Global Pizza Party\s*/i, '').trim() || name;
}

function buildDefaultPositions(config: FormatConfig): CanvasPositions {
  const positions: CanvasPositions = {};
  for (const field of config.textFields) {
    positions[field.key] = { x: field.defaultX, y: field.defaultY };
  }
  positions.sponsors = { x: config.sponsorBox.defaultX, y: config.sponsorBox.defaultY };
  return positions;
}

async function doRegen(party: Party, config: FormatConfig): Promise<void> {
  await ensureFonts();

  const sponsorResult = await getSponsors(party.id);
  const sponsors = (sponsorResult?.sponsors ?? []).filter(
    (s) => s.logoUrl && (s.status === 'yes' || s.status === 'paid'),
  );

  const city = parseCityFromName(party.name);
  const venueName = party.venueName || 'LOCATION TBA';
  const streetAddress = party.address ? party.address.split(',')[0].trim() : '';

  let dateDisplay = '';
  let timeDisplay = '';

  if (party.date) {
    const tz = party.timezone || 'UTC';
    const is12h = uses12Hour(tz);
    const start = getDateTimeInTimezone(party.date, tz);
    const startFormatted = formatFlyerTime(start.timeStr, is12h);
    timeDisplay = startFormatted;

    if (party.duration) {
      const endDate = new Date(new Date(party.date).getTime() + party.duration * 3600000);
      const end = getDateTimeInTimezone(endDate, tz);
      const endFormatted = formatFlyerTime(end.timeStr, is12h);
      timeDisplay = `${startFormatted} - ${endFormatted}`;
    }

    const eventDate = new Date(party.date);
    const monthFormatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short' });
    const dayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, day: 'numeric' });
    dateDisplay = `${monthFormatter.format(eventDate).toUpperCase()} ${dayFormatter.format(eventDate)}`;
  }

  const positions = buildDefaultPositions(config);

  const canvas = await renderCanvas({
    config,
    positions,
    textValues: { city, dateDisplay, timeDisplay, venueName, streetAddress },
    sponsors: sponsors.map((s) => ({ id: s.id, logoUrl: s.logoUrl! })),
    sponsorBoxSize: { width: config.sponsorBox.width, height: config.sponsorBox.height },
    logoSizes: {},
    poppedLogos: {},
  });

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/png'),
  );
  if (!blob) {
    console.error(`[autoRegenPrint] canvas.toBlob returned null for ${config.id}`);
    return;
  }

  const file = new File(
    [blob],
    `gpp-${config.id}-${party.customUrl || party.inviteCode || party.id}.png`,
    { type: 'image/png' },
  );
  const uploadedUrl = await uploadEventImage(file);
  if (!uploadedUrl) {
    console.error(`[autoRegenPrint] upload failed for ${config.id}`);
    return;
  }

  const success = await updateParty(party.id, {
    [config.dbImageField]: uploadedUrl,
    [config.dbTimestampField]: new Date().toISOString(),
  } as any);
  if (!success) {
    console.error(`[autoRegenPrint] updateParty failed for ${config.id}`);
  }
}
