import i18n, { type BackendModule } from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// English is bundled statically (it is the fallback for every other language and
// the default for most visitors). All other languages are code-split per
// language+namespace and fetched on demand by the backend below.
import enCommon from './locales/en/common.json';
import enRsvp from './locales/en/rsvp.json';
import enEvent from './locales/en/event.json';
import enAuth from './locales/en/auth.json';
import enDonation from './locales/en/donation.json';
import enGpp from './locales/en/gpp.json';
import enAccount from './locales/en/account.json';
import enCheckin from './locales/en/checkin.json';
import enHost from './locales/en/host.json';
import enAdmin from './locales/en/admin.json';
import enPartner from './locales/en/partner.json';
import enNft from './locales/en/nft.json'; // claim-later-nft (other locales fall back to en)

// Lazy loaders keyed by './locales/<lng>/<ns>.json' (English excluded: it is bundled above).
const lazyLocales = import.meta.glob<{ default: Record<string, unknown> }>([
  './locales/*/*.json',
  '!./locales/en/*.json',
]);

const lazyBackend: BackendModule = {
  type: 'backend',
  init() {},
  read(language, namespace, callback) {
    const load = lazyLocales[`./locales/${language}/${namespace}.json`];
    if (!load) {
      // Unknown language/namespace (e.g. "es-MX", or nft in non-en): empty => fall back to en.
      callback(null, {});
      return;
    }
    load().then(
      (mod) => callback(null, mod.default),
      (err) => callback(err instanceof Error ? err : new Error(String(err)), null),
    );
  },
};

i18n
  .use(LanguageDetector)
  .use(lazyBackend)
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        common: enCommon,
        rsvp: enRsvp,
        event: enEvent,
        auth: enAuth,
        donation: enDonation,
        gpp: enGpp,
        account: enAccount,
        checkin: enCheckin,
        host: enHost,
        admin: enAdmin,
        partner: enPartner,
        nft: enNft,
      },
    },
    // en is bundled; every other language comes from the lazy backend.
    partialBundledLanguages: true,
    fallbackLng: 'en',
    ns: ['common'],
    defaultNS: 'common',
    detection: {
      order: ['querystring', 'localStorage', 'navigator'],
      lookupQuerystring: 'lang',
      lookupLocalStorage: 'i18nextLng',
      caches: ['localStorage'],
    },
    interpolation: {
      escapeValue: false,
    },
    react: {
      // Suspends until the detected language's namespaces have loaded (main.tsx has a Suspense boundary).
      useSuspense: true,
      bindI18n: 'languageChanged loaded',
      bindI18nStore: 'added removed',
    },
  });

// Update html lang attribute when language changes
i18n.on('languageChanged', (lng) => {
  document.documentElement.setAttribute('lang', lng);
});

// Set initial lang attribute
document.documentElement.setAttribute('lang', i18n.language || 'en');

export default i18n;
