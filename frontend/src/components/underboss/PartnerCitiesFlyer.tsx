import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X, Download, RotateCcw, Pencil, Loader2 } from 'lucide-react';
import type { SponsorUser, UnderbossEvent } from '../../types';
import { loadImg, CITY_COLOR, CITY_FONT, TEXT_FONT, VENUE_COLOR } from '../flyer/renderFlyer';
import { getCityTier } from '../../utils/sponsorshipPricing';

interface PartnerCitiesFlyerProps {
  partner: SponsorUser;
  events: UnderbossEvent[];
  onClose: () => void;
}

const DEFAULT_LOGO_POS = { x: 340, y: 36 };
const DEFAULT_LOGO_SIZE = 50;
const CITY_BOX = { x: 40, y: 550, width: 500, height: 490 };
const MAX_VISIBLE = 10;
const CITY_FONT_SIZE = 36;
const CITY_LINE_SPACING = 1.25;
const SUBHEAD_TEXT = 'SUPPORTING THE EVENTS IN';
const SUBHEAD_FONT_SIZE = 28;
const SUBHEAD_Y = 510; // just above city box

/** Render to canvas for download only */
async function renderCitiesFlyer(
  cities: string[],
  logoUrl: string,
  logoPos: { x: number; y: number },
  logoSize: number,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1080;
  const ctx = canvas.getContext('2d')!;

  const tpl = await loadImg('/gpp-partner-flyer-template.png');
  ctx.drawImage(tpl, 0, 0, 1080, 1080);

  // Partner logo
  try {
    const img = await loadImg(logoUrl);
    const maxH = logoSize;
    const maxW = logoSize * 3;
    const s = Math.min(maxW / img.width, maxH / img.height);
    const w = img.width * s;
    const h = img.height * s;
    ctx.drawImage(img, logoPos.x, logoPos.y - h / 2, w, h);
  } catch { /* skip */ }

  // "Supporting the Events in" subheading
  ctx.textBaseline = 'top';
  ctx.fillStyle = VENUE_COLOR;
  ctx.font = `${SUBHEAD_FONT_SIZE}px ${TEXT_FONT}`;
  ctx.fillText(SUBHEAD_TEXT, CITY_BOX.x, SUBHEAD_Y);

  // City names
  const hasOverflow = cities.length > MAX_VISIBLE;
  const display = hasOverflow ? cities.slice(0, MAX_VISIBLE) : cities;
  const suffix = hasOverflow ? `+ ${cities.length - MAX_VISIBLE} MORE` : null;

  ctx.fillStyle = CITY_COLOR;
  ctx.font = `${CITY_FONT_SIZE}px ${CITY_FONT}`;
  let y = CITY_BOX.y;
  for (const c of display) {
    ctx.fillText(c.toUpperCase(), CITY_BOX.x, y);
    y += CITY_FONT_SIZE * CITY_LINE_SPACING;
  }
  if (suffix) ctx.fillText(suffix, CITY_BOX.x, y);

  return canvas;
}

/** Sort cities by tier (1 first) then alphabetical */
function sortCitiesByTier(cities: string[]): string[] {
  return [...cities].sort((a, b) => {
    const tierA = getCityTier(a);
    const tierB = getCityTier(b);
    if (tierA !== tierB) return tierA - tierB;
    return a.localeCompare(b);
  });
}

