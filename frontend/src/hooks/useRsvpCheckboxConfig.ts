// lasagna-49278: DB-driven config for the RSVP opt-in checkboxes.
//
// Renderer (RsvpCheckboxList) calls useRsvpCheckboxConfig(partyId) on mount.
// We fetch two sets:
//   1. Global rows (party_id IS NULL) — cached at module level via a top-level
//      promise. One fetch per browser session.
//   2. Per-party overrides (party_id = <eventId>) — fetched once per partyId.
// Merge: per-party override row replaces global row entirely (no field-level
// merge — simpler, predictable).
//
// If the global fetch errors, fall back to FALLBACK_CONFIG (the 8 seed rows
// hardcoded here). console.warn only — never surface to the user.
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface RsvpCheckboxConfig {
  id: string;
  party_id: string | null;
  position: number;
  active: boolean;
  required_tags: string[];
  excluded_tags: string[];
  always_show: boolean;
  opt_in_fields: string[];
  combined_group: string | null;
  label_i18n_key: string | null;
  label_default: string | null;
  label_overrides: Record<string, string>;
  info_modal_i18n_ns: string | null;
  info_modal_privacy_url: string | null;
  info_modal_terms_url: string | null;
  info_modal_terms_key: string | null;
  modal_overrides: Record<string, ModalOverride>;
  accent_color: string;
}

export interface ModalOverride {
  title?: string;
  description?: string;
  privacyPolicy?: string;
  termsConditions?: string;
  termsOfService?: string;
  privacyUrl?: string;
  termsUrl?: string;
}

const SELECT_COLS =
  'id, party_id, position, active, required_tags, excluded_tags, always_show, ' +
  'opt_in_fields, combined_group, ' +
  'label_i18n_key, label_default, label_overrides, ' +
  'info_modal_i18n_ns, info_modal_privacy_url, info_modal_terms_url, info_modal_terms_key, ' +
  'modal_overrides, accent_color';

// Hardcoded fallback — mirrors the 8 seed rows in the migration. Returned if
// the global fetch errors so RSVP keeps working. Also used by the admin
// "reset to defaults" button.
export const FALLBACK_CONFIG: RsvpCheckboxConfig[] = [
  {
    id: 'mailing_list', party_id: null, position: 10, active: true,
    required_tags: [], excluded_tags: [], always_show: true,
    opt_in_fields: ['mailingListOptIn'], combined_group: 'pizzadao_partners',
    label_i18n_key: 'step1.combinedOptIn',
    label_default: "Sign up for PizzaDAO's mailing list",
    label_overrides: {},
    info_modal_i18n_ns: null, info_modal_privacy_url: null, info_modal_terms_url: null, info_modal_terms_key: null,
    modal_overrides: {}, accent_color: 'red',
  },
  {
    id: 'swc_us', party_id: null, position: 20, active: true,
    required_tags: ['swc'], excluded_tags: [], always_show: false,
    opt_in_fields: ['swcOptIn'], combined_group: 'pizzadao_partners',
    label_i18n_key: 'step1.swcJoin',
    label_default: 'Join Stand With Crypto and receive updates from the SWC Alliance',
    label_overrides: {},
    info_modal_i18n_ns: 'swcModal',
    info_modal_privacy_url: 'https://www.standwithcrypto.org/privacy',
    info_modal_terms_url: 'https://www.standwithcrypto.org/terms-of-service',
    info_modal_terms_key: 'termsConditions',
    modal_overrides: {}, accent_color: 'purple',
  },
  {
    id: 'swc_ca', party_id: null, position: 21, active: true,
    required_tags: ['swccanada'], excluded_tags: [], always_show: false,
    opt_in_fields: ['swcCaOptIn'], combined_group: 'pizzadao_partners',
    label_i18n_key: 'step1.swcNotify',
    label_default: 'Notify me about Stand With Crypto Canada updates',
    label_overrides: {},
    info_modal_i18n_ns: 'swcCaModal',
    info_modal_privacy_url: 'https://www.standwithcrypto.org/ca/privacy',
    info_modal_terms_url: 'https://www.standwithcrypto.org/ca/terms-of-service',
    info_modal_terms_key: 'termsOfService',
    modal_overrides: {}, accent_color: 'purple',
  },
  {
    id: 'swc_au', party_id: null, position: 22, active: true,
    required_tags: ['swcau'], excluded_tags: [], always_show: false,
    opt_in_fields: ['swcAuOptIn'], combined_group: 'pizzadao_partners',
    label_i18n_key: 'step1.swcNotify',
    label_default: 'Notify me about Stand With Crypto Australia updates',
    label_overrides: {},
    info_modal_i18n_ns: 'swcAuModal',
    info_modal_privacy_url: 'https://www.standwithcrypto.org/au/privacy',
    info_modal_terms_url: 'https://www.standwithcrypto.org/au/terms-of-service',
    info_modal_terms_key: 'termsOfService',
    modal_overrides: {}, accent_color: 'purple',
  },
  {
    id: 'swc_eu', party_id: null, position: 23, active: true,
    required_tags: ['swceu'], excluded_tags: [], always_show: false,
    opt_in_fields: ['swcEuOptIn'], combined_group: 'pizzadao_partners',
    label_i18n_key: 'step1.swcNotify',
    label_default: 'Notify me about Stand With Crypto EU updates',
    label_overrides: {},
    info_modal_i18n_ns: 'swcEuModal',
    info_modal_privacy_url: 'https://www.standwithcrypto.org/eu/en/privacy',
    info_modal_terms_url: 'https://www.standwithcrypto.org/eu/en/terms-of-service',
    info_modal_terms_key: 'termsOfService',
    modal_overrides: {}, accent_color: 'purple',
  },
  {
    id: 'swc_uk', party_id: null, position: 24, active: true,
    required_tags: ['swcuk'], excluded_tags: [], always_show: false,
    opt_in_fields: ['swcUkOptIn'], combined_group: 'pizzadao_partners',
    label_i18n_key: 'step1.swcNotify',
    label_default: 'Notify me about Stand With Crypto UK updates',
    label_overrides: {},
    info_modal_i18n_ns: 'swcUkModal',
    info_modal_privacy_url: 'https://www.standwithcrypto.org/gb/en/privacy',
    info_modal_terms_url: 'https://www.standwithcrypto.org/gb/en/terms-of-service',
    info_modal_terms_key: 'termsOfService',
    modal_overrides: {}, accent_color: 'purple',
  },
  {
    id: 'swc_br', party_id: null, position: 25, active: true,
    required_tags: ['swcbr'], excluded_tags: [], always_show: false,
    opt_in_fields: ['swcBrOptIn'], combined_group: 'pizzadao_partners',
    label_i18n_key: 'step1.swcBrNotify',
    label_default: 'Notify me about Juntos por Cripto updates',
    label_overrides: {},
    info_modal_i18n_ns: 'swcBrModal',
    info_modal_privacy_url: 'https://www.juntosporcripto.org/br/privacy',
    info_modal_terms_url: 'https://www.juntosporcripto.org/br/terms-of-service',
    info_modal_terms_key: 'termsOfService',
    modal_overrides: {}, accent_color: 'purple',
  },
  {
    id: 'ethconf', party_id: null, position: 30, active: true,
    required_tags: ['ethconf'], excluded_tags: [], always_show: false,
    opt_in_fields: ['ethconfOptIn'], combined_group: 'pizzadao_partners',
    label_i18n_key: 'step1.ethconfDiscount',
    label_default: 'I want a discount code for the ETHConf conference',
    label_overrides: {},
    info_modal_i18n_ns: null, info_modal_privacy_url: null, info_modal_terms_url: null, info_modal_terms_key: null,
    modal_overrides: {}, accent_color: 'red',
  },
];

