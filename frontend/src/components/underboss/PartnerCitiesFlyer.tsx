import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Download, RotateCcw } from 'lucide-react';
import type { SponsorUser, UnderbossEvent } from '../../types';
import { loadImg, CITY_COLOR, CITY_FONT } from '../flyer/renderFlyer';

interface PartnerCitiesFlyerProps {
  partner: SponsorUser;
  events: UnderbossEvent[];
  onClose: () => void;
}

const DEFAULT_LOGO_POS = { x: 340, y: 36 };
const DEFAULT_LOGO_SIZE = 50;
const CITY_BOX = { x: 40, y: 550, width: 500, height: 490 };
const MAX_VISIBLE = 20;
const OVERFLOW_SHOW = 18;

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

  // 3) City names
  ctx.textBaseline = 'top';
  const hasOverflow = cities.length > MAX_VISIBLE;
  const display = hasOverflow ? cities.slice(0, OVERFLOW_SHOW) : cities;
  const suffix = hasOverflow ? `+ ${cities.length - OVERFLOW_SHOW} MORE` : null;
  const lines = display.length + (suffix ? 1 : 0);

  // Auto-size font
  let fontSize = 48;
  const spacing = 1.2;
  const mc = document.createElement('canvas').getContext('2d')!;
  while (fontSize > 12) {
    mc.font = `${fontSize}px ${CITY_FONT}`;
    if (lines * fontSize * spacing > CITY_BOX.height) { fontSize--; continue; }
    let fits = true;
    for (const c of display) {
      if (mc.measureText(c.toUpperCase()).width > CITY_BOX.width) { fits = false; break; }
    }
    if (suffix && fits && mc.measureText(suffix).width > CITY_BOX.width) fits = false;
    if (fits) break;
    fontSize--;
  }

  ctx.fillStyle = CITY_COLOR;
  ctx.font = `${fontSize}px ${CITY_FONT}`;
  let y = CITY_BOX.y;
  for (const c of display) {
    ctx.fillText(c.toUpperCase(), CITY_BOX.x, y);
    y += fontSize * spacing;
  }
  if (suffix) ctx.fillText(suffix, CITY_BOX.x, y);

  return canvas;
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

  const cities = useMemo(() => {
    const raw = events
      .filter(e => e.eventTags?.includes(partner.tag))
      .map(e => e.name.replace(/^Global Pizza Party\s*/i, '').trim())
      .filter(Boolean);
    return [...new Set(raw)].sort();
  }, [events, partner.tag]);

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
      const result = await renderCitiesFlyer(cities, partner.coHostLogoUrl, logoPos, logoSize);
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        canvasRef.current.width = 1080;
        canvasRef.current.height = 1080;
        ctx.drawImage(result, 0, 0);
      }
    } catch (err) {
      console.error('Partner flyer preview failed:', err);
    }
  }, [cities, partner.coHostLogoUrl, logoPos, logoSize, fontsLoaded]);

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
      const canvas = await renderCitiesFlyer(cities, partner.coHostLogoUrl, logoPos, logoSize);
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

  const handleReset = () => { setLogoPos(DEFAULT_LOGO_POS); setLogoSize(DEFAULT_LOGO_SIZE); };
  const name = partner.coHostName || partner.name || partner.tag;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-theme-card border border-theme-stroke rounded-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-theme-stroke">
          <h3 className="text-sm font-semibold text-theme-text truncate">Partner Flyer &mdash; {name}</h3>
          <button onClick={onClose} className="text-theme-text-faint hover:text-theme-text-secondary transition-colors"><X size={18} /></button>
        </div>

        <div className="p-4">
          {cities.length === 0 ? (
            <p className="text-sm text-theme-text-faint text-center py-8">No events tagged with "{partner.tag}".</p>
          ) : (
            <>
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
                  />
                )}
              </div>

              <div className="mt-4 space-y-3">
                <div className="flex items-center gap-3">
                  <label className="text-xs text-theme-text-faint whitespace-nowrap w-16">Logo size</label>
                  <input type="range" min={20} max={120} value={logoSize} onChange={e => setLogoSize(Number(e.target.value))} className="flex-1 accent-red-500" />
                  <span className="text-xs text-theme-text-faint w-8 text-right">{logoSize}</span>
                </div>
                <p className="text-xs text-theme-text-faint">{cities.length} cit{cities.length === 1 ? 'y' : 'ies'} tagged with "{partner.tag}"</p>
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
