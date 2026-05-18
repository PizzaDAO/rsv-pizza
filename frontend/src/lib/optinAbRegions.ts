export interface RegionalOptinAbConfig {
  tag: string;
  label: string;
  flagKey: string;
  modalNamespace: 'swcModal' | 'swcCaModal' | 'swcAuModal' | 'swcEuModal' | 'swcUkModal' | 'swcBrModal';
  termsKey: 'termsConditions' | 'termsOfService';
  privacyUrl: string;
  termsUrl: string;
  swcOptInField: 'swcOptIn' | 'swcCaOptIn' | 'swcAuOptIn' | 'swcEuOptIn' | 'swcUkOptIn' | 'swcBrOptIn';
}

export const REGIONAL_OPTIN_AB: RegionalOptinAbConfig[] = [
  {
    tag: 'swc',
    label: 'US',
    flagKey: 'optin_ab_pizzadao_partners',
    modalNamespace: 'swcModal',
    termsKey: 'termsConditions',
    privacyUrl: 'https://www.standwithcrypto.org/privacy',
    termsUrl: 'https://www.standwithcrypto.org/terms-of-service',
    swcOptInField: 'swcOptIn',
  },
  {
    tag: 'swccanada',
    label: 'Canada',
    flagKey: 'optin_ab_pizzadao_partners_ca',
    modalNamespace: 'swcCaModal',
    termsKey: 'termsOfService',
    privacyUrl: 'https://www.standwithcrypto.org/ca/privacy',
    termsUrl: 'https://www.standwithcrypto.org/ca/terms-of-service',
    swcOptInField: 'swcCaOptIn',
  },
  {
    tag: 'swcau',
    label: 'Australia',
    flagKey: 'optin_ab_pizzadao_partners_au',
    modalNamespace: 'swcAuModal',
    termsKey: 'termsOfService',
    privacyUrl: 'https://www.standwithcrypto.org/au/privacy',
    termsUrl: 'https://www.standwithcrypto.org/au/terms-of-service',
    swcOptInField: 'swcAuOptIn',
  },
  {
    tag: 'swceu',
    label: 'EU',
    flagKey: 'optin_ab_pizzadao_partners_eu',
    modalNamespace: 'swcEuModal',
    termsKey: 'termsOfService',
    privacyUrl: 'https://www.standwithcrypto.org/eu/en/privacy',
    termsUrl: 'https://www.standwithcrypto.org/eu/en/terms-of-service',
    swcOptInField: 'swcEuOptIn',
  },
  {
    tag: 'swcuk',
    label: 'UK',
    flagKey: 'optin_ab_pizzadao_partners_uk',
    modalNamespace: 'swcUkModal',
    termsKey: 'termsOfService',
    privacyUrl: 'https://www.standwithcrypto.org/gb/en/privacy',
    termsUrl: 'https://www.standwithcrypto.org/gb/en/terms-of-service',
    swcOptInField: 'swcUkOptIn',
  },
  {
    tag: 'swcbr',
    label: 'Brazil',
    flagKey: 'optin_ab_pizzadao_partners_br',
    modalNamespace: 'swcBrModal',
    termsKey: 'termsOfService',
    privacyUrl: 'https://www.juntosporcripto.org/br/privacy',
    termsUrl: 'https://www.juntosporcripto.org/br/terms-of-service',
    swcOptInField: 'swcBrOptIn',
  },
];

export function findActiveRegion(eventTags: string[] | null | undefined): RegionalOptinAbConfig | null {
  if (!eventTags || eventTags.length === 0) return null;
  return REGIONAL_OPTIN_AB.find((r) => eventTags.includes(r.tag)) ?? null;
}
