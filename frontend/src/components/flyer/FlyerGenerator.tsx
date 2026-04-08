import React, { useRef, useState, useEffect, useCallback } from 'react';
import { usePizza } from '../../contexts/PizzaContext';
import { getSponsors, createSponsor } from '../../lib/api';
import { getDateTimeInTimezone } from '../../utils/dateUtils';
import { Sponsor } from '../../types';
import { Download, Loader2, RotateCcw, Move, Plus } from 'lucide-react';
import { useFlyerDrag, DEFAULT_POSITIONS, FlyerPositions } from './useFlyerDrag';
import { PartnerForm, extractSponsorData } from '../sponsors/PartnerForm';
import type { PartnerFormData } from '../sponsors/PartnerForm';

function parseCityFromAddress(address: string): string {
  const parts = address.split(',').map(p => p.trim());
  if (parts.length >= 3) return parts[parts.length - 3] || parts[1];
  if (parts.length >= 2) return parts[1];
  return parts[0];
}

/**
 * Measure text with an offscreen canvas and return the optimal font size
 * that fits within maxWidth, starting from maxFontSize down to minFontSize.
 */
function fitText(
  text: string,
  fontFamily: string,
  maxFontSize: number,
  maxWidth: number,
  minFontSize: number = 14,
): number {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return maxFontSize;

  let size = maxFontSize;
  // Quote font family names with spaces for canvas API
  const quotedFont = fontFamily.includes(' ') ? `"${fontFamily}"` : fontFamily;
  while (size > minFontSize) {
    ctx.font = `${size}px ${quotedFont}`;
    const measured = ctx.measureText(text.toUpperCase());
    if (measured.width <= maxWidth) break;
    size -= 1;
  }
  return Math.max(size, minFontSize);
}

/** Load an image as a promise for canvas drawing */
function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

const CITY_FONT = '"Hub 191 Display", "Hub 191", "Comic Sans MS", cursive';
const TEXT_FONT = '"Hub 191", "Comic Sans MS", "Comic Sans", cursive';
const CITY_COLOR = '#FE332C';
const TIME_COLOR = '#FFFFFF';

// Bounding box dimensions (measured from boxes overlay at 1080px)
const CITY_BOX = { width: 587, height: 72 };
const VENUE_BOX = { width: 600, height: 110 };
const TIME_BOX = { width: 300, height: 60 }; // sized to match MAY 22 text height
const SPONSOR_BOX = { width: 759, height: 171 };

