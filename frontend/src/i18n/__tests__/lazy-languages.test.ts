import { describe, it, expect, afterAll } from 'vitest';
import i18n from '../index';

// English is bundled; every other language is code-split and loaded on demand.
describe('i18n lazy language loading', () => {
  afterAll(async () => {
    await i18n.changeLanguage('en');
  });

  it('serves English synchronously from the bundle', () => {
    expect(i18n.getFixedT('en', 'common')('header.logIn')).toBe('Log In / Sign Up');
  });

  it('loads a non-English language on demand when switching', async () => {
    await i18n.changeLanguage('es');
    expect(i18n.t('header.logIn', { ns: 'common' })).toBe('Iniciar Sesión / Registrarse');
  });

  it('falls back to English for a missing namespace in another language (nft has no es file)', async () => {
    await i18n.changeLanguage('es');
    await i18n.loadNamespaces('nft');
    expect(i18n.exists('states.paused.body', { ns: 'nft' })).toBe(true);
  });

  it('tolerates an unknown regional code by falling back', async () => {
    await i18n.changeLanguage('es-MX');
    expect(i18n.t('header.logIn', { ns: 'common' })).toBe('Iniciar Sesión / Registrarse');
  });
});
