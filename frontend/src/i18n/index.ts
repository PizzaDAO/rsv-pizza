import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

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
import esCommon from './locales/es/common.json';
import esRsvp from './locales/es/rsvp.json';
import esEvent from './locales/es/event.json';
import esAuth from './locales/es/auth.json';
import esDonation from './locales/es/donation.json';
import esGpp from './locales/es/gpp.json';
import esAccount from './locales/es/account.json';
import esCheckin from './locales/es/checkin.json';
import esHost from './locales/es/host.json';
import esAdmin from './locales/es/admin.json';
import esPartner from './locales/es/partner.json';
import ptCommon from './locales/pt/common.json';
import ptRsvp from './locales/pt/rsvp.json';
import ptEvent from './locales/pt/event.json';
import ptAuth from './locales/pt/auth.json';
import ptDonation from './locales/pt/donation.json';
import ptGpp from './locales/pt/gpp.json';
import ptAccount from './locales/pt/account.json';
import ptCheckin from './locales/pt/checkin.json';
import ptHost from './locales/pt/host.json';
import ptAdmin from './locales/pt/admin.json';
import ptPartner from './locales/pt/partner.json';
import zhCommon from './locales/zh/common.json';
import zhRsvp from './locales/zh/rsvp.json';
import zhEvent from './locales/zh/event.json';
import zhAuth from './locales/zh/auth.json';
import zhDonation from './locales/zh/donation.json';
import zhGpp from './locales/zh/gpp.json';
import zhAccount from './locales/zh/account.json';
import zhCheckin from './locales/zh/checkin.json';
import zhHost from './locales/zh/host.json';
import zhAdmin from './locales/zh/admin.json';
import zhPartner from './locales/zh/partner.json';

i18n
  .use(LanguageDetector)
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
      },
      es: {
        common: esCommon,
        rsvp: esRsvp,
        event: esEvent,
        auth: esAuth,
        donation: esDonation,
        gpp: esGpp,
        account: esAccount,
        checkin: esCheckin,
        host: esHost,
        admin: esAdmin,
        partner: esPartner,
      },
      pt: {
        common: ptCommon,
        rsvp: ptRsvp,
        event: ptEvent,
        auth: ptAuth,
        donation: ptDonation,
        gpp: ptGpp,
        account: ptAccount,
        checkin: ptCheckin,
        host: ptHost,
        admin: ptAdmin,
        partner: ptPartner,
      },
      zh: {
        common: zhCommon,
        rsvp: zhRsvp,
        event: zhEvent,
        auth: zhAuth,
        donation: zhDonation,
        gpp: zhGpp,
        account: zhAccount,
        checkin: zhCheckin,
        host: zhHost,
        admin: zhAdmin,
        partner: zhPartner,
      },
    },
    fallbackLng: 'en',
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
  });

// Update html lang attribute when language changes
i18n.on('languageChanged', (lng) => {
  document.documentElement.setAttribute('lang', lng);
});

// Set initial lang attribute
document.documentElement.setAttribute('lang', i18n.language || 'en');

export default i18n;
