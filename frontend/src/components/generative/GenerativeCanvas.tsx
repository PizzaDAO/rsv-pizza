import React, { useRef, useState, useEffect, useCallback } from 'react';
import { usePizza } from '../../contexts/PizzaContext';
import { getSponsors, createSponsor, updateSponsor, reorderSponsors } from '../../lib/api';
import { getDateTimeInTimezone } from '../../utils/dateUtils';
import { Sponsor } from '../../types';
import { Download, Loader2, RotateCcw, Move, Plus, ChevronLeft, ChevronRight, Pencil } from 'lucide-react';
import { PartnerForm, extractSponsorData } from '../sponsors/PartnerForm';
import type { PartnerFormData } from '../sponsors/PartnerForm';
import { cdnUrl } from '../../lib/supabase';
import {
  fitText, loadImg, uses12Hour, formatFlyerTime,
  CITY_COLOR, TIME_COLOR,
} from '../flyer/renderFlyer';
import { useCanvasDrag } from './useCanvasDrag';
import { renderCanvas } from './renderCanvas';
import type { FormatConfig, CanvasPositions } from './types';

function parseCityFromAddress(address: string): string {
  const parts = address.split(',').map(p => p.trim());
  if (parts.length >= 3) return parts[parts.length - 3] || parts[1];
  if (parts.length >= 2) return parts[1];
  return parts[0];
}

const SPONSOR_BOX_MIN = 100;

function buildDefaultPositions(config: FormatConfig): CanvasPositions {
  const positions: CanvasPositions = {};
  for (const field of config.textFields) {
    positions[field.key] = { x: field.defaultX, y: field.defaultY };
  }
  positions.sponsors = { x: config.sponsorBox.defaultX, y: config.sponsorBox.defaultY };
  return positions;
}

interface GenerativeCanvasProps {
  config: FormatConfig;
}

