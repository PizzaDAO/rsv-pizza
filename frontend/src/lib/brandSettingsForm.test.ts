import { describe, it, expect } from 'vitest';
import {
  DEFAULT_THEME_DRAFT, draftFromSettings, draftFromTokens, evaluateTheme, identityPatch, sameTheme,
  tokensPayload, validateIdentity, type ThemeDraft,
} from './brandSettingsForm';
import { parseThemeTokens } from '../config/themeTokens';
import { describeUploadError, precheckUpload, type BrandSettings } from './brandAdminApi';

const settings = (over: Partial<BrandSettings> = {}): BrandSettings => ({
  id: 's1', slug: 'acme', name: 'Acme', siteUrl: 'https://acme.example.org', requireApproval: true, createFlow: null, configVersion: 1,
  brandName: 'Acme Pizza', displayName: 'Acme', tagline: 'Slices', metaDescription: null, supportEmail: 'help@example.org',
  description: null, nameTemplate: null, hideGuests: false, photosEnabled: true, photosPublic: true,
  eventDate: null, eventStartTime: null, eventEndTime: null, emailFromName: null, emailReplyTo: null, themeTokens: null, ...over,
});

describe('validateIdentity (mirrors the server allowlist validators)', () => {
  const base = draftFromSettings(settings());

  it('accepts the saved settings', () => {
    expect(validateIdentity(base)).toEqual({});
  });

  it('enforces name charset, reserved names and lengths', () => {
    expect(validateIdentity({ ...base, brandName: 'Acme <b>' }).brandName).toMatch(/< or >/);
    expect(validateIdentity({ ...base, brandName: 'Acme_Pizza' }).brandName).toMatch(/letters, digits/);
    expect(validateIdentity({ ...base, brandName: 'Pizza-DAO' }).brandName).toMatch(/reserved/);
    expect(validateIdentity({ ...base, displayName: '' }).displayName).toMatch(/empty/);
    expect(validateIdentity({ ...base, tagline: 'x'.repeat(81) }).tagline).toMatch(/80/);
    expect(validateIdentity({ ...base, metaDescription: 'x'.repeat(201) }).metaDescription).toMatch(/200/);
    expect(validateIdentity({ ...base, description: 'x'.repeat(2001) }).description).toMatch(/2000/);
  });

  it('checks emails, sender name and times', () => {
    expect(validateIdentity({ ...base, supportEmail: 'not an email' }).supportEmail).toBeTruthy();
    expect(validateIdentity({ ...base, emailReplyTo: 'Name <a@example.org>' }).emailReplyTo).toBeTruthy();
    expect(validateIdentity({ ...base, emailFromName: 'Pizza DAO Team' }).emailFromName).toMatch(/reserved/);
    expect(validateIdentity({ ...base, eventStartTime: '25:00' }).eventStartTime).toBeTruthy();
    expect(validateIdentity({ ...base, eventStartTime: '18:30', emailFromName: 'Acme Events', emailReplyTo: 'hi@example.org' })).toEqual({});
  });
});

describe('identityPatch', () => {
  const s = settings();
  it('sends nothing when nothing changed, and only the changed fields otherwise', () => {
    expect(identityPatch(draftFromSettings(s), s)).toEqual({});
    const d = { ...draftFromSettings(s), tagline: '  New tagline ', hideGuests: true };
    expect(identityPatch(d, s)).toEqual({ tagline: 'New tagline', hideGuests: true });
  });
  it('sends null for a cleared text field', () => {
    expect(identityPatch({ ...draftFromSettings(s), tagline: '' }, s)).toEqual({ tagline: null });
  });
});

