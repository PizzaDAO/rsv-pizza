import React, { useEffect, useMemo, useState } from 'react';
import { Type, FileText, AlignLeft, Mail, User, Reply, Calendar, Clock, Hash, Tag } from 'lucide-react';
import { IconInput } from '../IconInput';
import { Checkbox } from '../Checkbox';
import { saveBrandSettings, describeApiError, type BrandSettings } from '../../lib/brandAdminApi';
import { draftFromSettings, identityPatch, validateIdentity, TEXT_LIMITS, type IdentityDraft } from '../../lib/brandSettingsForm';

interface Props {
  seriesId: string;
  settings: BrandSettings;
  onSaved: (s: BrandSettings) => void;
}

type TextKey = Exclude<keyof IdentityDraft, 'hideGuests' | 'photosEnabled' | 'photosPublic'>;

const Section: React.FC<{ title: string; hint?: string; children: React.ReactNode }> = ({ title, hint, children }) => (
  <section className="space-y-3">
    <div>
      <h2 className="text-base font-semibold text-theme-text">{title}</h2>
      {hint && <p className="text-xs text-theme-text-muted mt-0.5">{hint}</p>}
    </div>
    <div className="space-y-3">{children}</div>
  </section>
);

export const IdentityPanel: React.FC<Props> = ({ seriesId, settings, onSaved }) => {
  const savedKey = JSON.stringify(draftFromSettings(settings));
  const savedDraft = useMemo(() => draftFromSettings(settings), [savedKey]);
  const [draft, setDraft] = useState<IdentityDraft>(savedDraft);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  useEffect(() => setDraft(savedDraft), [savedDraft]);

  const errors = useMemo(() => validateIdentity(draft), [draft]);
  const patch = useMemo(() => identityPatch(draft, settings), [draft, settings]);
  const hasErrors = Object.keys(errors).length > 0;
  const dirty = Object.keys(patch).length > 0;

  const setText = (k: TextKey) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setDraft((d) => ({ ...d, [k]: e.target.value }));
    setMessage(null);
  };
  const toggle = (k: 'hideGuests' | 'photosEnabled' | 'photosPublic') => () => {
    setDraft((d) => ({ ...d, [k]: !d[k] }));
    setMessage(null);
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await saveBrandSettings(seriesId, patch);
      onSaved(res.settings);
      setMessage({ kind: 'ok', text: res.changed.length ? 'Saved. Changes show on your site within about a minute.' : 'Nothing changed.' });
    } catch (e) {
      setMessage({ kind: 'error', text: describeApiError(e) });
    } finally {
      setSaving(false);
    }
  };

  const help = (k: TextKey, name: string, max?: number) => (
    <div className="text-xs mt-1 flex justify-between gap-2">
      <span className={errors[k] ? 'text-[#E52828]' : 'text-theme-text-muted'}>{errors[k] || name}</span>
      {max ? <span className="text-theme-text-muted shrink-0">{draft[k].length}/{max}</span> : null}
    </div>
  );

  return (
    <div className="space-y-8" data-testid="identity-panel">
      <Section title="Brand" hint="How your name appears on the site and in emails.">
        <div>
          <IconInput icon={Type} aria-label="Brand name" placeholder="Brand name" value={draft.brandName} onChange={setText('brandName')} maxLength={TEXT_LIMITS.brandName + 20} />
          {help('brandName', 'Brand name', TEXT_LIMITS.brandName)}
        </div>
        <div>
          <IconInput icon={Tag} aria-label="Display name" placeholder="Display name" value={draft.displayName} onChange={setText('displayName')} maxLength={TEXT_LIMITS.displayName + 20} />
          {help('displayName', 'Display name (shown in lists and headings)', TEXT_LIMITS.displayName)}
        </div>
        <div>
          <IconInput icon={AlignLeft} aria-label="Tagline" placeholder="Tagline" value={draft.tagline} onChange={setText('tagline')} maxLength={TEXT_LIMITS.tagline + 20} />
          {help('tagline', 'Tagline', TEXT_LIMITS.tagline)}
        </div>
        <div>
          <IconInput icon={FileText} aria-label="Meta description" placeholder="Meta description (shown in search results and link previews)" multiline rows={3}
            value={draft.metaDescription} onChange={setText('metaDescription')} maxLength={TEXT_LIMITS.metaDescription + 40} />
          {help('metaDescription', 'Meta description', TEXT_LIMITS.metaDescription)}
        </div>
        <div>
          <IconInput icon={FileText} aria-label="Series description" placeholder="About your series (markdown supported)" multiline rows={6}
            value={draft.description} onChange={setText('description')} maxLength={TEXT_LIMITS.description + 200} />
          {help('description', 'Series description', TEXT_LIMITS.description)}
        </div>
      </Section>

      <Section title="Contact and email" hint="Emails to your hosts and guests come from your brand name. The sending address itself is managed by PizzaDAO.">
        <div>
          <IconInput icon={Mail} type="email" aria-label="Support email" placeholder="Support email" value={draft.supportEmail} onChange={setText('supportEmail')} />
          {help('supportEmail', 'Support email shown to hosts and guests')}
        </div>
        <div>
          <IconInput icon={User} aria-label="Email sender name" placeholder="Email sender name" value={draft.emailFromName} onChange={setText('emailFromName')} maxLength={TEXT_LIMITS.emailFromName + 20} />
          {help('emailFromName', 'Email sender name (the "from" name)', TEXT_LIMITS.emailFromName)}
        </div>
        <div>
          <IconInput icon={Reply} type="email" aria-label="Reply-to email" placeholder="Reply-to email" value={draft.emailReplyTo} onChange={setText('emailReplyTo')} />
          {help('emailReplyTo', 'Reply-to email (where replies go)')}
        </div>
      </Section>

      <Section title="Events" hint="Defaults for events created on your site.">
        <div>
          <IconInput icon={Hash} aria-label="Event name template" placeholder="Event name template, e.g. {brand} {city}" value={draft.nameTemplate} onChange={setText('nameTemplate')} maxLength={TEXT_LIMITS.nameTemplate + 20} />
          {help('nameTemplate', 'Event name template ({city} {brand} {series})', TEXT_LIMITS.nameTemplate)}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <IconInput icon={Calendar} type="date" aria-label="Event date" placeholder="Event date" value={draft.eventDate} onChange={setText('eventDate')} />
            {help('eventDate', 'Event date')}
          </div>
          <div>
            <IconInput icon={Clock} type="time" aria-label="Start time" placeholder="Start time" value={draft.eventStartTime} onChange={setText('eventStartTime')} />
            {help('eventStartTime', 'Start time')}
          </div>
          <div>
            <IconInput icon={Clock} type="time" aria-label="End time" placeholder="End time" value={draft.eventEndTime} onChange={setText('eventEndTime')} />
            {help('eventEndTime', 'End time')}
          </div>
        </div>
        <div className="space-y-2">
          <Checkbox checked={draft.hideGuests} onChange={toggle('hideGuests')} label="Hide guest lists on public event pages" checkboxRole />
          <Checkbox checked={draft.photosEnabled} onChange={toggle('photosEnabled')} label="Photos enabled" checkboxRole />
          <Checkbox checked={draft.photosPublic} onChange={toggle('photosPublic')} label="Photos are public" checkboxRole />
        </div>
      </Section>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary text-sm disabled:opacity-50" disabled={!dirty || hasErrors || saving} onClick={save}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {hasErrors && <span className="text-xs text-[#E52828]">Fix the highlighted fields to save.</span>}
        {message && (
          <span className={`text-sm ${message.kind === 'ok' ? 'text-theme-text-muted' : 'text-[#E52828]'}`} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</span>
        )}
      </div>
    </div>
  );
};
