/**
 * Auto-regenerate GPP event flyers when partner status or event details change.
 *
 * Exports:
 *   triggerFlyerRegen(party, loadParty?)        — debounced entry point (3 s per party)
 *   triggerFlyerRegenForEvents(events)           — batch entry point for underboss context
 *   cancelFlyerRegen(partyId)                    — cancel a pending regen
 */

import { renderFlyer, uses12Hour, formatFlyerTime } from './renderFlyer';
import type { FlyerConfig } from './renderFlyer';
import { getDateTimeInTimezone } from '../../utils/dateUtils';
import { uploadEventImage, updateParty } from '../../lib/supabase';
import { getSponsors } from '../../lib/api';
import type { Party } from '../../types';

/**
 * Minimal data needed for flyer regeneration.
 * Both `Party` (host dashboard) and `UnderbossEvent` data satisfy this shape.
 */
export interface FlyerRegenData {
  id: string;
  name: string;
  venueName: string | null;
  address: string | null;
  date: string | null;
  timezone: string | null;
  duration: number | null;
  customUrl: string | null;
  inviteCode?: string | null;
  eventType?: string | null;
  flyerConfig?: Record<string, any> | null;
}

// ---- Debounce map (partyId → timer handle) ----
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Cancel any pending auto-regen for a given party. */
export function cancelFlyerRegen(partyId: string): void {
  const timer = pendingTimers.get(partyId);
  if (timer) {
    clearTimeout(timer);
    pendingTimers.delete(partyId);
  }
}

/**
 * Trigger an auto-regeneration of the GPP flyer.
 *
 * Gates:
 *  - party.eventType must be 'gpp'
 *  - localStorage must NOT contain custom positions for this party
 *
 * The actual render is debounced by 3 seconds per party so rapid edits
 * collapse into a single regeneration.
 */
export function triggerFlyerRegen(
  party: Party,
  loadParty?: (inviteCode: string) => Promise<boolean>,
): void {
  // Only GPP events get auto-regen
  if (party.eventType !== 'gpp') return;

  // If DB config exists, allow regen WITH customizations (it preserves them).
  // If only localStorage has custom positions (no DB config), skip regen to
  // avoid overwriting host layout (backwards compatibility).
  if (!party.flyerConfig) {
    const customKey = `flyer-${party.id}`;
    try {
      if (localStorage.getItem(customKey)) return;
    } catch {
      // localStorage unavailable — continue with regen
    }
  }

  // Cancel any existing pending regen for this party
  cancelFlyerRegen(party.id);

  // Schedule the regen with a 3-second debounce
  const timer = setTimeout(() => {
    pendingTimers.delete(party.id);
    doRegen(party, loadParty).catch((err) => {
      console.error('[autoRegenFlyer] failed:', err);
    });
  }, 3000);

  pendingTimers.set(party.id, timer);
}

/** Extract city name from the party name (strip "Global Pizza Party" prefix). */
function parseCityFromName(name: string): string {
  return name.replace(/^Global Pizza Party\s*/i, '').trim() || name;
}

let _fontsLoaded = false;

/** Ensure the Hub 191 fonts are loaded (idempotent). */
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
    console.warn('[autoRegenFlyer] font load failed, using fallbacks:', err);
  }
}

/**
 * Trigger flyer regen from underboss context where we have UnderbossEvent data
 * instead of a full Party object. Accepts multiple events for batch operations.
 * Regens sequentially with a small delay between each to avoid overwhelming the browser.
 */
