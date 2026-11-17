import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Mail, Lock } from 'lucide-react';
import { ColorInput } from './ColorInput';
import { IconInput } from '../IconInput';
import { Checkbox } from '../Checkbox';
import { deriveThemeVars, themeFontHrefs, type FontKey, type ThemeMode, type ThemeRadius, type ThemeTokens } from '../../config/themeTokens';
import {
  COLOR_FIELDS, FONT_OPTIONS, RADIUS_OPTIONS, DEFAULT_THEME_DRAFT,
  draftFromTokens, evaluateTheme, sameTheme, themeOverrides, tokensPayload, type ThemeDraft,
} from '../../lib/brandSettingsForm';
import { saveBrandSettings, describeApiError, type BrandSettings } from '../../lib/brandAdminApi';

interface Props {
  seriesId: string;
  settings: BrandSettings;
  onSaved: (s: BrandSettings) => void;
}

/** The sample page shown inside the preview frame. */
const PreviewContent: React.FC<{ brandName: string }> = ({ brandName }) => (
  <div style={{ background: 'var(--bg-main)', color: 'var(--text-primary)', fontFamily: 'var(--font-body)', minHeight: 0 }}>
    <div className="site-header flex items-center justify-between gap-3 px-4 py-3" style={{ background: 'var(--bg-header)', borderBottom: '1px solid var(--stroke)' }}>
      <span className="font-bold truncate" style={{ fontFamily: 'var(--font-heading)', color: 'var(--text-primary)' }}>{brandName || 'Your brand'}</span>
      <span className="text-sm shrink-0" style={{ color: 'var(--text-secondary)' }}>Log in</span>
    </div>
    <div className="p-4 space-y-4">
      <div className="card p-4 space-y-3">
        <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Pizza night downtown</h3>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Join us for slices, friends and good company.</p>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Saturday, 6 PM · 42 going</p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" tabIndex={-1} className="btn-primary text-sm" style={{ padding: '8px 16px' }}>RSVP</button>
          <button type="button" tabIndex={-1} className="btn-secondary text-sm" style={{ padding: '8px 16px' }}>Share</button>
          <span className="text-xs font-semibold px-2 py-1 rounded-full" style={{ background: 'var(--accent-tint)', color: 'var(--accent)' }}>Approved</span>
          <span className="text-xs font-semibold" style={{ color: 'var(--success)' }}>Open</span>
          <span className="text-xs font-semibold" style={{ color: 'var(--warning)' }}>Pending</span>
          <span className="text-xs font-semibold" style={{ color: 'var(--error)' }}>Full</span>
        </div>
      </div>
      <IconInput type="text" icon={Mail} placeholder="Email address" readOnly tabIndex={-1} />
      <Checkbox checked onChange={() => undefined} label="Notify me about new events" disabled labelClassName="text-sm" />
    </div>
  </div>
);

/**
 * The live preview renders in an iframe so the page's own theme classes (an old `.doge-theme` etc. on
 * <html>) cannot bleed into it: the frame's <html> carries only `wl-theme` (+ `wl-light`) and the derived
 * variables, with this app's stylesheets copied in. The live page is never touched, and the font
 * stylesheets the preview needs live in the frame's own <head> (removed with it on unmount).
 */