export function PartnerCitiesFlyer({ partner, events, onClose }: PartnerCitiesFlyerProps) {
  const { t } = useTranslation('partner');
  const [logoPos, setLogoPos] = useState(DEFAULT_LOGO_POS);
  const [logoSize, setLogoSize] = useState(DEFAULT_LOGO_SIZE);
  const [containerWidth, setContainerWidth] = useState(500);
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const previewRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const offsetRef = useRef({ x: 0, y: 0 });

  // Derive initial cities from events
  const defaultCities = useMemo(() => {
    const raw = events
      .filter(e => e.eventTags?.includes(partner.tag))
      .map(e => e.name.replace(/^Global Pizza Party\s*/i, '').trim())
      .filter(Boolean);
    return sortCitiesByTier([...new Set(raw)]);
  }, [events, partner.tag]);

  const [editCities, setEditCities] = useState<string[]>(defaultCities);
  useEffect(() => { setEditCities(defaultCities); }, [defaultCities]);

  const scale = containerWidth / 1080;

  // Visible cities + overflow
  const hasOverflow = editCities.length > MAX_VISIBLE;
  const displayCities = hasOverflow ? editCities.slice(0, MAX_VISIBLE) : editCities;
  const overflowCount = hasOverflow ? editCities.length - MAX_VISIBLE : 0;

  // Fonts
  useEffect(() => {
    const r = new FontFace('Hub 191', 'url(/fonts/Hub-191-Regular.otf)');
    const d = new FontFace('Hub 191 Display', 'url(/fonts/Hub-191-Display.otf)');
    Promise.all([r.load(), d.load()])
      .then(([rf, df]) => { document.fonts.add(rf); document.fonts.add(df); setFontsLoaded(true); })
      .catch(() => setFontsLoaded(true));
  }, []);

  // Container width tracking
  useEffect(() => {
    if (!previewRef.current) return;
    const obs = new ResizeObserver(entries => {
      for (const e of entries) setContainerWidth(e.contentRect.width);
    });
    obs.observe(previewRef.current);
    return () => obs.disconnect();
  }, []);

  // Coordinate conversion (screen → 1080px canvas space)
  const toCanvas = useCallback((cx: number, cy: number) => {
    if (!canvasRef.current) return null;
    const r = canvasRef.current.getBoundingClientRect();
    const s = r.width / 1080;
    return { x: (cx - r.left) / s, y: (cy - r.top) / s };
  }, []);

  // Logo drag - mouse
  const onLogoMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const p = toCanvas(e.clientX, e.clientY);
    if (!p) return;
    draggingRef.current = true;
    offsetRef.current = { x: p.x - logoPos.x, y: p.y - logoPos.y };

    const move = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const q = toCanvas(ev.clientX, ev.clientY);
      if (!q) return;
      setLogoPos({
        x: Math.max(0, Math.min(1080, q.x - offsetRef.current.x)),
        y: Math.max(0, Math.min(1080, q.y - offsetRef.current.y)),
      });
    };
    const up = () => {
      draggingRef.current = false;
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }, [toCanvas, logoPos]);

  // Logo drag - touch
  const onLogoTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    e.stopPropagation();
    const t = e.touches[0];
    const p = toCanvas(t.clientX, t.clientY);
    if (!p) return;
    draggingRef.current = true;
    offsetRef.current = { x: p.x - logoPos.x, y: p.y - logoPos.y };

    const move = (ev: TouchEvent) => {
      if (!draggingRef.current || ev.touches.length !== 1) return;
      ev.preventDefault();
      const q = toCanvas(ev.touches[0].clientX, ev.touches[0].clientY);
      if (!q) return;
      setLogoPos({
        x: Math.max(0, Math.min(1080, q.x - offsetRef.current.x)),
        y: Math.max(0, Math.min(1080, q.y - offsetRef.current.y)),
      });
    };
    const end = () => {
      draggingRef.current = false;
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', end);
    };
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', end);
  }, [toCanvas, logoPos]);

  // Logo resize drag
  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startSize = logoSize;
    const rect = canvasRef.current?.getBoundingClientRect();
    const sc = rect ? rect.width / 1080 : 1;

    const move = (ev: MouseEvent) => {
      const delta = (ev.clientY - startY) / sc;
      setLogoSize(Math.max(20, Math.min(120, Math.round(startSize + delta))));
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }, [logoSize]);

  const onResizeTouchStart = useCallback((e: React.TouchEvent) => {
    e.stopPropagation();
    const startY = e.touches[0].clientY;
    const startSize = logoSize;
    const rect = canvasRef.current?.getBoundingClientRect();
    const sc = rect ? rect.width / 1080 : 1;

    const move = (ev: TouchEvent) => {
      ev.preventDefault();
      const delta = (ev.touches[0].clientY - startY) / sc;
      setLogoSize(Math.max(20, Math.min(120, Math.round(startSize + delta))));
    };
    const up = () => {
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', up);
    };
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', up);
  }, [logoSize]);

  // City editing
  const handleCityRename = (index: number, value: string) => {
    setEditCities(prev => prev.map((c, i) => i === index ? value : c));
  };

  const handleDownload = async () => {
    if (!partner.coHostLogoUrl) return;
    setDownloading(true);
    try {
      const canvas = await renderCitiesFlyer(editCities, partner.coHostLogoUrl, logoPos, logoSize);
      const a = document.createElement('a');
      a.download = `gpp-partner-${partner.tag}.png`;
      a.href = canvas.toDataURL('image/png');
      a.click();
    } catch (err) {
      console.error('Download failed:', err);
    } finally {
      setDownloading(false);
    }
  };

  const handleReset = () => {
    setLogoPos(DEFAULT_LOGO_POS);
    setLogoSize(DEFAULT_LOGO_SIZE);
    setEditCities(defaultCities);
    setEditingIndex(null);
  };

  const name = partner.coHostName || partner.name || partner.tag;

  /** The 1080px HTML preview content (same pattern as FlyerGenerator) */
  const renderFlyerContent = () => (
    <div
      style={{
        width: 1080,
        height: 1080,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Template background */}
      <img
        src="/gpp-partner-flyer-template.png"
        alt=""
        style={{ width: '100%', height: '100%', display: 'block' }}
        crossOrigin="anonymous"
      />

      {/* Partner logo — draggable */}
      {partner.coHostLogoUrl && (
        <div
          onMouseDown={onLogoMouseDown}
          onTouchStart={onLogoTouchStart}
          style={{
            position: 'absolute',
            top: logoPos.y - logoSize / 2,
            left: logoPos.x,
            cursor: draggingRef.current ? 'grabbing' : 'grab',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            zIndex: 10,
          }}
        >
          <img
            src={partner.coHostLogoUrl}
            alt={name}
            crossOrigin="anonymous"
            style={{
              height: logoSize,
              maxWidth: logoSize * 3,
              objectFit: 'contain',
            }}
            draggable={false}
          />
          {/* Resize handle */}
          <div
            onMouseDown={onResizeStart}
            onTouchStart={onResizeTouchStart}
            style={{
              position: 'absolute',
              bottom: 0,
              right: 0,
              width: 14,
              height: 14,
              cursor: 'nwse-resize',
              zIndex: 35,
              background: 'linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.5) 50%)',
              borderRadius: '0 0 4px 0',
            }}
          />
        </div>
      )}

      {/* "Supporting the Events in" subheading */}
      <div
        style={{
          position: 'absolute',
          top: SUBHEAD_Y,
          left: CITY_BOX.x,
          fontSize: SUBHEAD_FONT_SIZE,
          fontFamily: TEXT_FONT,
          color: VENUE_COLOR,
          textTransform: 'uppercase',
          lineHeight: 1,
          whiteSpace: 'nowrap',
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
      >
        {SUBHEAD_TEXT}
      </div>

      {/* City names — inline editable */}
      {displayCities.map((city, i) => {
        const isEditing = editingIndex === i;
        const y = CITY_BOX.y + i * (CITY_FONT_SIZE * CITY_LINE_SPACING);
        return (
          <div
            key={i}
            onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditingIndex(i); }}
            style={{
              position: 'absolute',
              top: y,
              left: CITY_BOX.x,
              width: CITY_BOX.width,
              height: CITY_FONT_SIZE * CITY_LINE_SPACING,
              fontSize: CITY_FONT_SIZE,
              fontFamily: CITY_FONT,
              color: CITY_COLOR,
              textTransform: 'uppercase',
              lineHeight: 1,
              whiteSpace: 'nowrap',
              cursor: isEditing ? 'text' : 'default',
              userSelect: isEditing ? 'auto' : 'none',
              WebkitUserSelect: isEditing ? 'auto' : 'none',
            }}
          >
            {isEditing ? (
              <input
                autoFocus
                value={city}
                onChange={e => handleCityRename(i, e.target.value)}
                onBlur={() => setEditingIndex(null)}
                onKeyDown={e => { if (e.key === 'Enter') setEditingIndex(null); if (e.key === 'Escape') setEditingIndex(null); }}
                onClick={e => e.stopPropagation()}
                onMouseDown={e => e.stopPropagation()}
                style={{
                  width: '100%',
                  background: 'rgba(0,0,0,0.5)',
                  border: '1px solid rgba(255,255,255,0.3)',
                  borderRadius: 4,
                  outline: 'none',
                  color: 'inherit',
                  fontSize: 'inherit',
                  fontFamily: 'inherit',
                  textTransform: 'inherit' as any,
                  lineHeight: 'inherit',
                  padding: '0 4px',
                  margin: 0,
                }}
              />
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, position: 'relative', paddingRight: 50 }}>
                {city.toUpperCase()}
                <Pencil
                  size={28}
                  style={{ cursor: 'pointer', opacity: 0.6, flexShrink: 0, position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)' }}
                  onClick={(e) => { e.stopPropagation(); setEditingIndex(i); }}
                />
              </span>
            )}
          </div>
        );
      })}

      {/* Overflow "+ X MORE" */}
      {hasOverflow && (
        <div
          style={{
            position: 'absolute',
            top: CITY_BOX.y + MAX_VISIBLE * (CITY_FONT_SIZE * CITY_LINE_SPACING),
            left: CITY_BOX.x,
            fontSize: CITY_FONT_SIZE,
            fontFamily: CITY_FONT,
            color: CITY_COLOR,
            textTransform: 'uppercase',
            lineHeight: 1,
            whiteSpace: 'nowrap',
            userSelect: 'none',
            WebkitUserSelect: 'none',
          }}
        >
          + {overflowCount} MORE
        </div>
      )}
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black" onClick={onClose}>
      <div className="bg-theme-card border border-theme-stroke rounded-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-theme-stroke">
          <h3 className="text-sm font-semibold text-theme-text truncate">Partner Flyer &mdash; {name}</h3>
          <button onClick={onClose} className="text-theme-text-faint hover:text-theme-text-secondary transition-colors"><X size={18} /></button>
        </div>

        <div className="p-4">
          {defaultCities.length === 0 ? (
            <p className="text-sm text-theme-text-faint text-center py-8">No events tagged with &ldquo;{partner.tag}&rdquo;.</p>
          ) : (
            <div className="space-y-4">
              {/* Hint */}
              <p className="text-center text-xs text-white/40">
                Double-click city names to edit. Drag logo to reposition. Drag corner to resize.
              </p>

              {/* Scaled preview — same pattern as FlyerGenerator */}
              <div className="relative mx-auto" style={{ maxWidth: 500 }}>
                <div
                  ref={previewRef}
                  style={{
                    width: '100%',
                    paddingBottom: '100%',
                    position: 'relative',
                    borderRadius: 16,
                    overflow: 'hidden',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
                  }}
                >
                  <div
                    ref={canvasRef}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: 1080,
                      height: 1080,
                      transform: `scale(${scale})`,
                      transformOrigin: 'top left',
                    }}
                  >
                    {fontsLoaded && renderFlyerContent()}
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex justify-center gap-3">
                <button
                  onClick={handleDownload}
                  disabled={downloading}
                  className="btn-primary flex items-center gap-2 px-6 py-3"
                >
                  {downloading ? (
                    <><Loader2 className="w-5 h-5 animate-spin" /> {t('partnerFlyer.generating')}</>
                  ) : (
                    <><Download className="w-5 h-5" /> {t('partnerFlyer.download')}</>
                  )}
                </button>
                <button
                  onClick={handleReset}
                  className="flex items-center gap-2 px-4 py-3 rounded-lg bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors text-sm"
                  title={t('partnerManager.resetDefaults')}
                >
                  <RotateCcw className="w-4 h-4" /> {t('partnerFlyer.reset')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