export function triggerFlyerRegenForEvents(
  events: FlyerRegenData[],
): void {
  // Filter out events with localStorage-only custom positions (no DB config).
  // Events WITH DB flyerConfig are eligible — regen will use their saved config.
  const eligible = events.filter((e) => {
    if (e.flyerConfig) return true; // DB config present — regen with customizations
    try {
      if (localStorage.getItem(`flyer-${e.id}`)) return false;
    } catch {
      // localStorage unavailable — include the event
    }
    return true;
  });

  if (eligible.length === 0) return;

  // Process sequentially with ~500ms delay between each
  let idx = 0;
  function processNext() {
    if (idx >= eligible.length) return;
    const event = eligible[idx];
    idx++;

    // Cancel any existing pending regen for this event
    cancelFlyerRegen(event.id);

    doRegen(event).catch((err) => {
      console.error(`[autoRegenFlyer] batch regen failed for ${event.id}:`, err);
    }).finally(() => {
      if (idx < eligible.length) {
        setTimeout(processNext, 500);
      }
    });
  }

  // Kick off after a short initial delay (like the debounce for single events)
  setTimeout(processNext, 1000);
}

// ---- Internal helpers ----

/** The actual render → upload → update pipeline. */
async function doRegen(
  data: FlyerRegenData,
  loadParty?: (inviteCode: string) => Promise<boolean>,
): Promise<void> {
  // 1. Load fonts
  await ensureFonts();

  // 2. Fetch sponsors with logo + yes/paid status
  const sponsorResult = await getSponsors(data.id);
  const sponsors = (sponsorResult?.sponsors ?? []).filter(
    (s) => s.logoUrl && (s.status === 'yes' || s.status === 'paid'),
  );

  // 3. Derive flyer text fields from party data
  const dbConfig = data.flyerConfig as FlyerConfig | null | undefined;
  const city = parseCityFromName(data.name);
  const venueName = data.venueName || 'LOCATION TBA';
  const streetAddress = data.address ? data.address.split(',')[0].trim() : '';

  let dateDisplay = '';
  let timeDisplay = '';
  const is12h = data.timezone ? uses12Hour(data.timezone) : false;

  if (data.date) {
    const tz = data.timezone || 'UTC';
    const start = getDateTimeInTimezone(data.date, tz);
    const startFormatted = formatFlyerTime(start.timeStr, is12h);
    timeDisplay = startFormatted;

    if (data.duration) {
      const endDate = new Date(
        new Date(data.date).getTime() + data.duration * 3600000,
      );
      const end = getDateTimeInTimezone(endDate, tz);
      const endFormatted = formatFlyerTime(end.timeStr, is12h);
      timeDisplay = `${startFormatted} - ${endFormatted}`;
    }

    const eventDate = new Date(data.date);
    const monthFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      month: 'short',
    });
    const dayFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      day: 'numeric',
    });
    dateDisplay = `${monthFormatter.format(eventDate).toUpperCase()} ${dayFormatter.format(eventDate)}`;
  }

  // 4. Render to canvas (uses DB config if available, otherwise defaults)
  const canvas = await renderFlyer({
    city,
    venueName,
    streetAddress,
    dateDisplay,
    timeDisplay,
    is12h,
    sponsors: sponsors.map((s) => ({ id: s.id, logoUrl: s.logoUrl! })),
    config: dbConfig || undefined,
  });

  // 5. Convert canvas to blob
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/png'),
  );
  if (!blob) {
    console.error('[autoRegenFlyer] canvas.toBlob returned null');
    return;
  }

  // 6. Upload
  const file = new File(
    [blob],
    `gpp-flyer-${data.customUrl || data.inviteCode || data.id}.png`,
    { type: 'image/png' },
  );
  const uploadedUrl = await uploadEventImage(file);
  if (!uploadedUrl) {
    console.error('[autoRegenFlyer] uploadEventImage failed');
    return;
  }

  // 7. Update party with new image URL + timestamp
  const success = await updateParty(data.id, {
    event_image_url: uploadedUrl,
    flyer_generated_at: new Date().toISOString(),
  });
  if (!success) {
    console.error('[autoRegenFlyer] updateParty failed');
    return;
  }

  // 8. Optionally refresh UI
  if (loadParty && data.inviteCode) {
    await loadParty(data.inviteCode);
  }
}
