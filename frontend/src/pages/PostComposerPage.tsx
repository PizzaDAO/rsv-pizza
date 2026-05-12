import React, { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet-async';
import { Loader2, Shield, FileText, Search, Copy, Check } from 'lucide-react';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { IconInput } from '../components/IconInput';
import { fetchAdminMe } from '../lib/api';
import { getAllParties } from '../lib/supabase';
import type { DbParty } from '../lib/supabase';

const themeClass = 'gpp-theme';
const backgroundStyle = { background: 'linear-gradient(180deg, #7EC8E3 0%, #B6E4F7 100%)' } as React.CSSProperties;

/* ------------------------------------------------------------------ */
/*  Template system                                                    */
/* ------------------------------------------------------------------ */

interface PostTemplate {
  id: string;
  name: string;
  description: string;
  compose: (event: DbParty) => string;
}

function extractCity(eventName: string): string {
  return eventName.replace(/^Global Pizza Party\s*/i, '').trim() || eventName;
}

function getPizzeriaNames(pizzerias: any[] | null): string {
  if (!pizzerias || pizzerias.length === 0) return '';
  return pizzerias.map((p: any) => p.name).join(' and ');
}

function getPartnerInstagramTags(coHosts: any[]): string {
  if (!coHosts || coHosts.length === 0) return '';
  const handles = coHosts
    .filter((ch: any) => ch.isPartner && ch.instagram)
    .map((ch: any) => `@${ch.instagram.replace(/^@/, '')}`);
  return handles.join(' ');
}

const POST_TEMPLATES: PostTemplate[] = [
  {
    id: 'molto-benny',
    name: 'Molto Benny',
    description: 'City hype post',
    compose: (event: DbParty) => {
      const city = extractCity(event.name);
      const pizzerias = getPizzeriaNames(event.selected_pizzerias as any[]);
      const slug = event.custom_url || event.invite_code;
      const pizzeriaText = pizzerias ? ` Especially ${pizzerias}.` : '';
      return `\u{1F355}\u{1F5FA}\u{FE0F}\nI'm in ${city}! The pizza here is very good.${pizzeriaText} Can't wait for http://rsv.pizza/${slug}`;
    },
  },
  {
    id: 'ig-partner-tags',
    name: 'IG Partner Tags',
    description: 'Instagram post with all partner tags',
    compose: (event: DbParty) => {
      const city = extractCity(event.name);
      const slug = event.custom_url || event.invite_code;
      const partnerTags = getPartnerInstagramTags(event.co_hosts as any[]);
      const lines = [
        `Pizza party in ${city}!`,
        `RSVP: rsv.pizza/${slug}`,
      ];
      if (partnerTags) {
        lines.push('');
        lines.push(partnerTags);
      }
      return lines.join('\n');
    },
  },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function PostComposerPage() {
  const { t } = useTranslation('admin');
  // Admin gate state
  const [loading, setLoading] = useState(true);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Data state
  const [events, setEvents] = useState<DbParty[]>([]);

  // Composer state
  const [selectedTemplate, setSelectedTemplate] = useState<string>('molto-benny');
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [composedText, setComposedText] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [eventSearch, setEventSearch] = useState<string>('');

  /* ---- Admin check ---- */
  useEffect(() => {
    async function checkAdmin() {
      try {
        const me = await fetchAdminMe();
        if (!me.isAdmin) {
          setIsAdminUser(false);
          setLoading(false);
          return;
        }
        setIsAdminUser(true);

        // Load GPP events
        const allParties = await getAllParties();
        const gppEvents = allParties
          .filter((p) => p.event_type === 'gpp')
          .sort((a, b) => a.name.localeCompare(b.name));
        setEvents(gppEvents);

        if (gppEvents.length > 0) {
          setSelectedEventId(gppEvents[0].id);
        }
      } catch (err: any) {
        setError(err.message || 'Failed to check admin status');
      } finally {
        setLoading(false);
      }
    }
    checkAdmin();
  }, []);

  /* ---- Auto-compose when template or event changes ---- */
  useEffect(() => {
    if (!selectedEventId || !selectedTemplate) return;
    const event = events.find((e) => e.id === selectedEventId);
    if (!event) return;
    const template = POST_TEMPLATES.find((t) => t.id === selectedTemplate);
    if (!template) return;
    setComposedText(template.compose(event));
  }, [selectedEventId, selectedTemplate, events]);

  /* ---- Filtered events ---- */
  const filteredEvents = useMemo(() => {
    if (!eventSearch.trim()) return events;
    const q = eventSearch.toLowerCase();
    return events.filter((e) => e.name.toLowerCase().includes(q));
  }, [events, eventSearch]);

  /* ---- Copy handler ---- */
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(composedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select text so user can Ctrl+C
    }
  };

  /* ---- Loading state ---- */
  if (loading) {
    return (
      <div className={`min-h-screen ${themeClass}`} style={backgroundStyle}>
        <Header />
        <div className="flex items-center justify-center py-32">
          <Loader2 size={32} className="animate-spin text-theme-text-muted" />
        </div>
        <Footer />
      </div>
    );
  }

  /* ---- Access denied ---- */
  if (!isAdminUser || error) {
    return (
      <div className={`min-h-screen ${themeClass}`} style={backgroundStyle}>
        <Header />
        <div className="flex flex-col items-center justify-center px-4 py-32">
          <Shield size={48} className="text-red-400/60 mb-4" />
          <h1 className="text-2xl font-bold mb-2">{t('postComposer.accessDenied')}</h1>
          <p className="text-theme-text-muted text-center max-w-md">
            {error || t('postComposer.accessDeniedDesc')}
          </p>
        </div>
        <Footer />
      </div>
    );
  }

  /* ---- Main UI ---- */
  return (
    <div className={`min-h-screen ${themeClass}`} style={backgroundStyle}>
      <Helmet>
        <title>Post Composer | RSV.Pizza</title>
      </Helmet>

      <Header />

      <div className="max-w-xl mx-auto px-4 py-12 space-y-6">
        <div className="flex items-center gap-3 mb-2">
          <FileText size={28} className="text-theme-text-muted" />
          <h1 className="text-2xl font-bold">{t('postComposer.title')}</h1>
        </div>

        {/* Template selector */}
        <div className="space-y-1">
          <select
            value={selectedTemplate}
            onChange={(e) => setSelectedTemplate(e.target.value)}
            className="w-full rounded-lg px-4 py-3 bg-white/10 border border-white/20 text-inherit focus:outline-none focus:ring-2 focus:ring-sky-400"
          >
            {POST_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} — {t.description}
              </option>
            ))}
          </select>
        </div>

        {/* Event search */}
        <IconInput
          icon={Search}
          placeholder={t('postComposer.searchEvents')}
          value={eventSearch}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEventSearch(e.target.value)}
        />

        {/* Event selector */}
        <div className="space-y-1">
          <select
            value={selectedEventId}
            onChange={(e) => setSelectedEventId(e.target.value)}
            className="w-full rounded-lg px-4 py-3 bg-white/10 border border-white/20 text-inherit focus:outline-none focus:ring-2 focus:ring-sky-400"
          >
            {filteredEvents.map((ev) => {
              const city = extractCity(ev.name);
              const label = ev.country ? `${city} (${ev.country})` : city;
              return (
                <option key={ev.id} value={ev.id}>
                  {label}
                </option>
              );
            })}
          </select>
          <p className="text-xs text-white/40">{filteredEvents.length} GPP events</p>
        </div>

        {/* Preview */}
        <IconInput
          icon={FileText}
          multiline
          rows={6}
          placeholder="Composed post will appear here..."
          value={composedText}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setComposedText(e.target.value)}
        />

        {/* Copy button */}
        <button
          onClick={handleCopy}
          disabled={!composedText}
          className="w-full flex items-center justify-center gap-2 rounded-lg px-4 py-3 font-semibold transition-colors bg-sky-500 hover:bg-sky-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {copied ? (
            <>
              <Check size={18} />
              {t('postComposer.copied')}
            </>
          ) : (
            <>
              <Copy size={18} />
              {t('postComposer.copyToClipboard')}
            </>
          )}
        </button>
      </div>

      <Footer />
    </div>
  );
}
