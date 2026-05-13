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
import frCommon from './locales/fr/common.json';
import frRsvp from './locales/fr/rsvp.json';
import frEvent from './locales/fr/event.json';
import frAuth from './locales/fr/auth.json';
import frDonation from './locales/fr/donation.json';
import frGpp from './locales/fr/gpp.json';
import frAccount from './locales/fr/account.json';
import frCheckin from './locales/fr/checkin.json';
import frHost from './locales/fr/host.json';
import frAdmin from './locales/fr/admin.json';
import frPartner from './locales/fr/partner.json';
import jaCommon from './locales/ja/common.json';
import jaRsvp from './locales/ja/rsvp.json';
import jaEvent from './locales/ja/event.json';
import jaAuth from './locales/ja/auth.json';
import jaDonation from './locales/ja/donation.json';
import jaGpp from './locales/ja/gpp.json';
import jaAccount from './locales/ja/account.json';
import jaCheckin from './locales/ja/checkin.json';
import jaHost from './locales/ja/host.json';
import jaAdmin from './locales/ja/admin.json';
import jaPartner from './locales/ja/partner.json';
import deCommon from './locales/de/common.json';
import deRsvp from './locales/de/rsvp.json';
import deEvent from './locales/de/event.json';
import deAuth from './locales/de/auth.json';
import deDonation from './locales/de/donation.json';
import deGpp from './locales/de/gpp.json';
import deAccount from './locales/de/account.json';
import deCheckin from './locales/de/checkin.json';
import deHost from './locales/de/host.json';
import deAdmin from './locales/de/admin.json';
import dePartner from './locales/de/partner.json';

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
      fr: {
        common: frCommon,
        rsvp: frRsvp,
        event: frEvent,
        auth: frAuth,
        donation: frDonation,
        gpp: frGpp,
        account: frAccount,
        checkin: frCheckin,
        host: frHost,
        admin: frAdmin,
        partner: frPartner,
      },
      ja: {
        common: jaCommon,
        rsvp: jaRsvp,
        event: jaEvent,
        auth: jaAuth,
        donation: jaDonation,
        gpp: jaGpp,
        account: jaAccount,
        checkin: jaCheckin,
        host: jaHost,
        admin: jaAdmin,
        partner: jaPartner,
      },
      de: {
        common: deCommon,
        rsvp: deRsvp,
        event: deEvent,
        auth: deAuth,
        donation: deDonation,
        gpp: deGpp,
        account: deAccount,
        checkin: deCheckin,
        host: deHost,
        admin: deAdmin,
        partner: dePartner,
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
    react: {
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