describe('theme evaluation', () => {
  it('the starting theme passes the server validator', () => {
    expect(parseThemeTokens(DEFAULT_THEME_DRAFT, { allowOverrides: false }).ok).toBe(true);
    const ev = evaluateTheme(DEFAULT_THEME_DRAFT);
    expect(ev.errors).toEqual([]);
    expect(ev.warnings).toEqual([]);
  });

  it('a failing text pair is a blocking error that names the pair', () => {
    const ev = evaluateTheme({ ...DEFAULT_THEME_DRAFT, textMuted: '#2a2a2c' });
    expect(ev.errors.length).toBeGreaterThan(0);
    expect(ev.errors.join(' ')).toMatch(/textMuted on bg/i);
    expect(ev.failures.some((f) => f.blocking)).toBe(true);
  });

  it('low accent contrast only warns', () => {
    // accent barely different from bg, but onAccent keeps 4.5:1 against it
    const ev = evaluateTheme({ ...DEFAULT_THEME_DRAFT, accent: '#2a2a30', onAccent: '#ffffff' });
    expect(ev.errors).toEqual([]);
    expect(ev.warnings.join(' ')).toMatch(/accent on bg/i);
    expect(ev.tokens).not.toBeNull();
  });

  it('flags a bad hex and a mode that disagrees with the background, without a preview token set', () => {
    expect(evaluateTheme({ ...DEFAULT_THEME_DRAFT, bg: '#12' }).errors.join(' ')).toMatch(/bg must be/);
    expect(evaluateTheme({ ...DEFAULT_THEME_DRAFT, bg: '#12' }).tokens).toBeNull();
    expect(evaluateTheme({ ...DEFAULT_THEME_DRAFT, mode: 'light' }).errors.join(' ')).toMatch(/mode is "light"/);
  });

  it('keeps super-admin overrides in the preview tokens but never in the save payload', () => {
    const saved = { ...DEFAULT_THEME_DRAFT, overrides: { '--accent-hover': '#aa0000' } };
    const draft = draftFromTokens(saved);
    expect('overrides' in draft).toBe(false);
    expect(evaluateTheme(draft, saved.overrides).tokens?.overrides).toEqual(saved.overrides);
    expect('overrides' in tokensPayload(draft, saved)).toBe(false);
  });

  it('flags are sent only when on, or when the saved set already had them', () => {
    const base = { ...DEFAULT_THEME_DRAFT };
    expect('hideHeaderName' in tokensPayload(base, null)).toBe(false);
    expect(tokensPayload({ ...base, hideHeaderName: true }, null).hideHeaderName).toBe(true);
    // turned off after having been on: an explicit false so the server does not keep the old true
    expect(tokensPayload({ ...base, hideHeroLogo: false }, { ...base, hideHeroLogo: true })).toMatchObject({ hideHeroLogo: false });
  });

  it('lowercases colours in the payload and compares themes ignoring case and false flags', () => {
    expect(tokensPayload({ ...DEFAULT_THEME_DRAFT, accent: '#E6212F' }, null).accent).toBe('#e6212f');
    const a: ThemeDraft = { ...DEFAULT_THEME_DRAFT, accent: '#E6212F' };
    expect(sameTheme(a, { ...DEFAULT_THEME_DRAFT, hideHeaderName: false })).toBe(true);
  });
});

describe('upload error messages', () => {
  const err = (code: string, message = '') => Object.assign(new Error(message), { code });
  it('maps 413 / 415 / 429 / 503 to clear messages', () => {
    expect(describeUploadError(err('FILE_TOO_BIG', 'That image is too big (10 MB max)'))).toMatch(/too big/);
    expect(describeUploadError(err('BAD_FILE_TYPE'))).toMatch(/PNG, JPEG or WebP/);
    expect(describeUploadError(err('RATE_LIMITED', 'Request failed'))).toMatch(/Too many uploads/);
    expect(describeUploadError(err('UPLOADS_UNAVAILABLE'))).toMatch(/not available yet/);
    expect(describeUploadError(err('UNAVAILABLE'))).toMatch(/temporarily unavailable/);
    expect(describeUploadError(new Error('Storage: 413 Payload too large'))).toMatch(/too big/);
  });
  it('prechecks type and size before uploading', () => {
    expect(precheckUpload({ type: 'image/svg+xml', size: 10 })).toMatch(/PNG, JPEG or WebP/);
    expect(precheckUpload({ type: 'image/png', size: 11 * 1024 * 1024 })).toMatch(/too big/);
    expect(precheckUpload({ type: 'image/webp', size: 1000 })).toBeNull();
  });
});
