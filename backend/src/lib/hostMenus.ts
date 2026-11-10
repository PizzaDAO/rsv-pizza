/**
 * basil-14648 P2 (host menus): when rsv offers "Use this shop's real menu".
 *
 * Both must hold:
 *   1. rsv's own switch, PIZZA_HOST_MENUS=1 (unset = off: no route, no UI);
 *   2. pizza-mcp takes host menus (its HOST_MENUS switch), as its route reports it (PizzaMcpClient.hostMenusProbe).
 * The probe answer is kept for 5 minutes per server instance (1 minute when pizza-mcp could not be asked), so the
 * config read the UI does on every open costs at most one extra request now and then. A FEATURE_DISABLED answer to
 * a real upload turns it off at once.
 */
import type { OpopActor, PizzaMcpClient } from '../services/pizzaMcp.client.js';

const KNOWN_MS = 5 * 60_000;
const UNKNOWN_MS = 60_000;

let cached: { value: boolean; until: number } | null = null;

export function hostMenusFlagOn(): boolean {
  return process.env.PIZZA_HOST_MENUS === '1';
}

/** True only when rsv's switch is on AND pizza-mcp says it takes host menus. Never throws. */
export async function hostMenusAvailable(client: PizzaMcpClient, actor: OpopActor, now = Date.now()): Promise<boolean> {
  if (!hostMenusFlagOn()) return false;
  if (cached && cached.until > now) return cached.value;
  const answer = await client.hostMenusProbe(actor).catch(() => null);
  cached = { value: answer === true, until: now + (answer === null ? UNKNOWN_MS : KNOWN_MS) };
  return cached.value;
}

/** pizza-mcp answered a real request with FEATURE_DISABLED: hide the feature until the next probe. */
export function noteHostMenusDisabled(now = Date.now()) {
  cached = { value: false, until: now + KNOWN_MS };
}

/** Tests: forget the probe answer. */
export function resetHostMenusCacheForTests() {
  cached = null;
}
