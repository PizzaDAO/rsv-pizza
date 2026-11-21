/**
 * Member name tags (plans/marinara-32633): settings in the generic registry (lib/appSettings.ts),
 * stored in `app_config`, audited by `writeSetting`. Everything ships OFF.
 *
 *  nametags.scope           0 = off, 1 = PizzaDAO events only (see `isPizzadaoEvent`), 2 = every host.
 *                           Default and failure value 0: a DB read problem turns it off.
 *  nametags.gppCounts       1 (default) = events of type 'gpp' count as PizzaDAO events for scope 1.
 *  nametags.maxIdentifiers  Most email hashes sent to pizzadao.org per request (larger lists are chunked).
 *  nametags.rateUserPerHour / rateUserPerDay / ratePartyPerHour  Lookup limits per signed-in user and per party.
 *
 * Not an integer, so outside the registry: app_config `nametags.hostUserIds` (JSON array of user ids in this app).
 * An event whose OWNING host is one of these accounts counts as a PizzaDAO event (co-hosts do not count).
 * Default empty: it matches nothing until set.
 */
import { prisma } from '../config/database.js';
import { readSettings, type SettingDef } from './appSettings.js';

export const NAMETAG_SCOPE_SETTING: SettingDef = {
  key: 'nametags.scope',
  area: 'features',
  label: 'PizzaDAO member name tags',
  help: 'Lets hosts show PizzaDAO member details (name, member number, picture, crews, city, level) on printed name tags. 0 = off, 1 = PizzaDAO events only (events of type GPP when "GPP counts" is on, and events owned by an account listed in nametags.hostUserIds), 2 = every host.',
  min: 0,
  max: 2,
  default: 0,
  failure: 0,
};

export const NAMETAG_GPP_COUNTS_SETTING: SettingDef = {
  key: 'nametags.gppCounts',
  area: 'features',
  label: 'GPP events count as PizzaDAO events (name tags)',
  help: 'For scope 1: 1 = events of type GPP are PizzaDAO events, 0 = they are not. Events owned by an account in nametags.hostUserIds always count.',
  min: 0,
  max: 1,
  default: 1,
  failure: 1,
};

export const NAMETAG_MAX_IDENTIFIERS_SETTING: SettingDef = {
  key: 'nametags.maxIdentifiers',
  area: 'features',
  label: 'Name tag lookup chunk size',
  help: 'Most email hashes sent to pizzadao.org in one request. Larger guest lists are sent in several requests. Keep at or below the limit set on the pizzadao.org side.',
  min: 10,
  max: 5000,
  default: 500,
  failure: 500,
};

export const NAMETAG_RATE_USER_HOUR_SETTING: SettingDef = {
  key: 'nametags.rateUserPerHour',
  area: 'features',
  label: 'Name tag lookups per user per hour',
  help: 'How many member lookups one signed-in user may run per hour, across all their events.',
  min: 1,
  max: 1000,
  default: 20,
  failure: 5,
};

export const NAMETAG_RATE_USER_DAY_SETTING: SettingDef = {
  key: 'nametags.rateUserPerDay',
  area: 'features',
  label: 'Name tag lookups per user per day',
  help: 'How many member lookups one signed-in user may run per 24 hours, across all their events.',
  min: 1,
  max: 5000,
  default: 100,
  failure: 20,
};

export const NAMETAG_RATE_PARTY_HOUR_SETTING: SettingDef = {
  key: 'nametags.ratePartyPerHour',
  area: 'features',
  label: 'Name tag lookups per event per hour',
  help: 'How many member lookups one event may run per hour, whoever asks.',
  min: 1,
  max: 1000,
  default: 20,
  failure: 5,
};

export const NAMETAG_SETTINGS: SettingDef[] = [
  NAMETAG_SCOPE_SETTING,
  NAMETAG_GPP_COUNTS_SETTING,
  NAMETAG_MAX_IDENTIFIERS_SETTING,
  NAMETAG_RATE_USER_HOUR_SETTING,
  NAMETAG_RATE_USER_DAY_SETTING,
  NAMETAG_RATE_PARTY_HOUR_SETTING,
];

export const NAMETAG_HOST_IDS_KEY = 'nametags.hostUserIds';
const HOST_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Validate a host id list from the admin UI. Returns the cleaned list, or null when invalid. */
export function parseHostUserIds(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length > 20) return null;
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== 'string' || !HOST_ID_RE.test(x.trim())) return null;
    if (!out.includes(x.trim())) out.push(x.trim());
  }
  return out;
}

/** The owning-host account ids that make an event a PizzaDAO event. Never throws; unreadable = empty. */
export async function readHostUserIds(): Promise<string[]> {
  try {
    const row = await prisma.appConfig.findUnique({ where: { key: NAMETAG_HOST_IDS_KEY } });
    return (row ? parseHostUserIds(JSON.parse(row.value)) : null) ?? [];
  } catch {
    return [];
  }
}

export interface NametagConfig {
  scope: 0 | 1 | 2;
  gppCounts: boolean;
  maxIdentifiers: number;
  rateUserPerHour: number;
  rateUserPerDay: number;
  ratePartyPerHour: number;
  hostUserIds: string[];
  readFailed: boolean;
}

/** Never throws; a read failure resolves to scope 0 (off). */
export async function getNametagConfig(): Promise<NametagConfig> {
  const snap = await readSettings(NAMETAG_SETTINGS);
  const v = (d: SettingDef) => snap.values[d.key].value;
  const scope = snap.readFailed ? 0 : v(NAMETAG_SCOPE_SETTING);
  return {
    scope: (scope === 1 || scope === 2 ? scope : 0) as 0 | 1 | 2,
    gppCounts: v(NAMETAG_GPP_COUNTS_SETTING) === 1,
    maxIdentifiers: v(NAMETAG_MAX_IDENTIFIERS_SETTING),
    rateUserPerHour: v(NAMETAG_RATE_USER_HOUR_SETTING),
    rateUserPerDay: v(NAMETAG_RATE_USER_DAY_SETTING),
    ratePartyPerHour: v(NAMETAG_RATE_PARTY_HOUR_SETTING),
    hostUserIds: scope === 1 ? await readHostUserIds() : [],
    readFailed: snap.readFailed,
  };
}

/** A PizzaDAO event: type GPP (when counted) or owned (not merely co-hosted) by a listed account. */
export function isPizzadaoEvent(
  cfg: Pick<NametagConfig, 'gppCounts' | 'hostUserIds'>,
  party: { eventType?: string | null; userId?: string | null },
): boolean {
  if (cfg.gppCounts && party.eventType === 'gpp') return true;
  return !!party.userId && cfg.hostUserIds.includes(party.userId);
}

/** Whether the setting allows member tags for this party. */
export function scopeAllows(
  cfg: Pick<NametagConfig, 'scope' | 'gppCounts' | 'hostUserIds'>,
  party: { eventType?: string | null; userId?: string | null },
): boolean {
  if (cfg.scope >= 2) return true;
  if (cfg.scope === 1) return isPizzadaoEvent(cfg, party);
  return false;
}
