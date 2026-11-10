/**
 * Host-trust settings (plans/trusted-hosts.md section 1.3), phase 1: report only.
 *
 * Definitions for the generic settings registry (lib/appSettings.ts). Every setting is stored under
 * its own `app_config` key `host_trust.<name>`. Gates and weights are stricter-only: the shipped
 * default is the loosest value, so the admin UI can only tighten. The one switch (the report) is free.
 *
 * Nothing here enforces anything. Budgets and payouts do not read these settings yet.
 */
import { readSettings, type SettingDef, type SettingsSnapshot } from './appSettings.js';

const KEY = (name: string) => `host_trust.${name}`;

function strict(o: {
  name: string;
  area: string;
  label: string;
  help: string;
  /** looser = lower means a higher value is stricter (e.g. "parties needed"). */
  looserWhen: 'higher' | 'lower';
  default: number;
  /** The strict bound (max when looserWhen is lower, min when higher). */
  strictBound: number;
  unit?: string;
}): SettingDef {
  const lowerIsLoose = o.looserWhen === 'lower';
  return {
    key: KEY(o.name),
    area: o.area,
    label: o.label,
    help: o.help,
    min: lowerIsLoose ? o.default : o.strictBound,
    max: lowerIsLoose ? o.strictBound : o.default,
    default: o.default,
    failure: o.strictBound,
    unit: o.unit,
    stricterOnly: true,
    looserWhen: o.looserWhen,
  };
}

const gate = (
  name: string, label: string, help: string, looserWhen: 'higher' | 'lower', def: number, strictBound: number, unit?: string,
) => strict({ name, area: 'Gates', label, help, looserWhen, default: def, strictBound, unit });

/** Positive signals: points a host earns. Higher points = looser, so the UI can only lower them. */
const earn = (name: string, label: string, points: number, cap: number): SettingDef[] => [
  strict({ name: `w.${name}.points`, area: 'Score: points earned', label: `${label}: points`, help: 'Points per qualifying item. Can only be lowered here.', looserWhen: 'higher', default: points, strictBound: 0 }),
  strict({ name: `w.${name}.cap`, area: 'Score: points earned', label: `${label}: cap`, help: 'Most points this signal can add. Can only be lowered here.', looserWhen: 'higher', default: cap, strictBound: 0 }),
];

/** Penalties: points a host loses. Lower penalty = looser, so the UI can only raise them. */
const lose = (name: string, label: string, points: number, cap: number): SettingDef[] => [
  strict({ name: `w.${name}.points`, area: 'Score: points lost', label: `${label}: points`, help: 'Points lost per item. Can only be raised here.', looserWhen: 'lower', default: points, strictBound: 100 }),
  strict({ name: `w.${name}.cap`, area: 'Score: points lost', label: `${label}: cap`, help: 'Most points this signal can remove. Can only be raised here.', looserWhen: 'lower', default: cap, strictBound: 100 }),
];

export const HOST_TRUST_SETTINGS: SettingDef[] = [
  {
    key: KEY('report_enabled'),
    area: 'Switches',
    label: 'Hosts trust report',
    help: 'Shows the read-only Hosts report to payment admins. 1 = on. Changes no budget, payout or host view.',
    min: 0, max: 1, default: 0, failure: 0,
  },
  gate('min_verified_parties', 'Verified parties needed', 'Fully verified parties before a host can be trusted. Can only be raised.', 'lower', 2, 10),
  gate('min_rsvps', 'Real RSVPs per verified party', 'A verified party needs at least this many real RSVPs. Can only be raised.', 'lower', 10, 100),
  gate('min_account_age_days', 'Account age (days)', 'Minimum rsv-pizza account age to be trusted. Can only be raised.', 'lower', 45, 730, 'days'),
  gate('receipt_deadline_days', 'Receipt deadline (days)', 'Receipts count as on time within this many days of the party. Can only be lowered.', 'higher', 14, 1, 'days'),
  gate('trusted_min_score', 'Score needed for trusted', 'Minimum 0-100 score on top of the gates. Can only be raised.', 'lower', 60, 100),
  gate('new_max_score', 'Highest score for "new"', 'Hosts with no completed parties are "new" up to this score. Can only be lowered.', 'higher', 20, 0),
  gate('decay_months', 'Verified party decay (months)', 'Verified parties older than this count half. Can only be lowered.', 'higher', 24, 3, 'months'),
  gate('new_account_days', 'New-account flag (days)', 'Accounts younger than this get the new-account review flag. Can only be raised.', 'lower', 30, 365, 'days'),
  gate('low_rsvp_count', 'Low-RSVP flag', 'Parties with fewer RSVPs than this get the low-RSVP flag. Can only be raised.', 'lower', 5, 50),
  gate('fake_block_parties', 'High fake-risk parties that block', 'This many past parties scored high-risk by fake-event detection makes a host restricted. Can only be lowered.', 'higher', 2, 1),
  gate('turnout_good_pct', 'Good turnout (% of RSVPs)', 'Median check-in ratio at or above this earns turnout points. Can only be raised.', 'lower', 50, 100, '%'),
  gate('turnout_poor_pct', 'Poor turnout (% of RSVPs)', 'Median check-in ratio at or below this loses turnout points. Can only be raised.', 'lower', 15, 50, '%'),
  gate('turnout_min_parties', 'Parties needed to judge turnout', 'Parties with real check-ins needed before turnout counts. Can only be raised.', 'lower', 2, 10),
  ...earn('verified_parties', 'Verified parties', 15, 45),
  ...earn('parties_hosted', 'Parties hosted', 3, 9),
  ...earn('turnout', 'Good turnout', 8, 8),
  ...earn('clean_payouts', 'Clean payouts', 4, 16),
  ...earn('receipts_on_time', 'Receipts on time', 2, 10),
  ...earn('proof_photos', 'Payout-role photos', 2, 10),
  ...earn('underboss_ok', 'Underboss approved', 2, 6),
  ...earn('account_age', 'Account age (per 30 days)', 1, 6),
  ...lose('no_prior_photos', 'No photos on completed parties', 30, 30),
  ...lose('duplicate_receipts', 'Duplicate receipts', 3, 9),
  ...lose('fake_risk', 'High fake-risk party', 15, 30),
  ...lose('reported_attendance', 'Implausible reported attendance', 10, 10),
  ...lose('poor_turnout', 'Poor turnout', 8, 8),
];

