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
