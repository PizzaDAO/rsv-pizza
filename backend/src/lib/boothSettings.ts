/**
 * Photo booth global flag (plans/photo-booth.md). One setting in the generic registry
 * (lib/appSettings.ts), stored in `app_config` under `booth.enabled`, audited by `writeSetting`.
 *
 * 0 = off for everyone except hosts previewing (the shipped default and the failure value, so a DB
 * read problem turns the booth off, never on). 1 = on for every party whose host has not turned it off.
 */
import { readSettings, type SettingDef } from './appSettings.js';

export const BOOTH_ENABLED_SETTING: SettingDef = {
  key: 'booth.enabled',
  area: 'features',
  label: 'Photo booth',
  help: 'Phone photo booth at /<party>/booth. 0 = off (hosts can still preview), 1 = on for every party whose host has not turned it off. Also the kill switch.',
  min: 0,
  max: 1,
  default: 0,
  failure: 0,
};

export const BOOTH_SETTINGS: SettingDef[] = [BOOTH_ENABLED_SETTING];

/** True when the global flag is 1. Never throws; a read failure resolves to off. */
export async function isBoothGloballyOn(): Promise<boolean> {
  const snap = await readSettings([BOOTH_ENABLED_SETTING]);
  return snap.values[BOOTH_ENABLED_SETTING.key].value === 1;
}