export function GenerativeCanvas({ config }: GenerativeCanvasProps) {
  const { party } = usePizza();
  const previewRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadingHiRes, setDownloadingHiRes] = useState(false);
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [containerWidth, setContainerWidth] = useState(config.previewMaxWidth);
  const [hoveredElement, setHoveredElement] = useState<string | null>(null);

  // Load saved customizations from localStorage
  const storageKey = party ? config.storageKey(party.id) : null;
  const savedState = React.useMemo(() => {
    if (!storageKey) return null;
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }, [storageKey]);

  const defaultPositions = React.useMemo(() => buildDefaultPositions(config), [config]);
  const defaultSponsorBox = React.useMemo(() => ({ width: config.sponsorBox.width, height: config.sponsorBox.height }), [config]);

  const [editVenueName, setEditVenueName] = useState<string | null>(savedState?.editVenueName ?? null);
  const [editStreetAddress, setEditStreetAddress] = useState<string | null>(savedState?.editStreetAddress ?? null);
  const [editCity, setEditCity] = useState<string | null>(savedState?.editCity ?? null);
  const [editTime, setEditTime] = useState<string | null>(savedState?.editTime ?? null);
  const [logoSizes, setLogoSizes] = useState<Record<string, number>>(savedState?.logoSizes || {});
  const defaultLogoSize = 80;
  const [showAddSponsor, setShowAddSponsor] = useState(false);
  const [editingSponsor, setEditingSponsor] = useState<Sponsor | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fontsLoaded, setFontsLoaded] = useState(false);

  // Popped-out logos
  const [poppedLogos, setPoppedLogos] = useState<Record<string, { x: number; y: number }>>(
    () => savedState?.poppedLogos || {}
  );
  const [draggingLogo, setDraggingLogo] = useState<string | null>(null);
  const logoOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [selectedGroupLogo, setSelectedGroupLogo] = useState<string | null>(null);
  const [hoveredLogoId, setHoveredLogoId] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<'city' | 'venue' | 'street' | 'time' | null>(null);

  // Positions and sponsor box
  const [positions, setPositions] = useState<CanvasPositions>(
    () => savedState?.positions || { ...defaultPositions }
  );
  const [sponsorBoxSize, setSponsorBoxSize] = useState<{ width: number; height: number }>(
    () => savedState?.sponsorBoxSize || { ...defaultSponsorBox }
  );

  // Cached full-res template
  const fullResImgRef = useRef<HTMLImageElement | null>(null);

  const handlePositionChange = useCallback((key: string, pos: { x: number; y: number }) => {
    setPositions(prev => {
      if (key === 'venue') {
        return { ...prev, venue: { x: prev.city.x, y: pos.y } };
      }
      return { ...prev, [key]: pos };
    });
  }, []);

  const { dragging, clientToCanvas, handleMouseDown, handleTouchStart } = useCanvasDrag({
    canvasRef,
    config,
    positions,
    onPositionChange: handlePositionChange,
  });

  const handleResetPositions = useCallback(() => {
    setPositions({ ...defaultPositions });
    setPoppedLogos({});
    setSelectedGroupLogo(null);
    setLogoSizes({});
    setSponsorBoxSize({ ...defaultSponsorBox });
    setEditVenueName(null);
    setEditStreetAddress(null);
    setEditCity(null);
    setEditTime(null);
    if (storageKey) {
      try { localStorage.removeItem(storageKey); } catch {}
    }
  }, [storageKey, defaultPositions, defaultSponsorBox]);

  // Logo interaction handlers — same pattern as FlyerGenerator

  const handleLogoDoubleClick = useCallback((sponsorId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (poppedLogos[sponsorId]) {
      setPoppedLogos(prev => {
        const next = { ...prev };
        delete next[sponsorId];
        return next;
      });
      return;
    }
    setSelectedGroupLogo(prev => prev === sponsorId ? null : sponsorId);
  }, [poppedLogos]);

  const handleGroupLogoDragStart = useCallback((sponsorId: string, e: React.MouseEvent) => {
    if (selectedGroupLogo !== sponsorId) return;
    e.preventDefault();
    e.stopPropagation();

    const startPos = clientToCanvas(e.clientX, e.clientY);
    if (!startPos) return;
    let hasMoved = false;

    const handleMove = (moveEvent: MouseEvent) => {
      const p = clientToCanvas(moveEvent.clientX, moveEvent.clientY);
      if (!p) return;
      if (!hasMoved) {
        hasMoved = true;
        setDraggingLogo(sponsorId);
        logoOffsetRef.current = { x: 40, y: 40 };
        setPoppedLogos(prev => ({ ...prev, [sponsorId]: { x: p.x - 40, y: p.y - 40 } }));
        setSelectedGroupLogo(null);
      }
      const nx = Math.max(0, Math.min(config.canvasWidth, p.x - logoOffsetRef.current.x));
      const ny = Math.max(0, Math.min(config.canvasHeight, p.y - logoOffsetRef.current.y));
      setPoppedLogos(prev => ({ ...prev, [sponsorId]: { x: nx, y: ny } }));
    };
    const handleUp = () => {
      setDraggingLogo(null);
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [selectedGroupLogo, clientToCanvas, config.canvasWidth, config.canvasHeight]);

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
      const nx = Math.max(0, Math.min(config.canvasWidth, p.x - logoOffsetRef.current.x));
      const ny = Math.max(0, Math.min(config.canvasHeight, p.y - logoOffsetRef.current.y));
      setPoppedLogos(prev => ({ ...prev, [sponsorId]: { x: nx, y: ny } }));
    };
    const handleUp = () => {
      setDraggingLogo(null);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleUp);
    };
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleUp);
  }, [selectedGroupLogo, clientToCanvas, config.canvasWidth, config.canvasHeight]);

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
      const nx = Math.max(0, Math.min(config.canvasWidth, p.x - logoOffsetRef.current.x));
      const ny = Math.max(0, Math.min(config.canvasHeight, p.y - logoOffsetRef.current.y));
      setPoppedLogos(prev => ({ ...prev, [sponsorId]: { x: nx, y: ny } }));
    };
    const handleUp = () => {
      setDraggingLogo(null);
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [clientToCanvas, poppedLogos, config.canvasWidth, config.canvasHeight]);

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
      const nx = Math.max(0, Math.min(config.canvasWidth, p.x - logoOffsetRef.current.x));
      const ny = Math.max(0, Math.min(config.canvasHeight, p.y - logoOffsetRef.current.y));
      setPoppedLogos(prev => ({ ...prev, [sponsorId]: { x: nx, y: ny } }));
    };
    const handleUp = () => {
      setDraggingLogo(null);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleUp);
    };
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleUp);
  }, [clientToCanvas, poppedLogos, config.canvasWidth, config.canvasHeight]);

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

  const handleReorderLogo = useCallback(async (sponsorId: string, direction: -1 | 1, groupLogos: Sponsor[]) => {
    if (!party?.id) return;
    const groupIdx = groupLogos.findIndex(s => s.id === sponsorId);
    if (groupIdx < 0) return;
    const neighborIdx = groupIdx + direction;
    if (neighborIdx < 0 || neighborIdx >= groupLogos.length) return;

    const neighborId = groupLogos[neighborIdx].id;
    const prev = sponsors;
    const swapped = [...sponsors];
    const fullIdxA = swapped.findIndex(s => s.id === sponsorId);
    const fullIdxB = swapped.findIndex(s => s.id === neighborId);
    if (fullIdxA < 0 || fullIdxB < 0) return;
    [swapped[fullIdxA], swapped[fullIdxB]] = [swapped[fullIdxB], swapped[fullIdxA]];

    setSponsors(swapped);
    try {
      await reorderSponsors(party.id, swapped.map(s => s.id));
    } catch (err) {
      console.error('Failed to reorder sponsors:', err);
      setSponsors(prev);
    }
  }, [party?.id, sponsors]);

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

  const handleEditSponsor = async (formData: PartnerFormData) => {
    if (!party?.id || !editingSponsor) return;
    const data = extractSponsorData(formData);
    setIsSubmitting(true);
    try {
      await updateSponsor(party.id, editingSponsor.id, data);
      const result = await getSponsors(party.id);
      if (result?.sponsors) {
        setSponsors(result.sponsors.filter(s => s.logoUrl && (s.status === 'yes' || s.status === 'paid')));
      }
      setEditingSponsor(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Load fonts
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
        setFontsLoaded(true);
      });
  }, []);

  // Container width observer
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

  // Persist to localStorage
  useEffect(() => {
    if (!storageKey) return;
    const state = { positions, poppedLogos, logoSizes, sponsorBoxSize, editVenueName, editStreetAddress, editCity, editTime };
    try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch {}
  }, [storageKey, positions, poppedLogos, logoSizes, sponsorBoxSize, editVenueName, editStreetAddress, editCity, editTime]);

  if (!party) return null;

  // Format date and time
  let timeDisplay = '';
  let dateDisplay = 'MAY 22';
  if (party.date && party.timezone) {
    const is12h = uses12Hour(party.timezone);
    const start = getDateTimeInTimezone(party.date, party.timezone);
    const startFormatted = formatFlyerTime(start.timeStr, is12h);
    timeDisplay = startFormatted;
    if (party.duration) {
      const endDate = new Date(new Date(party.date).getTime() + party.duration * 3600000);
      const end = getDateTimeInTimezone(endDate, party.timezone);
      const endFormatted = formatFlyerTime(end.timeStr, is12h);
      timeDisplay = `${startFormatted} - ${endFormatted}`;
    }
    const eventDate = new Date(party.date);
    const monthFormatter = new Intl.DateTimeFormat('en-US', { timeZone: party.timezone, month: 'short' });
    const dayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: party.timezone, day: 'numeric' });
    dateDisplay = `${monthFormatter.format(eventDate).toUpperCase()} ${dayFormatter.format(eventDate)}`;
  }

  const defaultVenueName = party.venueName || 'YOUR VENUE';
  const defaultAddress = party.address || '';
  const cityFromTitle = party.name?.replace(/^Global Pizza Party\s*/i, '').trim();
  const defaultCity = cityFromTitle || (defaultAddress ? parseCityFromAddress(defaultAddress) : 'YOUR CITY');
  const defaultStreetAddress = defaultAddress ? defaultAddress.split(',')[0].trim() : '';

  const venueName = editVenueName !== null ? editVenueName : defaultVenueName;
  const streetAddress = editStreetAddress !== null ? editStreetAddress : defaultStreetAddress;
  const city = editCity !== null ? editCity : defaultCity;

  // Get text field configs
  const cityField = config.textFields.find(f => f.key === 'city')!;
  const timeField = config.textFields.find(f => f.key === 'time')!;
  const venueField = config.textFields.find(f => f.key === 'venue')!;

  // Font sizing
  const _fl = fontsLoaded;
  void _fl;
  const cityFontSize = fitText(city, 'Hub 191 Display', cityField.maxFontSize, cityField.boxWidth);
  const venueNameFontSize = fitText(venueName, 'Hub 191', venueField.maxFontSize, venueField.boxWidth);
  const streetFontSize = streetAddress ? fitText(streetAddress, 'Hub 191', venueField.maxFontSize, venueField.boxWidth) : venueField.maxFontSize;
  const effectiveTimeDisplay = editTime !== null ? editTime : timeDisplay;
  const timeForDisplay = editTime === '' ? '' : (effectiveTimeDisplay || '6PM - 9PM');
  const fullTimeDisplay = timeForDisplay ? `${dateDisplay}  ${timeForDisplay}` : dateDisplay;
  const timeFontSize = fitText(fullTimeDisplay, 'Hub 191', timeField.maxFontSize, timeField.boxWidth);

  // Sponsor sizing
  const sponsorCount = sponsors.length;
  const targetRows = config.sponsorBox.defaultRows ?? (sponsorCount <= 4 ? 1 : 2);
  const sponsorRows = Math.max(1, Math.min(targetRows, Math.ceil(sponsorCount / 2)));
  const sponsorCols = Math.max(1, Math.ceil(sponsorCount / sponsorRows));
  const maxLogoWidth = sponsorCols > 0 ? (sponsorBoxSize.width - (sponsorCols - 1) * 16) / sponsorCols : 0;
  const maxLogoHeight = sponsorRows > 0 ? (sponsorBoxSize.height - (sponsorRows - 1) * 12) / sponsorRows : 0;
  const autoLogoSize = Math.min(maxLogoWidth / 2.5, maxLogoHeight);

  const scale = containerWidth / config.canvasWidth;
  const aspectRatio = config.canvasHeight / config.canvasWidth;

  // Render to canvas (editor resolution)
  const renderToCanvas = async (): Promise<HTMLCanvasElement> => {
    return renderCanvas({
      config,
      positions,
      textValues: { city, dateDisplay, timeDisplay: effectiveTimeDisplay, venueName, streetAddress },
      sponsors: sponsors.map(s => ({ id: s.id, logoUrl: s.logoUrl! })),
      sponsorBoxSize,
      logoSizes,
      poppedLogos,
    });
  };

  // Render to canvas at full resolution
  const renderFullRes = async (): Promise<HTMLCanvasElement> => {
    const scaleFactor = config.fullResWidth / config.canvasWidth;

    // On mobile, cap to avoid canvas memory issues
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const maxWidth = isMobile ? 4000 : config.fullResWidth;
    const effectiveScale = Math.min(scaleFactor, maxWidth / config.canvasWidth);

    // Pre-fetch the full-res template if not cached
    if (!fullResImgRef.current) {
      setDownloadingHiRes(true);
      try {
        const img = await loadImg(config.fullResUrl);
        fullResImgRef.current = img;
      } finally {
        setDownloadingHiRes(false);
      }
    }

    return renderCanvas({
      config,
      positions,
      textValues: { city, dateDisplay, timeDisplay: effectiveTimeDisplay, venueName, streetAddress },
      sponsors: sponsors.map(s => ({ id: s.id, logoUrl: s.logoUrl! })),
      sponsorBoxSize,
      logoSizes,
      poppedLogos,
      scaleFactor: effectiveScale,
    });
  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const canvas = await renderFullRes();
      const link = document.createElement('a');
      link.download = `gpp-${config.id}-${party.inviteCode || 'event'}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error(`Failed to generate ${config.id}:`, err);
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
    Object.keys(defaultPositions).some(key =>
      positions[key]?.x !== defaultPositions[key]?.x ||
      positions[key]?.y !== defaultPositions[key]?.y
    ) ||
    sponsorBoxSize.width !== defaultSponsorBox.width ||
    sponsorBoxSize.height !== defaultSponsorBox.height;

  /** Build drag props for an element key */
  const handleColor = config.handleColor || 'rgba(255,255,255,0.5)';
  // City is normally locked (poster layout keeps it aligned with date/venue),
  // but unlock it when all other text fields are hidden — e.g. on the
  // rollup banner where city is the only text overlay.
  const cityIsOnlyVisibleField = config.textFields.every(
    f => f.key === 'city' || f.hidden,
  );
  const getDragProps = (key: string) => {
    const isLocked =
      (key === 'city' && !cityIsOnlyVisibleField) || key === 'venue' || key === 'time';
    const isDragging = dragging === key;
    const isHovered = hoveredElement === key;
    const isEditing = (key === 'city' && editingField === 'city') ||
      (key === 'venue' && (editingField === 'venue' || editingField === 'street'));
    return {
      onMouseDown: isEditing || isLocked ? undefined : (e: React.MouseEvent) => handleMouseDown(e, key),
      onTouchStart: isEditing || isLocked ? undefined : (e: React.TouchEvent) => handleTouchStart(e, key),
      onMouseEnter: () => setHoveredElement(key),
      onMouseLeave: () => setHoveredElement(null),
      style: {
        cursor: isEditing ? 'text' : isLocked ? 'default' : isDragging ? 'grabbing' : 'grab',
        outline: isHovered && !isDragging && !isEditing && !isLocked ? `2px dashed ${handleColor}` : 'none',
        outlineOffset: 4,
        zIndex: isDragging ? 20 : 10,
        userSelect: isEditing ? ('auto' as const) : ('none' as const),
        WebkitUserSelect: isEditing ? ('auto' as const) : ('none' as const),
      },
    };
  };

  const renderContent = () => {
    return (
      <div
        style={{
          width: config.canvasWidth,
          height: config.canvasHeight,
          position: 'relative',
          fontFamily: '"Comic Sans MS", "Comic Sans", cursive',
          overflow: 'hidden',
        }}
      >
        {/* Template background */}
        <img
          src={config.templatePath}
          alt=""
          style={{ width: '100%', height: '100%', display: 'block' }}
          crossOrigin="anonymous"
        />

        {/* City name */}
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
                width: cityField.boxWidth,
                height: cityField.boxHeight,
                color: cityField.color,
                fontSize: cityFontSize,
                fontFamily: cityField.fontFamily,
                textTransform: 'uppercase',
                lineHeight: 1.2,
                whiteSpace: 'nowrap',
                ...dragProps.style,
              }}
            >
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
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, position: 'relative', paddingRight: 50 }}>
                  {city.toUpperCase()}
                  <Pencil
                    size={44}
                    style={{ cursor: 'pointer', opacity: 0.6, flexShrink: 0, position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)' }}
                    onClick={(e) => { e.stopPropagation(); setEditingField('city'); }}
                  />
                </span>
              )}
            </div>
          );
        })()}

        {/* Venue name and street address */}
        {!venueField.hidden && (() => {
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
                width: venueField.boxWidth,
                height: venueField.boxHeight,
                color: venueField.color,
                textTransform: 'uppercase',
                fontFamily: venueField.fontFamily,
                ...dragProps.style,
              }}
            >
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
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, position: 'relative', paddingRight: 40 }}>
                    {venueName.toUpperCase()}
                    <Pencil
                      size={36}
                      style={{ cursor: 'pointer', opacity: 0.6, flexShrink: 0, position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)' }}
                      onClick={(e) => { e.stopPropagation(); setEditingField('venue'); }}
                    />
                  </span>
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
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, position: 'relative', paddingRight: 40 }}>
                    {(streetAddress || 'STREET ADDRESS').toUpperCase()}
                    <Pencil
                      size={36}
                      style={{ cursor: 'pointer', opacity: 0.6, flexShrink: 0, position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)' }}
                      onClick={(e) => { e.stopPropagation(); setEditingField('street'); }}
                    />
                  </span>
                )}
              </div>
            </div>
          );
        })()}

        {/* Date + Time */}
        {!timeField.hidden && (() => {
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
                width: timeField.boxWidth,
                height: timeField.boxHeight,
                fontSize: timeFontSize,
                fontFamily: timeField.fontFamily,
                textTransform: 'uppercase',
                lineHeight: 1,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                ...dragProps.style,
              }}
            >
              <span style={{ color: CITY_COLOR }}>{dateDisplay}</span>
              {editingField === 'time' ? (
                <input
                  autoFocus
                  defaultValue={effectiveTimeDisplay || ''}
                  onBlur={(e) => {
                    const val = e.target.value.trim();
                    setEditTime(val);
                    setEditingField(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setEditingField(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  style={{
                    marginLeft: '0.4em',
                    color: TIME_COLOR,
                    background: 'rgba(0,0,0,0.5)',
                    border: '1px solid rgba(255,255,255,0.3)',
                    borderRadius: 4,
                    outline: 'none',
                    fontFamily: timeField.fontFamily,
                    fontSize: 'inherit',
                    textTransform: 'uppercase',
                    width: '60%',
                    padding: '0 4px',
                  }}
                />
              ) : (
                <span
                  style={{ marginLeft: timeForDisplay ? '0.4em' : 0, color: TIME_COLOR, cursor: 'text' }}
                  onClick={(e) => { e.stopPropagation(); setEditingField('time'); }}
                >
                  {timeForDisplay}
                  {hoveredElement === 'time' && !dragging && (
                    <Pencil size={36} style={{ marginLeft: 4, display: 'inline', verticalAlign: 'middle', opacity: 0.6 }} />
                  )}
                </span>
              )}
            </div>
          );
        })()}

        {/* Sponsor logos - group */}
        {sponsors.length > 0 && (() => {
          const dragProps = getDragProps('sponsors');
          const groupLogos = sponsors.filter(s => !poppedLogos[s.id]);
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
                width: sponsorBoxSize.width,
                height: sponsorBoxSize.height,
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
                    color: handleColor,
                    pointerEvents: 'none',
                  }}
                />
              )}
              {/* Sponsor box resize handle - corner */}
              {(() => {
                const handleBoxResizeStart = (e: React.MouseEvent) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const startX = e.clientX;
                  const startY = e.clientY;
                  const startW = sponsorBoxSize.width;
                  const startH = sponsorBoxSize.height;
                  const rect = canvasRef.current?.getBoundingClientRect();
                  const sc = rect ? rect.width / config.canvasWidth : 1;
                  const handleMove = (moveEvent: MouseEvent) => {
                    const deltaX = (moveEvent.clientX - startX) / sc;
                    const deltaY = (moveEvent.clientY - startY) / sc;
                    setSponsorBoxSize({
                      width: Math.round(Math.max(SPONSOR_BOX_MIN, Math.min(config.canvasWidth, startW + deltaX))),
                      height: Math.round(Math.max(SPONSOR_BOX_MIN, Math.min(config.canvasHeight, startH + deltaY))),
                    });
                  };
                  const handleUp = () => {
                    document.removeEventListener('mousemove', handleMove);
                    document.removeEventListener('mouseup', handleUp);
                  };
                  document.addEventListener('mousemove', handleMove);
                  document.addEventListener('mouseup', handleUp);
                };
                const handleBoxTouchResizeStart = (e: React.TouchEvent) => {
                  e.stopPropagation();
                  const startX = e.touches[0].clientX;
                  const startY = e.touches[0].clientY;
                  const startW = sponsorBoxSize.width;
                  const startH = sponsorBoxSize.height;
                  const rect = canvasRef.current?.getBoundingClientRect();
                  const sc = rect ? rect.width / config.canvasWidth : 1;
                  const handleMove = (moveEvent: TouchEvent) => {
                    moveEvent.preventDefault();
                    const deltaX = (moveEvent.touches[0].clientX - startX) / sc;
                    const deltaY = (moveEvent.touches[0].clientY - startY) / sc;
                    setSponsorBoxSize({
                      width: Math.round(Math.max(SPONSOR_BOX_MIN, Math.min(config.canvasWidth, startW + deltaX))),
                      height: Math.round(Math.max(SPONSOR_BOX_MIN, Math.min(config.canvasHeight, startH + deltaY))),
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
                    onMouseDown={handleBoxResizeStart}
                    onTouchStart={handleBoxTouchResizeStart}
                    title="Drag to resize sponsor area"
                    style={{
                      position: 'absolute',
                      bottom: -4,
                      right: -4,
                      width: 14,
                      height: 14,
                      cursor: 'nwse-resize',
                      zIndex: 36,
                      background: handleColor,
                      border: `1.5px solid ${handleColor}`,
                      borderRadius: 2,
                    }}
                  />
                );
              })()}
              {/* Right edge resize */}
              {(() => {
                const handleRightEdgeStart = (e: React.MouseEvent) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const startX = e.clientX;
                  const startW = sponsorBoxSize.width;
                  const rect = canvasRef.current?.getBoundingClientRect();
                  const sc = rect ? rect.width / config.canvasWidth : 1;
                  const handleMove = (moveEvent: MouseEvent) => {
                    const deltaX = (moveEvent.clientX - startX) / sc;
                    setSponsorBoxSize(prev => ({
                      ...prev,
                      width: Math.round(Math.max(SPONSOR_BOX_MIN, Math.min(config.canvasWidth, startW + deltaX))),
                    }));
                  };
                  const handleUp = () => {
                    document.removeEventListener('mousemove', handleMove);
                    document.removeEventListener('mouseup', handleUp);
                  };
                  document.addEventListener('mousemove', handleMove);
                  document.addEventListener('mouseup', handleUp);
                };
                return (
                  <div
                    onMouseDown={handleRightEdgeStart}
                    style={{
                      position: 'absolute',
                      top: '50%',
                      right: -4,
                      width: 6,
                      height: 28,
                      transform: 'translateY(-50%)',
                      cursor: 'ew-resize',
                      zIndex: 36,
                      background: handleColor,
                      borderRadius: 3,
                    }}
                  />
                );
              })()}
              {/* Bottom edge resize */}
              {(() => {
                const handleBottomEdgeStart = (e: React.MouseEvent) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const startY = e.clientY;
                  const startH = sponsorBoxSize.height;
                  const rect = canvasRef.current?.getBoundingClientRect();
                  const sc = rect ? rect.width / config.canvasWidth : 1;
                  const handleMove = (moveEvent: MouseEvent) => {
                    const deltaY = (moveEvent.clientY - startY) / sc;
                    setSponsorBoxSize(prev => ({
                      ...prev,
                      height: Math.round(Math.max(SPONSOR_BOX_MIN, Math.min(config.canvasHeight, startH + deltaY))),
                    }));
                  };
                  const handleUp = () => {
                    document.removeEventListener('mousemove', handleMove);
                    document.removeEventListener('mouseup', handleUp);
                  };
                  document.addEventListener('mousemove', handleMove);
                  document.addEventListener('mouseup', handleUp);
                };
                return (
                  <div
                    onMouseDown={handleBottomEdgeStart}
                    style={{
                      position: 'absolute',
                      bottom: -4,
                      left: '50%',
                      width: 28,
                      height: 6,
                      transform: 'translateX(-50%)',
                      cursor: 'ns-resize',
                      zIndex: 36,
                      background: handleColor,
                      borderRadius: 3,
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
                  const sc = rect ? rect.width / config.canvasWidth : 1;
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
                  const sc = rect ? rect.width / config.canvasWidth : 1;
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

                const groupIdx = groupLogos.findIndex(g => g.id === s.id);
                const canMoveLeft = groupIdx > 0;
                const canMoveRight = groupIdx < groupLogos.length - 1;
                const showArrows = hoveredLogoId === s.id && groupLogos.length > 1;

                return (
                  <div
                    key={s.id}
                    onMouseEnter={() => setHoveredLogoId(s.id)}
                    onMouseLeave={() => setHoveredLogoId(prev => (prev === s.id ? null : prev))}
                    style={{ position: 'relative', display: 'inline-block' }}
                  >
                    <img
                      src={cdnUrl(s.logoUrl!)}
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
                    {showArrows && (
                      <div
                        style={{
                          position: 'absolute',
                          top: -12,
                          left: '50%',
                          transform: 'translateX(-50%)',
                          display: 'flex',
                          gap: 4,
                          zIndex: 40,
                        }}
                      >
                        <button
                          type="button"
                          disabled={!canMoveLeft}
                          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (!canMoveLeft) return;
                            handleReorderLogo(s.id, -1, groupLogos);
                          }}
                          style={{
                            width: 22, height: 22, padding: 0, borderRadius: '50%',
                            border: 'none', background: 'rgba(0,0,0,0.75)',
                            color: canMoveLeft ? '#fff' : 'rgba(255,255,255,0.3)',
                            cursor: canMoveLeft ? 'pointer' : 'not-allowed',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}
                          aria-label="Move logo left"
                        >
                          <ChevronLeft size={14} />
                        </button>
                        <button
                          type="button"
                          disabled={!canMoveRight}
                          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (!canMoveRight) return;
                            handleReorderLogo(s.id, 1, groupLogos);
                          }}
                          style={{
                            width: 22, height: 22, padding: 0, borderRadius: '50%',
                            border: 'none', background: 'rgba(0,0,0,0.75)',
                            color: canMoveRight ? '#fff' : 'rgba(255,255,255,0.3)',
                            cursor: canMoveRight ? 'pointer' : 'not-allowed',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}
                          aria-label="Move logo right"
                        >
                          <ChevronRight size={14} />
                        </button>
                      </div>
                    )}
                    {hoveredLogoId === s.id && (
                      <button
                        type="button"
                        onMouseDown={e => { e.preventDefault(); e.stopPropagation(); }}
                        onClick={e => { e.preventDefault(); e.stopPropagation(); setEditingSponsor(s); }}
                        style={{
                          position: 'absolute', top: -12, right: -4,
                          width: 22, height: 22, padding: 0, borderRadius: '50%',
                          border: 'none', background: 'rgba(0,0,0,0.75)', color: '#fff',
                          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          zIndex: 40,
                        }}
                        aria-label="Edit partner"
                      >
                        <Pencil size={12} />
                      </button>
                    )}
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
                        background: `linear-gradient(135deg, transparent 50%, ${handleColor} 50%)`,
                        borderRadius: '0 0 4px 0',
                      }}
                    />
                  </div>
                );
              })}
            </div>
          ) : null;
        })()}

        {/* Popped-out logos */}
        {sponsors.filter(s => poppedLogos[s.id]).map(s => {
          const pos = poppedLogos[s.id];
          const size = logoSizes[s.id] ?? Math.min(defaultLogoSize, autoLogoSize);
          const isDragging = draggingLogo === s.id;

          const handlePoppedResizeStart = (e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            const startY = e.clientY;
            const startSize = size;
            const rect = canvasRef.current?.getBoundingClientRect();
            const sc = rect ? rect.width / config.canvasWidth : 1;
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
            const sc = rect ? rect.width / config.canvasWidth : 1;
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
              onMouseEnter={() => setHoveredLogoId(s.id)}
              onMouseLeave={() => setHoveredLogoId(prev => (prev === s.id ? null : prev))}
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
                src={cdnUrl(s.logoUrl!)}
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
              {hoveredLogoId === s.id && (
                <button
                  type="button"
                  onMouseDown={e => { e.preventDefault(); e.stopPropagation(); }}
                  onClick={e => { e.preventDefault(); e.stopPropagation(); setEditingSponsor(s); }}
                  style={{
                    position: 'absolute', top: -12, right: -4,
                    width: 22, height: 22, padding: 0, borderRadius: '50%',
                    border: 'none', background: 'rgba(0,0,0,0.75)', color: '#fff',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    zIndex: 40,
                  }}
                  aria-label="Edit partner"
                >
                  <Pencil size={12} />
                </button>
              )}
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
                  background: `linear-gradient(135deg, transparent 50%, ${handleColor} 50%)`,
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
      <div className="relative mx-auto" style={{ maxWidth: config.previewMaxWidth, ...(config.previewMaxHeight ? { maxHeight: config.previewMaxHeight, overflowY: 'auto' as const } : {}) }}>
        <div
          ref={previewRef}
          style={{
            width: '100%',
            paddingBottom: `${aspectRatio * 100}%`,
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
              width: config.canvasWidth,
              height: config.canvasHeight,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
            }}
          >
            {renderContent()}
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap justify-center gap-3">
        <button
          onClick={() => setShowAddSponsor(true)}
          className="flex items-center gap-2 px-4 py-3 rounded-lg bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors text-sm"
        >
          <Plus className="w-4 h-4" />
          Add Logo
        </button>
        <button
          onClick={handleDownload}
          disabled={downloading || downloadingHiRes}
          className="btn-primary flex items-center gap-2 px-6 py-3"
        >
          {downloading || downloadingHiRes ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              {downloadingHiRes ? 'Downloading hi-res template...' : 'Generating...'}
            </>
          ) : (
            <>
              <Download className="w-5 h-5" />
              Download
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
            Reset
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
      {editingSponsor && (
        <PartnerForm
          sponsor={editingSponsor}
          onSubmit={handleEditSponsor}
          onClose={() => setEditingSponsor(null)}
          isLoading={isSubmitting}
          logoOnly
        />
      )}
    </div>
  );
}
