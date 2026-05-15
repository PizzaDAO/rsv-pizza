import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Download, RotateCcw, Plus, Trash2 } from 'lucide-react';
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
const CITY_BOX = { x: 50, y: 605, width: 500, height: 490 };
const MAX_VISIBLE = 10;
const CITY_FONT_SIZE = 42;
const CITY_LINE_SPACING = 1.25;
const SUBHEAD_TEXT = 'SUPPORTING EVENTS IN';
const SUBHEAD_FONT_SIZE = 28;
const SUBHEAD_Y_OFFSET = -40; // above the first city line

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

  // 1) Template
  const tpl = await loadImg('/gpp-partner-flyer-template.png');
  ctx.drawImage(tpl, 0, 0, 1080, 1080);

  // 2) Partner logo
  try {
    const img = await loadImg(logoUrl);
    const maxH = logoSize;
    const maxW = logoSize * 3;
    const s = Math.min(maxW / img.width, maxH / img.height);
    const w = img.width * s;
    const h = img.height * s;
    ctx.drawImage(img, logoPos.x, logoPos.y - h / 2, w, h);
  } catch { /* skip */ }

  // 3) "Supporting the Events in" subheading in blue
  ctx.textBaseline = 'top';
  ctx.fillStyle = VENUE_COLOR;
  ctx.font = `${SUBHEAD_FONT_SIZE}px ${TEXT_FONT}`;
  ctx.fillText(SUBHEAD_TEXT, CITY_BOX.x, CITY_BOX.y + SUBHEAD_Y_OFFSET);

  // 4) City names — fixed font size
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
  if (suffix) {
    ctx.fillText(suffix, CITY_BOX.x, y);
  }

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
  const [logoPos, setLogoPos] = useState(DEFAULT_LOGO_POS);
  const [logoSize, setLogoSize] = useState(DEFAULT_LOGO_SIZE);
  const [containerWidth, setContainerWidth] = useState(500);
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const previewRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
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

  // Editable city list — initialized from events
  const [editCities, setEditCities] = useState<string[]>(defaultCities);
  const [newCity, setNewCity] = useState('');

  // Reset editCities when partner changes
  useEffect(() => { setEditCities(defaultCities); }, [defaultCities]);

  const scale = containerWidth / 1080;

  // Fonts
  useEffect(() => {
    const r = new FontFace('Hub 191', 'url(/fonts/Hub-191-Regular.otf)');
    const d = new FontFace('Hub 191 Display', 'url(/fonts/Hub-191-Display.otf)');
    Promise.all([r.load(), d.load()])
      .then(([rf, df]) => { document.fonts.add(rf); document.fonts.add(df); setFontsLoaded(true); })
      .catch(() => setFontsLoaded(true));
  }, []);

  // Container width
  useEffect(() => {
    if (!previewRef.current) return;
    const obs = new ResizeObserver(entries => {
      for (const e of entries) setContainerWidth(e.contentRect.width);
    });
    obs.observe(previewRef.current);
    return () => obs.disconnect();
  }, []);

  // Render preview
  const renderPreview = useCallback(async () => {
    if (!canvasRef.current || !fontsLoaded || !partner.coHostLogoUrl) return;
    try {
      const result = await renderCitiesFlyer(editCities, partner.coHostLogoUrl, logoPos, logoSize);
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        canvasRef.current.width = 1080;
        canvasRef.current.height = 1080;
        ctx.drawImage(result, 0, 0);
      }
    } catch (err) {
      console.error('Partner flyer preview failed:', err);
    }
  }, [editCities, partner.coHostLogoUrl, logoPos, logoSize, fontsLoaded]);

  useEffect(() => { renderPreview(); }, [renderPreview]);

  // Coordinate conversion
  const toCanvas = useCallback((cx: number, cy: number) => {
    if (!previewRef.current) return null;
    const r = previewRef.current.getBoundingClientRect();
    const s = r.width / 1080;
    return { x: (cx - r.left) / s, y: (cy - r.top) / s };
  }, []);

  // Logo drag - mouse
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
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
    const up = () => { draggingRef.current = false; document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }, [toCanvas, logoPos]);

  // Logo drag - touch
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
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
    const end = () => { draggingRef.current = false; document.removeEventListener('touchmove', move); document.removeEventListener('touchend', end); };
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', end);
  }, [toCanvas, logoPos]);

  // Logo dimensions for overlay
  const [logoDims, setLogoDims] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    if (!partner.coHostLogoUrl) return;
    loadImg(partner.coHostLogoUrl)
      .then(img => {
        const s = Math.min(logoSize * 3 / img.width, logoSize / img.height);
        setLogoDims({ w: img.width * s, h: img.height * s });
      })
      .catch(() => setLogoDims(null));
  }, [partner.coHostLogoUrl, logoSize]);

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
  };

  // City editing
  const handleCityRename = (index: number, value: string) => {
    setEditCities(prev => prev.map((c, i) => i === index ? value : c));
  };
  const handleCityRemove = (index: number) => {
    setEditCities(prev => prev.filter((_, i) => i !== index));
  };
  const handleCityAdd = () => {
    const trimmed = newCity.trim();
    if (!trimmed) return;
    setEditCities(prev => [...prev, trimmed]);
    setNewCity('');
  };

  const name = partner.coHostName || partner.name || partner.tag;

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
            <>
              {/* Canvas Preview */}
              <div ref={previewRef} className="relative w-full select-none" style={{ aspectRatio: '1 / 1' }}>
                <canvas ref={canvasRef} width={1080} height={1080} className="w-full h-full rounded-lg" />
                {logoDims && (
                  <div
                    onMouseDown={onMouseDown}
                    onTouchStart={onTouchStart}
                    className="absolute cursor-move"
                    style={{
                      left: logoPos.x * scale,
                      top: (logoPos.y - logoDims.h / 2) * scale,
                      width: logoDims.w * scale,
                      height: logoDims.h * scale,
                      border: '1px dashed rgba(255,255,255,0.4)',
                      borderRadius: 4,
                    }}
                    title="Drag to reposition logo"
                  >
                    {(() => {
                      const handleResizeStart = (e: React.MouseEvent) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const startX = e.clientX, startY = e.clientY;
                        const startSize = logoSize;
                        const rect = previewRef.current?.getBoundingClientRect();
                        const sc = rect ? rect.width / 1080 : 1;
                        const move = (ev: MouseEvent) => {
                          const dx = (ev.clientX - startX) / sc;
                          const dy = (ev.clientY - startY) / sc;
                          setLogoSize(Math.max(20, Math.min(120, Math.round(startSize + Math.max(dx, dy)))));
                        };
                        const up = () => {
                          document.removeEventListener('mousemove', move);
                          document.removeEventListener('mouseup', up);
                        };
                        document.addEventListener('mousemove', move);
                        document.addEventListener('mouseup', up);
                      };
                      const handleResizeTouchStart = (e: React.TouchEvent) => {
                        e.stopPropagation();
                        const startX = e.touches[0].clientX, startY = e.touches[0].clientY;
                        const startSize = logoSize;
                        const rect = previewRef.current?.getBoundingClientRect();
                        const sc = rect ? rect.width / 1080 : 1;
                        const move = (ev: TouchEvent) => {
                          ev.preventDefault();
                          const dx = (ev.touches[0].clientX - startX) / sc;
                          const dy = (ev.touches[0].clientY - startY) / sc;
                          setLogoSize(Math.max(20, Math.min(120, Math.round(startSize + Math.max(dx, dy)))));
                        };
                        const end = () => {
                          document.removeEventListener('touchmove', move);
                          document.removeEventListener('touchend', end);
                        };
                        document.addEventListener('touchmove', move, { passive: false });
                        document.addEventListener('touchend', end);
                      };
                      return (
                        <div
                          onMouseDown={handleResizeStart}
                          onTouchStart={handleResizeTouchStart}
                          title="Drag to resize logo"
                          style={{
                            position: 'absolute',
                            bottom: -4,
                            right: -4,
                            width: 14,
                            height: 14,
                            cursor: 'nwse-resize',
                            zIndex: 36,
                            background: 'rgba(255,255,255,0.6)',
                            border: '1.5px solid rgba(255,255,255,0.9)',
                            borderRadius: 2,
                          }}
                        />
                      );
                    })()}
                  </div>
                )}
              </div>

              {/* Controls */}
              <div className="mt-4 space-y-3">
                {/* Logo size slider */}
                <div className="flex items-center gap-3">
                  <label className="text-xs text-theme-text-faint whitespace-nowrap w-16">Logo size</label>
                  <input type="range" min={20} max={120} value={logoSize} onChange={e => setLogoSize(Number(e.target.value))} className="flex-1 accent-red-500" />
                  <span className="text-xs text-theme-text-faint w-8 text-right">{logoSize}</span>
                </div>

                {/* Editable city list */}
                <div>
                  <p className="text-xs text-theme-text-faint mb-1.5">Cities ({editCities.length})</p>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {editCities.map((city, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <input
                          type="text"
                          value={city}
                          onChange={e => handleCityRename(i, e.target.value)}
                          className="flex-1 bg-theme-surface border border-theme-stroke rounded px-2 py-1 text-xs text-theme-text placeholder:text-theme-text-faint focus:outline-none focus:border-theme-stroke-hover"
                        />
                        <button
                          onClick={() => handleCityRemove(i)}
                          className="p-1 text-theme-text-faint hover:text-red-400 transition-colors shrink-0"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-1 mt-1.5">
                    <input
                      type="text"
                      value={newCity}
                      onChange={e => setNewCity(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleCityAdd()}
                      placeholder="Add city..."
                      className="flex-1 bg-theme-surface border border-theme-stroke rounded px-2 py-1 text-xs text-theme-text placeholder:text-theme-text-faint focus:outline-none focus:border-theme-stroke-hover"
                    />
                    <button
                      onClick={handleCityAdd}
                      disabled={!newCity.trim()}
                      className="p-1 text-theme-text-faint hover:text-green-400 disabled:opacity-30 transition-colors shrink-0"
                    >
                      <Plus size={12} />
                    </button>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-2">
                  <button onClick={handleDownload} disabled={downloading} className="flex-1 flex items-center justify-center gap-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white py-2 rounded-lg text-sm font-medium transition-colors">
                    <Download size={14} />{downloading ? 'Generating...' : 'Download PNG'}
                  </button>
                  <button onClick={handleReset} className="p-2 text-theme-text-faint hover:text-theme-text-secondary transition-colors border border-theme-stroke rounded-lg" title="Reset to defaults">
                    <RotateCcw size={14} />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
