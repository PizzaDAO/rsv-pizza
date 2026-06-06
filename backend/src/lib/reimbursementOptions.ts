/**
 * Reimbursement-option resolver (marinara-71630 P1).
 *
 * The BACKEND decides which payout options a party host may see; the frontend
 * just renders whatever it's handed. This pure function takes a party's
 * country/tags plus the private `reimbursement_rules` config (loaded from
 * `app_config` via {@link ../lib/privateConfig.getReimbursementRules}) and
 * resolves the concrete list of options to show, in the configured order, each
 * annotated with whether it is enabled.
 *
 * It hardcodes NO country logic — all country/tag rules live in config.
 */

import type { ReimbursementOption, ReimbursementRules, CountryRule } from './privateConfig.js';
import { getReimbursementRules } from './privateConfig.js';
import { isMercuryBlocked } from './mercuryBlockedCountries.js';

/** A fully-resolved option ready to send to the frontend. */
export interface ResolvedOption {
  id: string;
  label: string;
  description?: string;
  kind: 'method' | 'external';
  url?: string;
  enabled: boolean;
  /** Present only when `enabled === false`; explains why. */
  disabledReason?: string;
}

/** Minimal party shape the resolver needs. */
export interface ResolverParty {
  country?: string | null;
  eventTags?: string[] | null;
}

function ruleMatches(rule: CountryRule, party: ResolverParty): boolean {
  const { country, tag } = rule.match || {};
  if (country && party.country && country === party.country) return true;
  if (tag && Array.isArray(party.eventTags) && party.eventTags.includes(tag)) return true;
  return false;
}

/**
 * Resolve the visible/enabled reimbursement options for a party.
 *
 * Algorithm:
 *  1. Start from `rules.default` (ids).
 *  2. For each matching country rule, in array order:
 *     - if `visible` is set, restrict to those ids (intersected with the
 *       configured methods, so unknown ids are dropped);
 *     - collect `disable` entries into an id → reason map.
 *  3. Emit, in `rules.methods` order, one entry per surviving visible id,
 *     marking it disabled if it appears in the disable map.
 *
 * Never throws. An empty/unseeded config yields `[]`.
 */
export function resolveReimbursementOptions(
  party: ResolverParty,
  rules: ReimbursementRules
): ResolvedOption[] {
  const methods: ReimbursementOption[] = Array.isArray(rules?.methods) ? rules.methods : [];
  const byId = new Map(methods.map((m) => [m.id, m]));

  let visibleIds: string[] = Array.isArray(rules?.default) ? [...rules.default] : [];
  const disabledMap = new Map<string, string>();

  const countryRules: CountryRule[] = Array.isArray(rules?.countryRules) ? rules.countryRules : [];
  for (const rule of countryRules) {
    if (!ruleMatches(rule, party)) continue;
    if (Array.isArray(rule.visible)) {
      // Restrict to exactly the rule's ids, keeping only ids we have a method for.
      visibleIds = rule.visible.filter((id) => byId.has(id));
    }
    if (Array.isArray(rule.disable)) {
      for (const d of rule.disable) {
        if (d && d.id) disabledMap.set(d.id, d.reason);
      }
    }
  }

  const visibleSet = new Set(visibleIds);

  // Emit in methods[] order, one per visible id.
  const out: ResolvedOption[] = [];
  for (const m of methods) {
    if (!visibleSet.has(m.id)) continue;
    const reason = disabledMap.get(m.id);
    out.push({
      id: m.id,
      label: m.label,
      description: m.description,
      kind: m.kind,
      url: m.url,
      enabled: reason === undefined,
      ...(reason !== undefined ? { disabledReason: reason } : {}),
    });
  }
  return out;
}

/**
 * Resolve a party's reimbursement options with the SAME layering the
 * `GET /api/parties/:id/reimbursement-options` endpoint applies:
 *  1. config-resolved options ({@link resolveReimbursementOptions} over
 *     {@link getReimbursementRules}), then
 *  2. the code-side Mercury sanctions gate ({@link isMercuryBlocked}) layered on
 *     top — if the party's country is Mercury-blocked, the `mercury_card` entry
 *     (when present) is forced `enabled:false` with a compliance reason.
 *
 * This is the single source of truth for "which payout methods may this party
 * use", shared by the GET endpoint (display) and the PATCH /api/user/me save
 * guard (enforcement) so they can never drift. Never throws — an unseeded
 * config yields `[]`.
 */
export async function resolvePartyReimbursementOptions(
  party: ResolverParty,
): Promise<ResolvedOption[]> {
  const rules = await getReimbursementRules();
  const options = resolveReimbursementOptions(party, rules);

  // marinara-71630: the config resolver matches country EXACTLY, but the
  // Mercury sanctions gate must NORMALIZE (lowercase / strip parentheticals) so
  // casing/parenthetical variants of a blocked country are still blocked. The
  // sanctions list is compliance, not a private business secret, so it stays in
  // code (`isMercuryBlocked`) and is layered over the config-resolved options
  // here. Only mutate the mercury_card entry if it's present.
  if (isMercuryBlocked(party.country)) {
    const mercury = options.find((o) => o.id === 'mercury_card');
    if (mercury) {
      mercury.enabled = false;
      mercury.disabledReason = `Mercury cards are unavailable in ${party.country ?? 'your country'} due to compliance restrictions.`;
    }
  }

  return options;
}