// Module-level promise cache for the global fetch. One round-trip per session.
let globalFetchPromise: Promise<RsvpCheckboxConfig[]> | null = null;

function fetchGlobalConfig(): Promise<RsvpCheckboxConfig[]> {
  if (globalFetchPromise) return globalFetchPromise;
  globalFetchPromise = (async () => {
    try {
      const { data, error } = await supabase
        .from('rsvp_checkboxes')
        .select(SELECT_COLS)
        .is('party_id', null)
        .eq('active', true)
        .order('position');
      if (error || !data) {
        console.warn('[useRsvpCheckboxConfig] global fetch failed, using fallback:', error);
        return FALLBACK_CONFIG;
      }
      return data as RsvpCheckboxConfig[];
    } catch (e) {
      console.warn('[useRsvpCheckboxConfig] global fetch threw, using fallback:', e);
      return FALLBACK_CONFIG;
    }
  })();
  return globalFetchPromise;
}

async function fetchOverrides(partyId: string): Promise<RsvpCheckboxConfig[]> {
  try {
    const { data, error } = await supabase
      .from('rsvp_checkboxes')
      .select(SELECT_COLS)
      .eq('party_id', partyId)
      .eq('active', true)
      .order('position');
    if (error || !data) return [];
    return data as RsvpCheckboxConfig[];
  } catch {
    return [];
  }
}

/** Invalidate the module-level cache — used by the admin UI's refresh button. */
export function invalidateRsvpCheckboxConfigCache() {
  globalFetchPromise = null;
}

export function useRsvpCheckboxConfig(partyId: string | null | undefined): {
  config: RsvpCheckboxConfig[];
  loading: boolean;
  error: Error | null;
} {
  const [config, setConfig] = useState<RsvpCheckboxConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const global = await fetchGlobalConfig();
        const overrides = partyId ? await fetchOverrides(partyId) : [];
        if (cancelled) return;

        // Merge: per-party override row replaces global row entirely by id.
        if (overrides.length === 0) {
          setConfig(global);
        } else {
          const overrideById = new Map(overrides.map((r) => [r.id, r]));
          const merged: RsvpCheckboxConfig[] = global.map((g) => overrideById.get(g.id) ?? g);
          // Include override rows whose id isn't in the global set.
          for (const o of overrides) {
            if (!global.some((g) => g.id === o.id)) merged.push(o);
          }
          merged.sort((a, b) => a.position - b.position);
          setConfig(merged);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e : new Error(String(e)));
          setConfig(FALLBACK_CONFIG);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [partyId]);

  return { config, loading, error };
}
