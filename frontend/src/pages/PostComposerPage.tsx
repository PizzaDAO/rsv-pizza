import React, { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet-async';
import { Loader2, Shield, FileText, Search, Copy, Check, Twitter, Download, Dices } from 'lucide-react';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { IconInput } from '../components/IconInput';
import { fetchAdminMe, getPhotosFeed } from '../lib/api';
import type { FeedPhoto } from '../lib/api';
import { getAllParties } from '../lib/supabase';
import type { DbParty } from '../lib/supabase';
import { countryNameToFlag } from '../utils/countryFlag';

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
      return `\u{1F355}${countryNameToFlag(event.country)}\nI'm in ${city}! The pizza here is very good.${pizzeriaText} Can't wait for http://rsv.pizza/${slug}`;
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
  {
    id: 'bpd-recap',
    name: 'Bitcoin Pizza Day Recap',
    description: 'Retrospective recap post',
    compose: (event: DbParty) => {
      const city = extractCity(event.name);
      const flag = countryNameToFlag(event.country);
      const place = event.country ? `${city}, ${event.country}` : city;
      return `${flag}\u{1F355}\u{1F973}\nThis was ${place}'s party on Bitcoin Pizza Day 2026.`;
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

  // calzone-49318: photos from the public feed, grouped by party id.
  const [partyPhotos, setPartyPhotos] = useState<Map<string, FeedPhoto[]>>(new Map());
  const [photosLoading, setPhotosLoading] = useState(true);

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
          .filter((p) => p.event_type === 'gpp' && p.underboss_status === 'approved')
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

  /* ---- calzone-49318: load public photo feed, group by party id ---- */
  useEffect(() => {
    if (!isAdminUser) return;
    let cancelled = false;

    async function fetchFeedPages(year: number | undefined): Promise<FeedPhoto[]> {
      const collected: FeedPhoto[] = [];
      let cursor: string | null = null;
      // Cap at ~5 pages of 100 (≤500 photos) to bound cost.
      for (let page = 0; page < 5; page++) {
        const resp = await getPhotosFeed(cursor, 100, {
          sort: 'random',
          seed: 'post-composer',
          ...(typeof year === 'number' ? { year } : {}),
        });
        if (!resp) break;
        collected.push(...resp.photos);
        cursor = resp.nextCursor;
        if (!cursor) break;
      }
      return collected;
    }

    async function loadPhotos() {
      try {
        let photos = await fetchFeedPages(2026);
        // If the 2026 pool is empty, retry once with no year (all years).
        if (photos.length === 0) {
          photos = await fetchFeedPages(undefined);
        }
        if (cancelled) return;
        const map = new Map<string, FeedPhoto[]>();
        for (const p of photos) {
          const id = p.party?.id;
          if (!id) continue;
          const arr = map.get(id);
          if (arr) arr.push(p);
          else map.set(id, [p]);
        }
        setPartyPhotos(map);
      } catch (err) {
        // Feed failure must never break the composer.
        console.error('Error loading post-composer photo feed:', err);
      } finally {
        if (!cancelled) setPhotosLoading(false);
      }
    }

    loadPhotos();
    return () => {
      cancelled = true;
    };
  }, [isAdminUser]);

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

  /* ---- Post on X ---- */
  function postOnX() {
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(composedText)}`;
    window.open(url, '_blank', 'noopener');
  }

  /* ---- Force download (cross-origin Supabase URLs ignore <a download>) ---- */
  async function downloadImage(url: string, filename: string) {
    const res = await fetch(url);
    const blob = await res.blob();
    const obj = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = obj;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(obj);
  }

  /* ---- calzone-49318: approved-GPP events that also have feed photos ---- */
  const photoEventIds = useMemo(
    () => events.filter((e) => partyPhotos.has(e.id)).map((e) => e.id),
    [events, partyPhotos],
  );

  /* ---- calzone-49318: jump to a random city that has photos ---- */
  function pickRandomCity() {
    if (photoEventIds.length === 0) return;
    const id = photoEventIds[Math.floor(Math.random() * photoEventIds.length)];
    setSelectedEventId(id);
  }

  /* ---- Currently selected event ---- */
  const selectedEvent = events.find((e) => e.id === selectedEventId);

  /* ---- calzone-49318: photos for the selected event ---- */
  const selectedPhotos = partyPhotos.get(selectedEventId) ?? [];

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
                  {countryNameToFlag(ev.country) + ' '}{label}
                </option>
              );
            })}
          </select>
          <p className="text-xs text-white/40">{filteredEvents.length} GPP events</p>
          {/* calzone-49318: jump to a random city that has photos */}
          <div className="space-y-1">
            <button
              onClick={pickRandomCity}
              disabled={photosLoading || photoEventIds.length === 0}
              className="w-full flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 font-semibold transition-colors bg-white/10 hover:bg-white/20 border border-white/20 text-inherit disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Dices size={18} />
              Random city
            </button>
            {photosLoading ? (
              <p className="text-xs text-white/40">Loading photos…</p>
            ) : photoEventIds.length === 0 ? (
              <p className="text-xs text-white/40">No events with photos</p>
            ) : (
              <p className="text-xs text-white/40">{photoEventIds.length} cities with photos</p>
            )}
          </div>
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

        {/* Char counter */}
        <p className={`text-xs text-right -mt-3 ${composedText.length > 280 ? 'text-red-500' : 'text-white/40'}`}>
          {composedText.length}/280
        </p>

        {/* Action buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleCopy}
            disabled={!composedText}
            className="flex-1 flex items-center justify-center gap-2 rounded-lg px-4 py-3 font-semibold transition-colors bg-sky-500 hover:bg-sky-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
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
          <button
            onClick={postOnX}
            disabled={!composedText}
            className="flex-1 flex items-center justify-center gap-2 rounded-lg px-4 py-3 font-semibold transition-colors bg-sky-500 hover:bg-sky-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Twitter size={18} />
            Post on X
          </button>
        </div>

        {/* calzone-49318: photo grid for the selected event (falls back to single image) */}
        {selectedEvent && selectedPhotos.length > 0 ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-white/40">
                {selectedPhotos.length} photo{selectedPhotos.length === 1 ? '' : 's'} from{' '}
                {extractCity(selectedEvent.name)}
              </p>
              <button
                onClick={async () => {
                  for (let i = 0; i < selectedPhotos.length; i++) {
                    await downloadImage(
                      selectedPhotos[i].url,
                      `${extractCity(selectedEvent.name)}-${i + 1}.jpg`,
                    );
                  }
                }}
                className="flex items-center gap-1.5 text-xs font-semibold text-sky-200 hover:text-white transition-colors"
              >
                <Download size={14} />
                Download all
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {selectedPhotos.map((photo, i) => (
                <div key={photo.id} className="space-y-1.5">
                  <img
                    src={photo.thumbnailUrl ?? photo.url}
                    alt={`${extractCity(selectedEvent.name)} ${i + 1}`}
                    className="aspect-square w-full object-cover rounded-lg"
                  />
                  <button
                    onClick={() =>
                      downloadImage(photo.url, `${extractCity(selectedEvent.name)}-${i + 1}.jpg`)
                    }
                    className="w-full flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors bg-sky-500 hover:bg-sky-600 text-white"
                  >
                    <Download size={14} />
                    Download
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : selectedEvent?.event_image_url ? (
          <div className="space-y-2">
            <img
              src={selectedEvent.event_image_url}
              alt={extractCity(selectedEvent.name)}
              className="rounded-lg max-h-64 w-full object-cover"
            />
            <button
              onClick={() =>
                downloadImage(
                  selectedEvent.event_image_url as string,
                  `${extractCity(selectedEvent.name)}-bpd-2026.jpg`,
                )
              }
              className="w-full flex items-center justify-center gap-2 rounded-lg px-4 py-3 font-semibold transition-colors bg-sky-500 hover:bg-sky-600 text-white"
            >
              <Download size={18} />
              Download
            </button>
          </div>
        ) : null}
      </div>

      <Footer />
    </div>
  );
}