export const ThemePreview: React.FC<{ tokens: ThemeTokens; brandName: string }> = ({ tokens, brandName }) => {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [body, setBody] = useState<HTMLElement | null>(null);
  const [height, setHeight] = useState(430);
  const vars = useMemo(() => deriveThemeVars(tokens), [tokens]);

  const init = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc || !doc.body) return;
    if (!doc.head.querySelector('[data-wl-preview-styles]')) {
      const marker = doc.createElement('meta');
      marker.setAttribute('data-wl-preview-styles', '');
      doc.head.appendChild(marker);
      document.head.querySelectorAll('style, link[rel="stylesheet"]').forEach((n) => {
        if (n.hasAttribute('data-wl-font')) return;
        doc.head.appendChild(n.cloneNode(true));
      });
      doc.body.style.margin = '0';
    }
    setBody(doc.body);
  }, []);

  useLayoutEffect(() => { init(); }, [init]);

  // Variables, mode class and fonts on the frame's own root.
  useEffect(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc || !body) return;
    const root = doc.documentElement;
    root.className = `wl-theme ${tokens.mode === 'light' ? 'wl-light' : ''}`.trim();
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    for (const href of themeFontHrefs(tokens)) {
      if (Array.from(doc.querySelectorAll('link[data-wl-font]')).some((l) => l.getAttribute('href') === href)) continue;
      const link = doc.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.setAttribute('data-wl-font', '');
      doc.head.appendChild(link);
    }
  }, [body, vars, tokens]);

  // Size the frame to its content.
  useEffect(() => {
    if (!body || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const h = body.scrollHeight;
      if (h > 0) setHeight(h);
    });
    ro.observe(body);
    return () => ro.disconnect();
  }, [body]);

  return (
    <>
      <iframe
        ref={frameRef}
        data-testid="theme-preview"
        title="Live theme preview"
        onLoad={init}
        className="w-full rounded-xl border border-theme-stroke block"
        style={{ height, background: 'transparent' }}
      />
      {body && createPortal(<PreviewContent brandName={brandName} />, body)}
    </>
  );
};

const ModeButton: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={`px-3 py-2 min-h-[40px] rounded-lg text-sm border transition-colors ${active ? 'bg-[#E52828] border-[#E52828] text-white' : 'bg-theme-surface border-theme-stroke text-theme-text hover:bg-theme-surface-hover'}`}
  >
    {children}
  </button>
);

