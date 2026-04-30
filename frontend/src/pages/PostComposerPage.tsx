import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { Loader2, Shield, FileText, Search, Copy, Check, Download, Image } from 'lucide-react';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { IconInput } from '../components/IconInput';
import { fetchAdminMe } from '../lib/api';
import { getAllParties } from '../lib/supabase';
import type { DbParty } from '../lib/supabase';
import { searchSkylinePhotos, UnsplashPhoto } from '../lib/unsplash';

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
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function PostComposerPage() {
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

  // Image composer state
  const [skylinePhotos, setSkylinePhotos] = useState<UnsplashPhoto[]>([]);
  const [selectedPhoto, setSelectedPhoto] = useState<UnsplashPhoto | null>(null);
  const [composedImageUrl, setComposedImageUrl] = useState<string>('');
  const [loadingSkyline, setLoadingSkyline] = useState(false);
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  /* ---- Load Hub 191 fonts ---- */
  useEffect(() => {
    const display = new FontFace('Hub 191 Display', 'url(/fonts/Hub-191-Display.otf)');
    const regular = new FontFace('Hub 191', 'url(/fonts/Hub-191-Regular.otf)');
    Promise.all([display.load(), regular.load()])
      .then(([disp, reg]) => {
        document.fonts.add(disp);
        document.fonts.add(reg);
        setFontsLoaded(true);
      })
      .catch((err) => {
        console.warn('Failed to load Hub 191 fonts:', err);
        setFontsLoaded(true); // render with fallback
      });
  }, []);

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

  /* ---- Skyline fetch when event changes ---- */
  useEffect(() => {
    if (!selectedEventId) return;
    const event = events.find((e) => e.id === selectedEventId);
    if (!event) return;
    const city = extractCity(event.name);

    setLoadingSkyline(true);
    searchSkylinePhotos(city).then((photos) => {
      setSkylinePhotos(photos);
      setSelectedPhoto(photos[0] || null);
      setLoadingSkyline(false);
    });
  }, [selectedEventId, events]);

  /* ---- Canvas compose function ---- */
  const composeImage = useCallback(async (photo: UnsplashPhoto, city: string, pizzeria: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = 1200, H = 630;
    canvas.width = W;
    canvas.height = H;

    // Load skyline photo
    const bgImg = new window.Image();
    bgImg.crossOrigin = 'anonymous';
    await new Promise<void>((resolve, reject) => {
      bgImg.onload = () => resolve();
      bgImg.onerror = reject;
      bgImg.src = photo.urls.regular;
    });

    // Draw cover-fit
    const scale = Math.max(W / bgImg.width, H / bgImg.height);
    const sw = W / scale, sh = H / scale;
    const sx = (bgImg.width - sw) / 2, sy = (bgImg.height - sh) / 2;
    ctx.drawImage(bgImg, sx, sy, sw, sh, 0, 0, W, H);

    // Draw city name (top-left with text shadow) — Hub 191 Display
    ctx.save();
    ctx.font = '64px "Hub 191 Display", "Comic Sans MS", cursive';
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillText(city.toUpperCase(), 42, 82);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(city.toUpperCase(), 40, 80);

    // Draw pizzeria name below city — Hub 191 Regular
    if (pizzeria) {
      ctx.font = '36px "Hub 191", "Comic Sans MS", cursive';
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillText(pizzeria, 42, 127);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(pizzeria, 40, 125);
    }
    ctx.restore();

    // Load Molto Benny SVG
    const svgImg = new window.Image();
    await new Promise<void>((resolve, reject) => {
      svgImg.onload = () => resolve();
      svgImg.onerror = reject;
      svgImg.src = '/molto-benny-btc.svg';
    });

    // Draw bottom-right with padding (400px tall)
    const bennyH = 400;
    const bennyW = (svgImg.width / svgImg.height) * bennyH;
    const pad = 24;
    ctx.drawImage(svgImg, W - bennyW - pad, H - bennyH - pad, bennyW, bennyH);

    // Export as data URL for preview
    setComposedImageUrl(canvas.toDataURL('image/png'));
  }, []);

  /* ---- Trigger compose when selectedPhoto changes ---- */
  useEffect(() => {
    if (selectedPhoto) {
      const event = events.find((e) => e.id === selectedEventId);
      const city = event ? extractCity(event.name) : '';
      const pizzeria = event ? getPizzeriaNames(event.selected_pizzerias as any[]) : '';
      composeImage(selectedPhoto, city, pizzeria);
    } else {
      setComposedImageUrl('');
    }
  }, [selectedPhoto, composeImage, selectedEventId, events, fontsLoaded]);

  /* ---- Download handler ---- */
  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const event = events.find((e) => e.id === selectedEventId);
    const city = event ? extractCity(event.name).toLowerCase().replace(/\s+/g, '-') : 'post';

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gpp-${city}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
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
          <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
          <p className="text-theme-text-muted text-center max-w-md">
            {error || 'You do not have admin access. Please log in with an admin account.'}
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
          <h1 className="text-2xl font-bold">Post Composer</h1>
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
          placeholder="Search events..."
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
              Copied!
            </>
          ) : (
            <>
              <Copy size={18} />
              Copy to Clipboard
            </>
          )}
        </button>

        {/* Hidden canvas */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Image Composer Section */}
        <div className="space-y-3 border-t border-white/10 pt-6">
          <div className="flex items-center gap-2">
            <Image size={20} className="text-theme-text-muted" />
            <h2 className="text-lg font-semibold">Image Composer</h2>
          </div>

          {/* Skyline thumbnail strip */}
          {loadingSkyline ? (
            <div className="flex items-center gap-2 text-sm text-white/50">
              <Loader2 size={16} className="animate-spin" />
              Loading skyline photos...
            </div>
          ) : skylinePhotos.length > 0 ? (
            <div className="grid grid-cols-3 gap-2">
              {skylinePhotos.map((photo) => (
                <button
                  key={photo.id}
                  onClick={() => setSelectedPhoto(photo)}
                  className={`rounded-lg overflow-hidden border-2 transition-all ${
                    selectedPhoto?.id === photo.id
                      ? 'border-sky-400 ring-2 ring-sky-400/30'
                      : 'border-white/10 hover:border-white/30'
                  }`}
                >
                  <img
                    src={photo.urls.small}
                    alt="Skyline"
                    className="w-full h-20 object-cover"
                  />
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-white/40">No skyline photos found for this city.</p>
          )}

          {/* Composed image preview */}
          {composedImageUrl && (
            <div className="space-y-2">
              <img
                src={composedImageUrl}
                alt="Composed post image"
                className="w-full rounded-lg border border-white/10"
              />
              {/* Attribution */}
              {selectedPhoto && (
                <p className="text-xs text-white/40">
                  Photo by{' '}
                  <a
                    href={`${selectedPhoto.user.links.html}?utm_source=rsvpizza&utm_medium=referral`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-white/60"
                  >
                    {selectedPhoto.user.name}
                  </a>{' '}
                  on{' '}
                  <a
                    href="https://unsplash.com/?utm_source=rsvpizza&utm_medium=referral"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-white/60"
                  >
                    Unsplash
                  </a>
                </p>
              )}
            </div>
          )}

          {/* Download button */}
          {composedImageUrl && (
            <button
              onClick={handleDownload}
              className="w-full flex items-center justify-center gap-2 rounded-lg px-4 py-3 font-semibold transition-colors bg-emerald-500 hover:bg-emerald-600 text-white"
            >
              <Download size={18} />
              Download Image
            </button>
          )}
        </div>
      </div>

      <Footer />
    </div>
  );
}
