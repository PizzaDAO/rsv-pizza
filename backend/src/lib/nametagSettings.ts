/**
 * Member name tags (plans/marinara-32633): settings in the generic registry (lib/appSettings.ts),
 * stored in `app_config`, audited by `writeSetting`. Everything ships OFF.
 *
 *  nametags.scope           0 = off, 1 = PizzaDAO events only (events in an event series, e.g. GPP),
 *                           2 = every host. Default and failure value 0: a DB read problem turns it off.
 *  nametags.maxIdentifiers  Most email hashes (and, separately, wallets) sent to pizzadao.org per request.
 *                           Bigger guest lists are sent in chunks.
 */
import { readSettings, type SettingDef } from './appSettings.js';

export const NAMETAG_SCOPE_SETTING: SettingDef = {
  key: 'nametags.scope',
  area: 'features',
  label: 'PizzaDAO member name tags',
  help: 'Lets hosts show PizzaDAO member details (name, member number, picture, crews, city, level) on printed name tags. 0 = off, 1 = events in an event series only (PizzaDAO events), 2 = every host.',
  min: 0,
  max: 2,
  default: 0,
  failure: 0,
};

export const NAMETAG_MAX_IDENTIFIERS_SETTING: SettingDef = {
  key: 'nametags.maxIdentifiers',
  area: 'features',
  label: 'Name tag lookup chunk size',
  help: 'Most email hashes (and, separately, wallets) sent to pizzadao.org in one request. Larger guest lists are sent in several requests. Keep at or below the limit set on the pizzadao.org side.',
  min: 10,
  max: 5000,
  default: 500,
  failure: 500,
};

export const NAMETAG_SETTINGS: SettingDef[] = [NAMETAG_SCOPE_SETTING, NAMETAG_MAX_IDENTIFIERS_SETTING];

export interface NametagConfig {
  scope: 0 | 1 | 2;
  maxIdentifiers: number;
  readFailed: boolean;
}

/** Never throws; a read failure resolves to scope 0 (off). */
export async function getNametagConfig(): Promise<NametagConfig> {
  const snap = await readSettings(NAMETAG_SETTINGS);
  const scope = snap.readFailed ? 0 : snap.values[NAMETAG_SCOPE_SETTING.key].value;
  return {
    scope: (scope === 1 || scope === 2 ? scope : 0) as 0 | 1 | 2,
    maxIdentifiers: snap.values[NAMETAG_MAX_IDENTIFIERS_SETTING.key].value,
    readFailed: snap.readFailed,
  };
}

/** Whether the setting allows member tags for this party. */
export function scopeAllows(scope: number, party: { eventSeriesId?: string | null; eventType?: string | null }): boolean {
  if (scope >= 2) return true;
  if (scope === 1) return !!party.eventSeriesId || party.eventType === 'gpp';
  return false;
}