export const ThemePanel: React.FC<Props> = ({ seriesId, settings, onSaved }) => {
  const saved = settings.themeTokens;
  const overrides = useMemo(() => themeOverrides(saved), [saved]);
  const savedKey = JSON.stringify(saved ?? null);
  const savedDraft = useMemo(() => draftFromTokens(saved), [savedKey]);
  const [draft, setDraft] = useState<ThemeDraft>(savedDraft);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [serverWarnings, setServerWarnings] = useState<string[]>([]);

  // A save, revert or reload elsewhere replaces the saved tokens: start the draft over from them.
  useEffect(() => setDraft(savedDraft), [savedDraft]);

  const ev = useMemo(() => evaluateTheme(draft, overrides), [draft, overrides]);
  const [lastGood, setLastGood] = useState<ThemeTokens | null>(null);
  useEffect(() => { if (ev.tokens) setLastGood(ev.tokens); }, [ev.tokens]);
  const previewTokens = ev.tokens ?? lastGood ?? evaluateTheme(DEFAULT_THEME_DRAFT).tokens!;

  const dirty = !sameTheme(draft, savedDraft);
  const canSave = dirty && ev.errors.length === 0 && !saving;
  const set = <K extends keyof ThemeDraft>(k: K, v: ThemeDraft[K]) => { setDraft((d) => ({ ...d, [k]: v })); setMessage(null); };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await saveBrandSettings(seriesId, { themeTokens: tokensPayload(draft, saved) });
      onSaved(res.settings);
      setServerWarnings(res.warnings ?? []);
      setMessage({ kind: 'ok', text: 'Saved. Your site picks up the new look within about a minute.' });
    } catch (e) {
      setMessage({ kind: 'error', text: describeApiError(e) });
    } finally {
      setSaving(false);
    }
  };

  const useDefault = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await saveBrandSettings(seriesId, { themeTokens: null });
      onSaved(res.settings);
      setServerWarnings([]);
      setMessage({ kind: 'ok', text: 'Back to the default look.' });
    } catch (e) {
      setMessage({ kind: 'error', text: describeApiError(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="theme-panel">
      {!saved && (
        <p className="text-sm text-theme-text-muted">
          Your site uses the standard look. Change anything below and save to switch to a custom theme.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-5 min-w-0">
          <div>
            <div className="flex flex-wrap gap-2">
              {(['dark', 'light'] as ThemeMode[]).map((m) => (
                <ModeButton key={m} active={draft.mode === m} onClick={() => set('mode', m)}>{m === 'dark' ? 'Dark' : 'Light'}</ModeButton>
              ))}
            </div>
            <div className="text-xs text-theme-text-muted mt-1">Mode (the page background must match: dark or light)</div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {COLOR_FIELDS.map((f) => (
              <ColorInput key={f.key} label={f.label} value={draft[f.key]} onChange={(v) => set(f.key, v)} />
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <select aria-label="Heading font" className="w-full" value={draft.fontHeading} onChange={(e) => set('fontHeading', e.target.value as FontKey)}>
                {FONT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <div className="text-xs text-theme-text-muted mt-1">Heading font</div>
            </div>
            <div>
              <select aria-label="Body font" className="w-full" value={draft.fontBody} onChange={(e) => set('fontBody', e.target.value as FontKey)}>
                {FONT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <div className="text-xs text-theme-text-muted mt-1">Body font</div>
            </div>
          </div>

          <div>
            <div className="flex flex-wrap gap-2">
              {RADIUS_OPTIONS.map((r) => (
                <ModeButton key={r.value} active={draft.radius === r.value} onClick={() => set('radius', r.value as ThemeRadius)}>{r.label}</ModeButton>
              ))}
            </div>
            <div className="text-xs text-theme-text-muted mt-1">Corner style for buttons and cards</div>
          </div>

          <div className="space-y-2">
            <Checkbox
              checked={!!draft.hideHeaderName}
              onChange={() => set('hideHeaderName', !draft.hideHeaderName)}
              label="Logo only in the header (hide the brand name)"
              className="text-left" checkboxRole
            />
            <Checkbox
              checked={!!draft.hideHeroLogo}
              onChange={() => set('hideHeroLogo', !draft.hideHeroLogo)}
              label="Don't repeat the logo above the title on the series page"
              className="text-left" checkboxRole
            />
          </div>

          {overrides && (
            <div className="flex items-start gap-2 text-xs text-theme-text-muted p-3 rounded-lg bg-theme-surface" data-testid="overrides-note">
              <Lock size={14} className="mt-0.5 shrink-0" />
              <span>PizzaDAO has fine-tuned {Object.keys(overrides).length} extra style values for your brand. They are kept as they are when you save and can only be changed by PizzaDAO.</span>
            </div>
          )}
        </div>

        <div className="space-y-3 min-w-0">
          <div className="text-sm font-semibold text-theme-text">Live preview</div>
          <p className="text-xs text-theme-text-muted -mt-2">Only you see this. Nothing changes on your site until you save.</p>
          <ThemePreview tokens={previewTokens} brandName={settings.displayName} />

          <div className="space-y-2" data-testid="contrast-feedback" aria-live="polite">
            {ev.errors.map((m) => (
              <div key={m} className="flex items-start gap-2 text-sm text-[#E52828]" role="alert">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" /><span className="min-w-0 break-words">{m}</span>
              </div>
            ))}
            {ev.warnings.map((m) => (
              <div key={m} className="flex items-start gap-2 text-sm" style={{ color: 'var(--warning, #b45309)' }}>
                <AlertTriangle size={16} className="mt-0.5 shrink-0" /><span className="min-w-0 break-words">{m}. You can still save, but it may be hard to see.</span>
              </div>
            ))}
            {ev.errors.length === 0 && ev.warnings.length === 0 && (
              <div className="flex items-center gap-2 text-sm text-theme-text-muted">
                <CheckCircle2 size={16} className="text-green-500" />Contrast looks good.
              </div>
            )}
            {serverWarnings.map((m) => (
              <div key={m} className="text-xs text-theme-text-muted">{m}</div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary text-sm disabled:opacity-50" disabled={!canSave} onClick={save}>
          {saving ? 'Saving…' : 'Save theme'}
        </button>
        {saved && !overrides && (
          <button type="button" className="btn-secondary text-sm" disabled={saving} onClick={useDefault}>Use the default look</button>
        )}
        {ev.errors.length > 0 && dirty && <span className="text-xs text-theme-text-muted">Fix the issues above to save.</span>}
        {message && (
          <span className={`text-sm ${message.kind === 'ok' ? 'text-theme-text-muted' : 'text-[#E52828]'}`} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</span>
        )}
      </div>
    </div>
  );
};
