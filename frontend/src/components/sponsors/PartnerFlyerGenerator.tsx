import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Download } from 'lucide-react';
import { Sponsor } from '../../types';
import { renderPartnerFlyer } from '../flyer/renderFlyer';

interface PartnerFlyerGeneratorProps {
  sponsors: Sponsor[];
  cityName: string;
}

const DEFAULT_LOGO_SIZE = 200;

export function PartnerFlyerGenerator({ sponsors, cityName }: PartnerFlyerGeneratorProps) {
  const [selectedId, setSelectedId] = useState<string>(sponsors[0]?.id ?? '');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fontsReady, setFontsReady] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Logo position & size state (canvas coordinates, 1080x1080)
  const [logoPos, setLogoPos] = useState<{ x: number; y: number } | null>(null);
  const [logoSize, setLogoSize] = useState(DEFAULT_LOGO_SIZE);

  // Drag state
  const [dragging, setDragging] = useState(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  // Load fonts on mount
  useEffect(() => {
    (async () => {
      try {
        const regular = new FontFace('Hub 191', 'url(/fonts/Hub-191-Regular.otf)');
        const display = new FontFace('Hub 191 Display', 'url(/fonts/Hub-191-Display.otf)');
        const [reg, disp] = await Promise.all([regular.load(), display.load()]);
        document.fonts.add(reg);
        document.fonts.add(disp);
      } catch {
        // fallback fonts
      }
      setFontsReady(true);
    })();
  }, []);

  // Reset position/size when partner changes
  useEffect(() => {
    setLogoPos(null);
    setLogoSize(DEFAULT_LOGO_SIZE);
  }, [selectedId]);

  // Scale-aware coordinate conversion
  const clientToCanvas = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const el = containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const s = rect.width / 1080;
    return { x: (clientX - rect.left) / s, y: (clientY - rect.top) / s };
  }, []);

  // Generate preview when selection, position, or size changes
  useEffect(() => {
    if (!fontsReady || !selectedId) return;
    const sponsor = sponsors.find(s => s.id === selectedId);
    if (!sponsor?.logoUrl) return;

    let cancelled = false;
    (async () => {
      try {
        const canvas = await renderPartnerFlyer(
          cityName,
          sponsor.logoUrl!,
          logoPos ?? undefined,
          logoSize,
        );
        if (cancelled) return;
        canvasRef.current = canvas;
        setPreviewUrl(canvas.toDataURL('image/png'));
      } catch (err) {
        console.error('Failed to render partner flyer:', err);
      }
    })();

    return () => { cancelled = true; };
  }, [fontsReady, selectedId, cityName, sponsors, logoPos, logoSize]);

  // --- Drag handlers ---
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);

    const pos = clientToCanvas(e.clientX, e.clientY);
    if (!pos) return;

    if (logoPos) {
      dragOffsetRef.current = { x: pos.x - logoPos.x, y: pos.y - logoPos.y };
    } else {
      // First drag -- logo is centered in default box, compute center
      const cx = 50 + 980 / 2; // 540
      const cy = 660 + 380 / 2; // 850
      dragOffsetRef.current = { x: pos.x - cx, y: pos.y - cy };
      setLogoPos({ x: cx, y: cy });
    }

    const handleMove = (moveEvent: MouseEvent) => {
      const p = clientToCanvas(moveEvent.clientX, moveEvent.clientY);
      if (!p) return;
      const nx = Math.max(0, Math.min(1080, p.x - dragOffsetRef.current.x));
      const ny = Math.max(0, Math.min(1080, p.y - dragOffsetRef.current.y));
      setLogoPos({ x: nx, y: ny });
    };
    const handleUp = () => {
      setDragging(false);
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [clientToCanvas, logoPos]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.stopPropagation();
    const touch = e.touches[0];
    setDragging(true);

    const pos = clientToCanvas(touch.clientX, touch.clientY);
    if (!pos) return;

    if (logoPos) {
      dragOffsetRef.current = { x: pos.x - logoPos.x, y: pos.y - logoPos.y };
    } else {
      const cx = 540, cy = 850;
      dragOffsetRef.current = { x: pos.x - cx, y: pos.y - cy };
      setLogoPos({ x: cx, y: cy });
    }

    const handleMove = (moveEvent: TouchEvent) => {
      moveEvent.preventDefault();
      const t = moveEvent.touches[0];
      const p = clientToCanvas(t.clientX, t.clientY);
      if (!p) return;
      const nx = Math.max(0, Math.min(1080, p.x - dragOffsetRef.current.x));
      const ny = Math.max(0, Math.min(1080, p.y - dragOffsetRef.current.y));
      setLogoPos({ x: nx, y: ny });
    };
    const handleUp = () => {
      setDragging(false);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleUp);
    };
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleUp);
  }, [clientToCanvas, logoPos]);

  // --- Resize handlers ---
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startSize = logoSize;
    const rect = containerRef.current?.getBoundingClientRect();
    const sc = rect ? rect.width / 1080 : 1;

    // If logo hasn't been positioned yet, place it at center of default box
    if (!logoPos) {
      setLogoPos({ x: 540, y: 850 });
    }

    const handleMove = (moveEvent: MouseEvent) => {
      const deltaY = (moveEvent.clientY - startY) / sc;
      const newSize = Math.max(40, Math.min(300, startSize + deltaY));
      setLogoSize(Math.round(newSize));
    };
    const handleUp = () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [logoSize, logoPos]);

  const handleTouchResizeStart = useCallback((e: React.TouchEvent) => {
    e.stopPropagation();
    const startY = e.touches[0].clientY;
    const startSize = logoSize;
    const rect = containerRef.current?.getBoundingClientRect();
    const sc = rect ? rect.width / 1080 : 1;

    if (!logoPos) {
      setLogoPos({ x: 540, y: 850 });
    }

    const handleMove = (moveEvent: TouchEvent) => {
      moveEvent.preventDefault();
      const deltaY = (moveEvent.touches[0].clientY - startY) / sc;
      const newSize = Math.max(40, Math.min(300, startSize + deltaY));
      setLogoSize(Math.round(newSize));
    };
    const handleUp = () => {
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleUp);
    };
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleUp);
  }, [logoSize, logoPos]);

  if (sponsors.length === 0) return null;

  const selectedSponsor = sponsors.find(s => s.id === selectedId);

  const handleDownload = () => {
    if (!previewUrl || !selectedSponsor) return;
    const a = document.createElement('a');
    a.href = previewUrl;
    const safeName = selectedSponsor.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    a.download = `partner-flyer-${safeName}.png`;
    a.click();
  };

  // Compute logo overlay position for the interactive layer
  // When logoPos is set, show the logo overlay at that position scaled to container
  const logoOverlayStyle: React.CSSProperties | null = logoPos ? (() => {
    const maxW = logoSize * 2.5;
    const maxH = logoSize;
    return {
      position: 'absolute' as const,
      left: `${(logoPos.x / 1080) * 100}%`,
      top: `${(logoPos.y / 1080) * 100}%`,
      width: `${(maxW / 1080) * 100}%`,
      height: `${(maxH / 1080) * 100}%`,
      transform: 'translate(-50%, -50%)',
      cursor: dragging ? 'grabbing' : 'grab',
      zIndex: 10,
    };
  })() : null;

  return (
    <div className="card bg-theme-header border-theme-stroke p-4">
      <h3 className="text-sm font-semibold text-theme-text mb-3">Partner Flyer</h3>

      <select
        value={selectedId}
        onChange={e => setSelectedId(e.target.value)}
        className="w-full mb-3 px-3 py-2 bg-theme-surface border border-theme-stroke rounded-lg text-theme-text text-sm"
      >
        {sponsors.map(s => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>

      {previewUrl && (
        <div
          ref={containerRef}
          className="relative w-full max-w-[400px] mb-3 select-none"
          style={{ aspectRatio: '1 / 1' }}
        >
          <img
            src={previewUrl}
            alt="Partner flyer preview"
            className="w-full rounded-lg pointer-events-none"
            draggable={false}
          />

          {/* Transparent drag overlay for logo area */}
          {logoOverlayStyle ? (
            <div
              style={logoOverlayStyle}
              onMouseDown={handleDragStart}
              onTouchStart={handleTouchStart}
            >
              {/* Resize handle -- bottom-right corner */}
              <div
                onMouseDown={handleResizeStart}
                onTouchStart={handleTouchResizeStart}
                style={{
                  position: 'absolute',
                  bottom: 0,
                  right: 0,
                  width: 14,
                  height: 14,
                  cursor: 'nwse-resize',
                  zIndex: 20,
                  background: 'linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.5) 50%)',
                  borderRadius: '0 0 4px 0',
                }}
              />
            </div>
          ) : (
            /* Before first drag: cover the default logo area so user can start dragging */
            <div
              style={{
                position: 'absolute',
                left: `${(50 / 1080) * 100}%`,
                top: `${(660 / 1080) * 100}%`,
                width: `${(980 / 1080) * 100}%`,
                height: `${(380 / 1080) * 100}%`,
                cursor: 'grab',
              }}
              onMouseDown={handleDragStart}
              onTouchStart={handleTouchStart}
            >
              <div
                onMouseDown={handleResizeStart}
                onTouchStart={handleTouchResizeStart}
                style={{
                  position: 'absolute',
                  bottom: 0,
                  right: 0,
                  width: 14,
                  height: 14,
                  cursor: 'nwse-resize',
                  zIndex: 20,
                  background: 'linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.5) 50%)',
                  borderRadius: '0 0 4px 0',
                }}
              />
            </div>
          )}
        </div>
      )}

      <button
        onClick={handleDownload}
        disabled={!previewUrl}
        className="flex items-center gap-2 px-3 py-2 bg-[#ff393a] hover:bg-[#ff393a]/80 disabled:opacity-50 text-white rounded-lg transition-colors text-sm"
      >
        <Download size={16} />
        Download
      </button>
    </div>
  );
}