export const HOST_TRUST_SETTING_BY_KEY: Record<string, SettingDef> = Object.fromEntries(
  HOST_TRUST_SETTINGS.map((d) => [d.key, d]),
);

export interface PointRule {
  points: number;
  cap: number;
}

export interface HostTrustConfig {
  reportEnabled: boolean;
  gates: {
    minVerifiedParties: number;
    minRsvps: number;
    minAccountAgeDays: number;
    receiptDeadlineDays: number;
    trustedMinScore: number;
    newMaxScore: number;
    decayMonths: number;
  };
  review: { newAccountDays: number; lowRsvpCount: number };
  fakeBlockParties: number;
  turnout: { goodRatio: number; poorRatio: number; minParties: number };
  /** Per-signal points and caps, keyed by signal id. */
  weights: Record<string, PointRule>;
}

const WEIGHT_NAMES = [
  'verified_parties', 'parties_hosted', 'turnout', 'clean_payouts', 'receipts_on_time', 'proof_photos',
  'underboss_ok', 'account_age', 'no_prior_photos', 'duplicate_receipts', 'fake_risk', 'reported_attendance',
  'poor_turnout',
] as const;

/** Build the typed config from resolved values. */
export function buildHostTrustConfig(snap: SettingsSnapshot): HostTrustConfig {
  const v = (name: string) => snap.values[KEY(name)].value;
  return {
    reportEnabled: v('report_enabled') === 1,
    gates: {
      minVerifiedParties: v('min_verified_parties'),
      minRsvps: v('min_rsvps'),
      minAccountAgeDays: v('min_account_age_days'),
      receiptDeadlineDays: v('receipt_deadline_days'),
      trustedMinScore: v('trusted_min_score'),
      newMaxScore: v('new_max_score'),
      decayMonths: v('decay_months'),
    },
    review: { newAccountDays: v('new_account_days'), lowRsvpCount: v('low_rsvp_count') },
    fakeBlockParties: v('fake_block_parties'),
    turnout: { goodRatio: v('turnout_good_pct') / 100, poorRatio: v('turnout_poor_pct') / 100, minParties: v('turnout_min_parties') },
    weights: Object.fromEntries(
      WEIGHT_NAMES.map((n) => [n, { points: v(`w.${n}.points`), cap: v(`w.${n}.cap`) }]),
    ),
  };
}

/** The config with every setting at its shipped default (what an unseeded DB resolves to). */
export function defaultHostTrustConfig(): HostTrustConfig {
  const values: SettingsSnapshot['values'] = {};
  for (const d of HOST_TRUST_SETTINGS) values[d.key] = { value: d.default, source: 'default' };
  return buildHostTrustConfig({ values, readFailed: false });
}

export async function getHostTrustConfig(): Promise<{ config: HostTrustConfig; readFailed: boolean }> {
  const snap = await readSettings(HOST_TRUST_SETTINGS);
  return { config: buildHostTrustConfig(snap), readFailed: snap.readFailed };
}