export function FlyerGenerator() {
  const { party } = usePizza();
  const previewRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [containerWidth, setContainerWidth] = useState(500);
  const [hoveredElement, setHoveredElement] = useState<keyof FlyerPositions | null>(null);

  // Load saved customizations from localStorage
  // NOTE: Must be declared before any useState that references savedState
  const storageKey = party ? `flyer-${party.id}` : null;
  const savedState = React.useMemo(() => {
    if (!storageKey) return null;
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }, [storageKey]);

  const [editVenueName, setEditVenueName] = useState<string | null>(savedState?.editVenueName ?? null);
  const [editStreetAddress, setEditStreetAddress] = useState<string | null>(savedState?.editStreetAddress ?? null);
  const [editCity, setEditCity] = useState<string | null>(savedState?.editCity ?? null);
  const [logoSizes, setLogoSizes] = useState<Record<string, number>>(savedState?.logoSizes || {});
  const defaultLogoSize = 80;
  const [showAddSponsor, setShowAddSponsor] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fontsLoaded, setFontsLoaded] = useState(false);

  // Popped-out logos: keyed by sponsor ID, value is absolute position on 1080px canvas
  const [poppedLogos, setPoppedLogos] = useState<Record<string, { x: number; y: number }>>(
    () => savedState?.poppedLogos || {}
  );
  const [draggingLogo, setDraggingLogo] = useState<string | null>(null);
  const logoOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  // Selected logo in group (double-clicked, shows sizing bar, ready to drag out)
  const [selectedGroupLogo, setSelectedGroupLogo] = useState<string | null>(null);
  // Inline text editing on the flyer
  const [editingField, setEditingField] = useState<'city' | 'venue' | 'street' | null>(null);

  // Draggable element positions (in 1080px canvas coordinates)
  const [positions, setPositions] = useState<FlyerPositions>(
    () => savedState?.positions || { ...DEFAULT_POSITIONS }
  );

  const handlePositionChange = useCallback((key: keyof FlyerPositions, pos: { x: number; y: number }) => {
    setPositions(prev => {
      // When dragging venue, only allow vertical movement (x locked to city)
      if (key === 'venue') {
        return { ...prev, venue: { x: prev.city.x, y: pos.y } };
      }
      return { ...prev, [key]: pos };
    });
  }, []);

  const { dragging, handleMouseDown, handleTouchStart } = useFlyerDrag({
    canvasRef,
    positions,
    onPositionChange: handlePositionChange,
  });

  const handleResetPositions = useCallback(() => {
    setPositions({ ...DEFAULT_POSITIONS });
    setPoppedLogos({});
    setSelectedGroupLogo(null);
    setLogoSizes({});
    setEditVenueName(null);
    setEditStreetAddress(null);
    setEditCity(null);
    if (storageKey) {
      try { localStorage.removeItem(storageKey); } catch {}
    }
  }, [storageKey]);

  /** Convert a client (screen) coordinate to 1080px canvas coordinate */
  const clientToCanvas = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const s = rect.width / 1080;
    return { x: (clientX - rect.left) / s, y: (clientY - rect.top) / s };
  }, []);

  /** Double-click a logo in the group to select it (show sizing bar, ready to drag out) */
  const handleLogoDoubleClick = useCallback((sponsorId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // If already popped, return to group
    if (poppedLogos[sponsorId]) {
      setPoppedLogos(prev => {
        const next = { ...prev };
        delete next[sponsorId];
        return next;
      });
      return;
    }
    // Toggle selection in group
    setSelectedGroupLogo(prev => prev === sponsorId ? null : sponsorId);
  }, [poppedLogos]);

  /** Start dragging a selected group logo — pops it out on drag (mouse) */
  const handleGroupLogoDragStart = useCallback((sponsorId: string, e: React.MouseEvent) => {
    if (selectedGroupLogo !== sponsorId) return; // only drag selected logos
    e.preventDefault();
    e.stopPropagation();

    const startPos = clientToCanvas(e.clientX, e.clientY);
    if (!startPos) return;
    let hasMoved = false;

    const handleMove = (moveEvent: MouseEvent) => {
      const p = clientToCanvas(moveEvent.clientX, moveEvent.clientY);
      if (!p) return;
      if (!hasMoved) {
        // First move — pop the logo out at cursor position
        hasMoved = true;
        setDraggingLogo(sponsorId);
        logoOffsetRef.current = { x: 40, y: 40 };
        setPoppedLogos(prev => ({ ...prev, [sponsorId]: { x: p.x - 40, y: p.y - 40 } }));
        setSelectedGroupLogo(null);
      }
      const nx = Math.max(0, Math.min(1080, p.x - logoOffsetRef.current.x));
      const ny = Math.max(0, Math.min(1080, p.y - logoOffsetRef.current.y));
      setPoppedLogos(prev => ({ ...prev, [sponsorId]: { x: nx, y: ny } }));
    };
    const handleUp = () => {
      setDraggingLogo(null);
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [selectedGroupLogo, clientToCanvas]);

  /** Start dragging a selected group logo — pops it out on drag (touch) */
  const handleGroupLogoTouchStart = useCallback((sponsorId: string, e: React.TouchEvent) => {
    if (selectedGroupLogo !== sponsorId) return;
    e.stopPropagation();

    const touch = e.touches[0];
    const startPos = clientToCanvas(touch.clientX, touch.clientY);
    if (!startPos) return;
    let hasMoved = false;

    const handleMove = (moveEvent: TouchEvent) => {
      moveEvent.preventDefault();
      const t = moveEvent.touches[0];
      const p = clientToCanvas(t.clientX, t.clientY);
      if (!p) return;
      if (!hasMoved) {
        hasMoved = true;
        setDraggingLogo(sponsorId);
        logoOffsetRef.current = { x: 40, y: 40 };
        setPoppedLogos(prev => ({ ...prev, [sponsorId]: { x: p.x - 40, y: p.y - 40 } }));
        setSelectedGroupLogo(null);
      }
      const nx = Math.max(0, Math.min(1080, p.x - logoOffsetRef.current.x));
      const ny = Math.max(0, Math.min(1080, p.y - logoOffsetRef.current.y));
      setPoppedLogos(prev => ({ ...prev, [sponsorId]: { x: nx, y: ny } }));
    };
    const handleUp = () => {
      setDraggingLogo(null);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleUp);
    };
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleUp);
  }, [selectedGroupLogo, clientToCanvas]);

  /** Start dragging a popped-out logo (mouse) */
  const handleLogoDragStart = useCallback((sponsorId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDraggingLogo(sponsorId);

    const pos = clientToCanvas(e.clientX, e.clientY);
    const logoPos = poppedLogos[sponsorId];
    if (!pos || !logoPos) return;
    logoOffsetRef.current = { x: pos.x - logoPos.x, y: pos.y - logoPos.y };

    const handleMove = (moveEvent: MouseEvent) => {
      const p = clientToCanvas(moveEvent.clientX, moveEvent.clientY);
      if (!p) return;
      const nx = Math.max(0, Math.min(1080, p.x - logoOffsetRef.current.x));
      const ny = Math.max(0, Math.min(1080, p.y - logoOffsetRef.current.y));
      setPoppedLogos(prev => ({ ...prev, [sponsorId]: { x: nx, y: ny } }));
    };
    const handleUp = () => {
      setDraggingLogo(null);
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [clientToCanvas, poppedLogos]);

  /** Start dragging a popped-out logo (touch) */
  const handleLogoDragTouchStart = useCallback((sponsorId: string, e: React.TouchEvent) => {
    e.stopPropagation();
    setDraggingLogo(sponsorId);

    const touch = e.touches[0];
    const pos = clientToCanvas(touch.clientX, touch.clientY);
    const logoPos = poppedLogos[sponsorId];
    if (!pos || !logoPos) return;
    logoOffsetRef.current = { x: pos.x - logoPos.x, y: pos.y - logoPos.y };

    const handleMove = (moveEvent: TouchEvent) => {
      moveEvent.preventDefault();
      const t = moveEvent.touches[0];
      const p = clientToCanvas(t.clientX, t.clientY);
      if (!p) return;
      const nx = Math.max(0, Math.min(1080, p.x - logoOffsetRef.current.x));
      const ny = Math.max(0, Math.min(1080, p.y - logoOffsetRef.current.y));
      setPoppedLogos(prev => ({ ...prev, [sponsorId]: { x: nx, y: ny } }));
    };
    const handleUp = () => {
      setDraggingLogo(null);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleUp);
    };
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleUp);
  }, [clientToCanvas, poppedLogos]);

  const loadSponsors = useCallback(() => {
    if (!party?.id) return;
    getSponsors(party.id).then(result => {
      if (result?.sponsors) {
        setSponsors(result.sponsors.filter(s => s.logoUrl && (s.status === 'yes' || s.status === 'paid')));
      }
    });
  }, [party?.id]);

  useEffect(() => {
    loadSponsors();
  }, [loadSponsors]);

  const handleAddSponsor = async (formData: PartnerFormData) => {
    if (!party?.id) return;
    const data = extractSponsorData(formData);
    setIsSubmitting(true);
    try {
      await createSponsor(party.id, data);
      loadSponsors();
      setShowAddSponsor(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Load both Hub 191 fonts, then trigger re-render for accurate fitText measurements
  useEffect(() => {
    const regular = new FontFace('Hub 191', 'url(/fonts/Hub-191-Regular.otf)');
    const display = new FontFace('Hub 191 Display', 'url(/fonts/Hub-191-Display.otf)');
    Promise.all([regular.load(), display.load()])
      .then(([reg, disp]) => {
        document.fonts.add(reg);
        document.fonts.add(disp);
        setFontsLoaded(true);
      })
      .catch(err => {
        console.warn('Failed to load Hub 191 fonts:', err);
        setFontsLoaded(true); // still render with fallback
      });
  }, []);

  useEffect(() => {
    if (!previewRef.current) return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(previewRef.current);
    return () => observer.disconnect();
  }, []);

  // Persist flyer customizations to localStorage
  useEffect(() => {
    if (!storageKey) return;
    const state = { positions, poppedLogos, logoSizes, editVenueName, editStreetAddress, editCity };
    try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch {}
  }, [storageKey, positions, poppedLogos, logoSizes, editVenueName, editStreetAddress, editCity]);

  if (!party) return null;

  // Format date and time
  let timeDisplay = '';
  if (party.date && party.timezone) {
    const start = getDateTimeInTimezone(party.date, party.timezone);
    timeDisplay = start.timeStr;
    if (party.duration) {
      const endDate = new Date(new Date(party.date).getTime() + party.duration * 3600000);
      const end = getDateTimeInTimezone(endDate, party.timezone);
      timeDisplay = `${start.timeStr} - ${end.timeStr}`;
    }
  }

  const defaultVenueName = party.venueName || 'YOUR VENUE';
  const defaultAddress = party.address || '';
  const defaultCity = defaultAddress ? parseCityFromAddress(defaultAddress) : 'YOUR CITY';
  const defaultStreetAddress = defaultAddress ? defaultAddress.split(',')[0].trim() : '';

  // Use edited values if set, otherwise defaults
  const venueName = editVenueName !== null ? editVenueName : defaultVenueName;
  const streetAddress = editStreetAddress !== null ? editStreetAddress : defaultStreetAddress;
  const city = editCity !== null ? editCity : defaultCity;

  // Auto-shrink font sizes (Hub 191 Display for city, Regular for rest)
  // Use fontsLoaded to ensure measurements use the correct font
  const _fl = fontsLoaded; // reference to trigger recalc
  void _fl;
  const cityFontSize = fitText(city, 'Hub 191 Display', 64, CITY_BOX.width);
  const venueNameFontSize = fitText(venueName, 'Hub 191', 46, VENUE_BOX.width);
  const streetFontSize = streetAddress ? fitText(streetAddress, 'Hub 191', 46, VENUE_BOX.width) : 46;
  const timeFontSize = fitText(timeDisplay || '6PM - 9PM', 'Hub 191', 55, TIME_BOX.width);

  // Compute sponsor logo sizing to fit within bounding box
  const sponsorCount = Math.min(sponsors.length, 8);
  const sponsorCols = sponsorCount <= 4 ? sponsorCount : Math.ceil(sponsorCount / 2);
  const sponsorRows = sponsorCount <= 4 ? 1 : 2;
  const maxLogoWidth = sponsorCols > 0 ? (SPONSOR_BOX.width - (sponsorCols - 1) * 16) / sponsorCols : 0;
  const maxLogoHeight = sponsorRows > 0 ? (SPONSOR_BOX.height - (sponsorRows - 1) * 12) / sponsorRows : 0;
  const autoLogoSize = Math.min(maxLogoWidth / 2.5, maxLogoHeight);

  const scale = containerWidth / 1080;

  const handleDownload = async () => {
    // Use native Canvas 2D API instead of html2canvas — html2canvas mangles custom fonts.
    setDownloading(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 1080;
      canvas.height = 1080;
      const ctx = canvas.getContext('2d')!;

      // 1) Draw template image
      const templateImg = await loadImg('/gpp-flyer-2026-template.png');
      ctx.drawImage(templateImg, 0, 0, 1080, 1080);

      ctx.textBaseline = 'top';

      // 2) City name — Hub 191 Display
      ctx.fillStyle = CITY_COLOR;
      ctx.font = `${cityFontSize}px "Hub 191 Display"`;
      ctx.fillText(city.toUpperCase(), positions.city.x, positions.city.y);

      // 3) Venue name + street address — Hub 191 Regular, black
      //    x locked to city.x so venue always left-aligns with city
      const venueX = positions.city.x;
      ctx.fillStyle = '#000000';
      ctx.font = `${venueNameFontSize}px "Hub 191"`;
      ctx.fillText(venueName.toUpperCase(), venueX, positions.venue.y);
      if (streetAddress) {
        ctx.font = `${streetFontSize}px "Hub 191"`;
        ctx.fillText(streetAddress.toUpperCase(), venueX, positions.venue.y + venueNameFontSize + 4);
      }

      // 4) Time — Hub 191 Regular, white
      if (timeDisplay) {
        ctx.fillStyle = TIME_COLOR;
        ctx.font = `${timeFontSize}px "Hub 191"`;
        ctx.fillText(timeDisplay, positions.time.x, positions.time.y);
      }

      // 5) Sponsor logos — group logos in flex layout, popped logos at custom positions
      if (sponsors.length > 0) {
        const gap = 16;
        const boxX = positions.sponsors.x;
        const boxW = SPONSOR_BOX.width;
        const boxH = SPONSOR_BOX.height;

        // Separate group logos from popped-out logos
        const groupSponsors = sponsors.slice(0, 8).filter(s => !poppedLogos[s.id]);
        const poppedSponsors = sponsors.slice(0, 8).filter(s => poppedLogos[s.id]);

        // Draw group logos in flex layout
        if (groupSponsors.length > 0) {
          type LogoItem = { img: HTMLImageElement; w: number; h: number };
          const items: LogoItem[] = [];
          for (const s of groupSponsors) {
            const size = logoSizes[s.id] ?? Math.min(defaultLogoSize, autoLogoSize);
            try {
              const logoImg = await loadImg(s.logoUrl!);
              const maxW = size * 2.5;
              const maxH = size;
              const fitScale = Math.min(maxW / logoImg.width, maxH / logoImg.height);
              items.push({ img: logoImg, w: logoImg.width * fitScale, h: logoImg.height * fitScale });
            } catch {
              // Skip logos that fail to load
            }
          }

          type Row = { items: LogoItem[]; width: number; height: number };
          const rows: Row[] = [];
          let currentRow: Row = { items: [], width: 0, height: 0 };
          for (const item of items) {
            const neededW = currentRow.items.length > 0 ? currentRow.width + gap + item.w : item.w;
            if (neededW > boxW && currentRow.items.length > 0) {
              rows.push(currentRow);
              currentRow = { items: [item], width: item.w, height: item.h };
            } else {
              currentRow.items.push(item);
              currentRow.width = neededW;
              currentRow.height = Math.max(currentRow.height, item.h);
            }
          }
          if (currentRow.items.length > 0) rows.push(currentRow);

          const totalH = rows.reduce((sum, r) => sum + r.height, 0) + Math.max(0, rows.length - 1) * gap;
          let drawY = positions.sponsors.y + (boxH - totalH) / 2;

          for (const row of rows) {
            let drawX = boxX + (boxW - row.width) / 2;
            for (const item of row.items) {
              const itemY = drawY + (row.height - item.h) / 2;
              ctx.drawImage(item.img, drawX, itemY, item.w, item.h);
              drawX += item.w + gap;
            }
            drawY += row.height + gap;
          }
        }

        // Draw popped-out logos at their custom absolute positions
        for (const s of poppedSponsors) {
          const pos = poppedLogos[s.id];
          const size = logoSizes[s.id] ?? Math.min(defaultLogoSize, autoLogoSize);
          try {
            const logoImg = await loadImg(s.logoUrl!);
            const maxW = size * 2.5;
            const maxH = size;
            const fitScale = Math.min(maxW / logoImg.width, maxH / logoImg.height);
            ctx.drawImage(logoImg, pos.x, pos.y, logoImg.width * fitScale, logoImg.height * fitScale);
          } catch {
            // Skip logos that fail to load
          }
        }
      }

      // Export
      const link = document.createElement('a');
      link.download = `gpp-flyer-${party.inviteCode || 'event'}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('Failed to generate flyer:', err);
    } finally {
      setDownloading(false);
    }
  };

  const hasCustomPositions =
    Object.keys(poppedLogos).length > 0 ||
    Object.keys(logoSizes).length > 0 ||
    editVenueName !== null ||
    editStreetAddress !== null ||
    editCity !== null ||
    positions.city.x !== DEFAULT_POSITIONS.city.x ||
    positions.city.y !== DEFAULT_POSITIONS.city.y ||
    positions.time.x !== DEFAULT_POSITIONS.time.x ||
    positions.time.y !== DEFAULT_POSITIONS.time.y ||
    positions.venue.x !== DEFAULT_POSITIONS.venue.x ||
    positions.venue.y !== DEFAULT_POSITIONS.venue.y ||
    positions.sponsors.x !== DEFAULT_POSITIONS.sponsors.x ||
    positions.sponsors.y !== DEFAULT_POSITIONS.sponsors.y;

  /** Render flyer content with drag handlers for the preview. */
  const renderFlyerContent = () => {
    const getDragProps = (key: keyof FlyerPositions) => {
      const isDragging = dragging === key;
      const isHovered = hoveredElement === key;
      // Disable drag when inline-editing a text field on this element
      const isEditing = (key === 'city' && editingField === 'city') ||
        (key === 'venue' && (editingField === 'venue' || editingField === 'street'));
      return {
        onMouseDown: isEditing ? undefined : (e: React.MouseEvent) => handleMouseDown(e, key),
        onTouchStart: isEditing ? undefined : (e: React.TouchEvent) => handleTouchStart(e, key),
        onMouseEnter: () => setHoveredElement(key),
        onMouseLeave: () => setHoveredElement(null),
        style: {
          cursor: isEditing ? 'text' : isDragging ? 'grabbing' : 'grab',
          outline: isHovered && !isDragging && !isEditing ? '2px dashed rgba(255,255,255,0.5)' : 'none',
          outlineOffset: 4,
          zIndex: isDragging ? 20 : 10,
          userSelect: isEditing ? ('auto' as const) : ('none' as const),
          WebkitUserSelect: isEditing ? ('auto' as const) : ('none' as const),
        },
      };
    };

    return (
      <div
        style={{
          width: 1080,
          height: 1080,
          position: 'relative',
          fontFamily: '"Comic Sans MS", "Comic Sans", cursive',
          overflow: 'hidden',
        }}
      >
        {/* Template background */}
        <img
          src="/gpp-flyer-2026-template.png"
          alt=""
          style={{ width: '100%', height: '100%', display: 'block' }}
          crossOrigin="anonymous"
        />

        {/* City name - Hub 191 Display, prominent red text */}
        {(() => {
          const dragProps = getDragProps('city');
          return (
            <div
              onMouseDown={dragProps.onMouseDown}
              onTouchStart={dragProps.onTouchStart}
              onMouseEnter={dragProps.onMouseEnter}
              onMouseLeave={dragProps.onMouseLeave}
              onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditingField('city'); }}
              style={{
                position: 'absolute',
                top: positions.city.y,
                left: positions.city.x,
                width: CITY_BOX.width,
                height: CITY_BOX.height,
                color: CITY_COLOR,
                fontSize: cityFontSize,
                fontFamily: CITY_FONT,
                textTransform: 'uppercase',
                lineHeight: 1.2,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                ...dragProps.style,
              }}
            >
              {hoveredElement === 'city' && dragging !== 'city' && editingField !== 'city' && (
                <Move
                  size={16}
                  style={{
                    position: 'absolute',
                    top: -20,
                    left: 0,
                    color: 'rgba(255,255,255,0.7)',
                    pointerEvents: 'none',
                  }}
                />
              )}
              {editingField === 'city' ? (
                <input
                  autoFocus
                  value={city}
                  onChange={e => setEditCity(e.target.value)}
                  onBlur={() => setEditingField(null)}
                  onKeyDown={e => { if (e.key === 'Enter') setEditingField(null); }}
                  style={{
                    width: '100%',
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                    color: 'inherit',
                    fontSize: 'inherit',
                    fontFamily: 'inherit',
                    textTransform: 'inherit' as any,
                    lineHeight: 'inherit',
                    padding: 0,
                    margin: 0,
                  }}
                />
              ) : (
                city.toUpperCase()
              )}
            </div>
          );
        })()}

        {/* Venue name and street address - Hub 191 Regular */}
        {(() => {
          const dragProps = getDragProps('venue');
          return (
            <div
              onMouseDown={dragProps.onMouseDown}
              onTouchStart={dragProps.onTouchStart}
              onMouseEnter={dragProps.onMouseEnter}
              onMouseLeave={dragProps.onMouseLeave}
              style={{
                position: 'absolute',
                top: positions.venue.y,
                left: positions.city.x,
                width: VENUE_BOX.width,
                height: VENUE_BOX.height,
                color: '#000000',
                textTransform: 'uppercase',
                fontFamily: TEXT_FONT,
                overflow: 'hidden',
                ...dragProps.style,
              }}
            >
              {hoveredElement === 'venue' && dragging !== 'venue' && editingField !== 'venue' && editingField !== 'street' && (
                <Move
                  size={16}
                  style={{
                    position: 'absolute',
                    top: -20,
                    left: 0,
                    color: 'rgba(255,255,255,0.7)',
                    pointerEvents: 'none',
                  }}
                />
              )}
              <div
                onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditingField('venue'); }}
                style={{ fontSize: venueNameFontSize, lineHeight: 1, marginBottom: 4, whiteSpace: 'nowrap' }}
              >
                {editingField === 'venue' ? (
                  <input
                    autoFocus
                    value={venueName}
                    onChange={e => setEditVenueName(e.target.value)}
                    onBlur={() => setEditingField(null)}
                    onKeyDown={e => { if (e.key === 'Enter') setEditingField(null); }}
                    style={{
                      width: '100%',
                      background: 'transparent',
                      border: 'none',
                      outline: 'none',
                      color: 'inherit',
                      fontSize: 'inherit',
                      fontFamily: 'inherit',
                      textTransform: 'inherit' as any,
                      lineHeight: 'inherit',
                      padding: 0,
                      margin: 0,
                    }}
                  />
                ) : (
                  venueName.toUpperCase()
                )}
              </div>
              <div
                onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditingField('street'); }}
                style={{ fontSize: streetFontSize, lineHeight: 1, whiteSpace: 'nowrap' }}
              >
                {editingField === 'street' ? (
                  <input
                    autoFocus
                    value={streetAddress}
                    onChange={e => setEditStreetAddress(e.target.value)}
                    onBlur={() => setEditingField(null)}
                    onKeyDown={e => { if (e.key === 'Enter') setEditingField(null); }}
                    style={{
                      width: '100%',
                      background: 'transparent',
                      border: 'none',
                      outline: 'none',
                      color: 'inherit',
                      fontSize: 'inherit',
                      fontFamily: 'inherit',
                      textTransform: 'inherit' as any,
                      lineHeight: 'inherit',
                      padding: 0,
                      margin: 0,
                    }}
                  />
                ) : (
                  (streetAddress || 'STREET ADDRESS').toUpperCase()
                )}
              </div>
            </div>
          );
        })()}

        {/* Time - Hub 191 Regular, next to "MAY 22" on template */}
        {timeDisplay && (() => {
          const dragProps = getDragProps('time');
          return (
            <div
              onMouseDown={dragProps.onMouseDown}
              onTouchStart={dragProps.onTouchStart}
              onMouseEnter={dragProps.onMouseEnter}
              onMouseLeave={dragProps.onMouseLeave}
              style={{
                position: 'absolute',
                top: positions.time.y,
                left: positions.time.x,
                width: TIME_BOX.width,
                height: TIME_BOX.height,
                color: TIME_COLOR,
                fontSize: timeFontSize,
                fontFamily: TEXT_FONT,
                textTransform: 'uppercase',
                lineHeight: 1,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                ...dragProps.style,
              }}
            >
              {hoveredElement === 'time' && dragging !== 'time' && (
                <Move
                  size={16}
                  style={{
                    position: 'absolute',
                    top: -20,
                    left: 0,
                    color: 'rgba(255,255,255,0.7)',
                    pointerEvents: 'none',
                  }}
                />
              )}
              {timeDisplay}
            </div>
          );
        })()}

        {/* Sponsor logos - left-aligned in bounding box (skip popped-out logos) */}
        {sponsors.length > 0 && (() => {
          const dragProps = getDragProps('sponsors');
          const groupLogos = sponsors.slice(0, 8).filter(s => !poppedLogos[s.id]);
          return groupLogos.length > 0 ? (
            <div
              onMouseDown={dragProps.onMouseDown}
              onTouchStart={dragProps.onTouchStart}
              onMouseEnter={dragProps.onMouseEnter}
              onMouseLeave={dragProps.onMouseLeave}
              style={{
                position: 'absolute',
                top: positions.sponsors.y,
                left: positions.sponsors.x,
                width: SPONSOR_BOX.width,
                height: SPONSOR_BOX.height,
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                alignContent: 'center',
                justifyContent: 'center',
                gap: 16,
                ...dragProps.style,
              }}
            >
              {hoveredElement === 'sponsors' && dragging !== 'sponsors' && (
                <Move
                  size={16}
                  style={{
                    position: 'absolute',
                    top: -20,
                    left: 0,
                    color: 'rgba(255,255,255,0.7)',
                    pointerEvents: 'none',
                  }}
                />
              )}
              {/* Group box corner resize handle — scales all group logos together */}
              {(() => {
                const handleGroupResizeStart = (e: React.MouseEvent) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const startY = e.clientY;
                  // Capture current sizes for all group logos
                  const startSizes: Record<string, number> = {};
                  groupLogos.forEach(s => {
                    startSizes[s.id] = logoSizes[s.id] ?? Math.min(defaultLogoSize, autoLogoSize);
                  });
                  const rect = canvasRef.current?.getBoundingClientRect();
                  const sc = rect ? rect.width / 1080 : 1;
                  const handleMove = (moveEvent: MouseEvent) => {
                    const deltaY = (moveEvent.clientY - startY) / sc;
                    setLogoSizes(prev => {
                      const next = { ...prev };
                      groupLogos.forEach(s => {
                        next[s.id] = Math.round(Math.max(20, Math.min(200, startSizes[s.id] + deltaY)));
                      });
                      return next;
                    });
                  };
                  const handleUp = () => {
                    document.removeEventListener('mousemove', handleMove);
                    document.removeEventListener('mouseup', handleUp);
                  };
                  document.addEventListener('mousemove', handleMove);
                  document.addEventListener('mouseup', handleUp);
                };
                const handleGroupTouchResizeStart = (e: React.TouchEvent) => {
                  e.stopPropagation();
                  const startY = e.touches[0].clientY;
                  const startSizes: Record<string, number> = {};
                  groupLogos.forEach(s => {
                    startSizes[s.id] = logoSizes[s.id] ?? Math.min(defaultLogoSize, autoLogoSize);
                  });
                  const rect = canvasRef.current?.getBoundingClientRect();
                  const sc = rect ? rect.width / 1080 : 1;
                  const handleMove = (moveEvent: TouchEvent) => {
                    moveEvent.preventDefault();
                    const deltaY = (moveEvent.touches[0].clientY - startY) / sc;
                    setLogoSizes(prev => {
                      const next = { ...prev };
                      groupLogos.forEach(s => {
                        next[s.id] = Math.round(Math.max(20, Math.min(200, startSizes[s.id] + deltaY)));
                      });
                      return next;
                    });
                  };
                  const handleUp = () => {
                    document.removeEventListener('touchmove', handleMove);
                    document.removeEventListener('touchend', handleUp);
                  };
                  document.addEventListener('touchmove', handleMove, { passive: false });
                  document.addEventListener('touchend', handleUp);
                };
                return (
                  <div
                    onMouseDown={handleGroupResizeStart}
                    onTouchStart={handleGroupTouchResizeStart}
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      right: 0,
                      width: 18,
                      height: 18,
                      cursor: 'nwse-resize',
                      zIndex: 35,
                      background: 'linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.4) 50%)',
                      borderRadius: '0 0 4px 0',
                    }}
                  />
                );
              })()}
              {groupLogos.map(s => {
                const size = logoSizes[s.id] ?? Math.min(defaultLogoSize, autoLogoSize);
                const isSelected = selectedGroupLogo === s.id;

                const handleResizeStart = (e: React.MouseEvent) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const startY = e.clientY;
                  const startSize = size;
                  const rect = canvasRef.current?.getBoundingClientRect();
                  const sc = rect ? rect.width / 1080 : 1;
                  const handleMove = (moveEvent: MouseEvent) => {
                    const deltaY = (moveEvent.clientY - startY) / sc;
                    const newSize = Math.max(20, Math.min(200, startSize + deltaY));
                    setLogoSizes(prev => ({ ...prev, [s.id]: Math.round(newSize) }));
                  };
                  const handleUp = () => {
                    document.removeEventListener('mousemove', handleMove);
                    document.removeEventListener('mouseup', handleUp);
                  };
                  document.addEventListener('mousemove', handleMove);
                  document.addEventListener('mouseup', handleUp);
                };

                const handleTouchResizeStart = (e: React.TouchEvent) => {
                  e.stopPropagation();
                  const startY = e.touches[0].clientY;
                  const startSize = size;
                  const rect = canvasRef.current?.getBoundingClientRect();
                  const sc = rect ? rect.width / 1080 : 1;
                  const handleMove = (moveEvent: TouchEvent) => {
                    moveEvent.preventDefault();
                    const deltaY = (moveEvent.touches[0].clientY - startY) / sc;
                    const newSize = Math.max(20, Math.min(200, startSize + deltaY));
                    setLogoSizes(prev => ({ ...prev, [s.id]: Math.round(newSize) }));
                  };
                  const handleUp = () => {
                    document.removeEventListener('touchmove', handleMove);
                    document.removeEventListener('touchend', handleUp);
                  };
                  document.addEventListener('touchmove', handleMove, { passive: false });
                  document.addEventListener('touchend', handleUp);
                };

                return (
                  <div key={s.id} style={{ position: 'relative', display: 'inline-block' }}>
                    <img
                      src={s.logoUrl!}
                      alt={s.name}
                      crossOrigin="anonymous"
                      onDoubleClick={(e) => handleLogoDoubleClick(s.id, e)}
                      onMouseDown={(e) => handleGroupLogoDragStart(s.id, e)}
                      onTouchStart={(e) => handleGroupLogoTouchStart(s.id, e)}
                      style={{
                        height: size,
                        maxWidth: size * 2.5,
                        objectFit: 'contain',
                        borderRadius: 4,
                        cursor: isSelected ? 'grab' : 'pointer',
                        outline: isSelected ? '2px dashed rgba(255,100,100,0.6)' : 'none',
                        outlineOffset: isSelected ? 4 : 0,
                      }}
                    />
                    {/* Corner resize handle */}
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
                        zIndex: 35,
                        background: 'linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.5) 50%)',
                        borderRadius: '0 0 4px 0',
                      }}
                    />
                  </div>
                );
              })}
            </div>
          ) : null;
        })()}

        {/* Popped-out logos — freely positioned anywhere on the canvas */}
        {sponsors.slice(0, 8).filter(s => poppedLogos[s.id]).map(s => {
          const pos = poppedLogos[s.id];
          const size = logoSizes[s.id] ?? Math.min(defaultLogoSize, autoLogoSize);
          const isDragging = draggingLogo === s.id;

          const handlePoppedResizeStart = (e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            const startY = e.clientY;
            const startSize = size;
            const rect = canvasRef.current?.getBoundingClientRect();
            const sc = rect ? rect.width / 1080 : 1;
            const handleMove = (moveEvent: MouseEvent) => {
              const deltaY = (moveEvent.clientY - startY) / sc;
              const newSize = Math.max(20, Math.min(200, startSize + deltaY));
              setLogoSizes(prev => ({ ...prev, [s.id]: Math.round(newSize) }));
            };
            const handleUp = () => {
              document.removeEventListener('mousemove', handleMove);
              document.removeEventListener('mouseup', handleUp);
            };
            document.addEventListener('mousemove', handleMove);
            document.addEventListener('mouseup', handleUp);
          };

          const handlePoppedTouchResizeStart = (e: React.TouchEvent) => {
            e.stopPropagation();
            const startY = e.touches[0].clientY;
            const startSize = size;
            const rect = canvasRef.current?.getBoundingClientRect();
            const sc = rect ? rect.width / 1080 : 1;
            const handleMove = (moveEvent: TouchEvent) => {
              moveEvent.preventDefault();
              const deltaY = (moveEvent.touches[0].clientY - startY) / sc;
              const newSize = Math.max(20, Math.min(200, startSize + deltaY));
              setLogoSizes(prev => ({ ...prev, [s.id]: Math.round(newSize) }));
            };
            const handleUp = () => {
              document.removeEventListener('touchmove', handleMove);
              document.removeEventListener('touchend', handleUp);
            };
            document.addEventListener('touchmove', handleMove, { passive: false });
            document.addEventListener('touchend', handleUp);
          };

          return (
            <div
              key={`popped-${s.id}`}
              style={{
                position: 'absolute',
                top: pos.y,
                left: pos.x,
                zIndex: isDragging ? 30 : 25,
                userSelect: 'none',
                WebkitUserSelect: 'none',
              }}
            >
              <img
                src={s.logoUrl!}
                alt={s.name}
                crossOrigin="anonymous"
                onMouseDown={(e) => handleLogoDragStart(s.id, e)}
                onTouchStart={(e) => handleLogoDragTouchStart(s.id, e)}
                onDoubleClick={(e) => handleLogoDoubleClick(s.id, e)}
                style={{
                  height: size,
                  maxWidth: size * 2.5,
                  objectFit: 'contain',
                  borderRadius: 4,
                  cursor: isDragging ? 'grabbing' : 'grab',
                  outline: '2px dashed rgba(255,100,100,0.6)',
                  outlineOffset: 4,
                }}
              />
              {/* Corner resize handle */}
              <div
                onMouseDown={handlePoppedResizeStart}
                onTouchStart={handlePoppedTouchResizeStart}
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
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Drag hint */}
      <p className="text-center text-xs text-white/40">
        Double-click text to edit. Drag to reposition. Double-click a logo to freely move it. Drag corners to resize.
      </p>

      {/* Scaled preview */}
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
            {renderFlyerContent()}
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex justify-center gap-3">
        <button
          onClick={() => setShowAddSponsor(true)}
          className="flex items-center gap-2 px-4 py-3 rounded-lg bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors text-sm"
        >
          <Plus className="w-4 h-4" />
          Add Logo
        </button>
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="btn-primary flex items-center gap-2 px-6 py-3"
        >
          {downloading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Download className="w-5 h-5" />
              Download Flyer
            </>
          )}
        </button>
        {hasCustomPositions && (
          <button
            onClick={handleResetPositions}
            className="flex items-center gap-2 px-4 py-3 rounded-lg bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors text-sm"
            title="Reset element positions to defaults"
          >
            <RotateCcw className="w-4 h-4" />
            Reset Positions
          </button>
        )}
      </div>

      {showAddSponsor && (
        <PartnerForm
          onSubmit={handleAddSponsor}
          onClose={() => setShowAddSponsor(false)}
          isLoading={isSubmitting}
          defaultStatus="yes"
        />
      )}
    </div>
  );
}
