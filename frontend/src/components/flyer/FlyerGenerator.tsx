import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { usePizza } from '../../contexts/PizzaContext';
import { getSponsors, createSponsor, updateSponsor, reorderSponsors } from '../../lib/api';
import { getDateTimeInTimezone } from '../../utils/dateUtils';
import { Sponsor } from '../../types';
import { Download, Loader2, RotateCcw, Move, Plus, ChevronLeft, ChevronRight, ImagePlus, Check, Pencil } from 'lucide-react';
import { useFlyerDrag, DEFAULT_POSITIONS, FlyerPositions } from './useFlyerDrag';
import { PartnerForm, extractSponsorData } from '../sponsors/PartnerForm';
import type { PartnerFormData } from '../sponsors/PartnerForm';
import { uploadEventImage, updateParty, cdnUrl } from '../../lib/supabase';
import {
  fitText, loadImg, uses12Hour, formatFlyerTime, getTemplateUrl,
  CITY_FONT, TEXT_FONT, CITY_COLOR, TIME_COLOR, VENUE_COLOR,
  CITY_BOX, VENUE_BOX, TIME_BOX, DEFAULT_SPONSOR_BOX,
} from './renderFlyer';
import { cancelFlyerRegen } from './autoRegenFlyer';

function parseCityFromAddress(address: string): string {
  const parts = address.split(',').map(p => p.trim());
  if (parts.length >= 3) return parts[parts.length - 3] || parts[1];
  if (parts.length >= 2) return parts[1];
  return parts[0];
}

/** Min/max sponsor box dimensions in 1080px canvas units. */
const SPONSOR_BOX_MIN = 100;
const SPONSOR_BOX_MAX = 1080;

export function FlyerGenerator({ sponsorLogoOnly }: { sponsorLogoOnly?: boolean } = {}) {
  const { t } = useTranslation('host');
  const { party, loadParty } = usePizza();
  const previewRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [setImageState, setSetImageState] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [containerWidth, setContainerWidth] = useState(500);
  const [hoveredElement, setHoveredElement] = useState<keyof FlyerPositions | null>(null);

  // Load saved customizations: prefer DB (party.flyerConfig) over localStorage
  // NOTE: Must be declared before any useState that references savedState
  const storageKey = party ? `flyer-${party.id}` : null;
  const savedState = React.useMemo(() => {
    // Prefer DB config if available
    if (party?.flyerConfig) return party.flyerConfig as Record<string, any>;
    // Fall back to localStorage
    if (!storageKey) return null;
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }, [storageKey, party?.flyerConfig]);

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

  // Popped-out logos: keyed by sponsor ID, value is absolute position on 1080px canvas
  const [poppedLogos, setPoppedLogos] = useState<Record<string, { x: number; y: number }>>(
    () => savedState?.poppedLogos || {}
  );
  const [draggingLogo, setDraggingLogo] = useState<string | null>(null);
  const logoOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  // Selected logo in group (double-clicked, shows sizing bar, ready to drag out)
  const [selectedGroupLogo, setSelectedGroupLogo] = useState<string | null>(null);
  // Hovered group logo (shows left/right reorder arrows)
  const [hoveredLogoId, setHoveredLogoId] = useState<string | null>(null);
  // Inline text editing on the flyer
  const [editingField, setEditingField] = useState<'city' | 'venue' | 'street' | 'time' | null>(null);

  // Draggable element positions (in 1080px canvas coordinates)
  const [positions, setPositions] = useState<FlyerPositions>(
    () => savedState?.positions || { ...DEFAULT_POSITIONS }
  );

  // User-resizable sponsor logo bounding box (in 1080px canvas coordinates)
  const [sponsorBoxSize, setSponsorBoxSize] = useState<{ width: number; height: number }>(
    () => savedState?.sponsorBoxSize || { ...DEFAULT_SPONSOR_BOX }
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
    setSponsorBoxSize({ ...DEFAULT_SPONSOR_BOX });
    setEditVenueName(null);
    setEditStreetAddress(null);
    setEditCity(null);
    setEditTime(null);
    if (storageKey) {
      try { localStorage.removeItem(storageKey); } catch {}
    }
    // Also clear DB config
    if (party?.id) {
      updateParty(party.id, { flyer_config: null }).catch(() => {});
    }
  }, [storageKey, party?.id]);

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

  /** Move a group logo left or right by swapping it with its neighbor in the group view. */
  const handleReorderLogo = useCallback(async (sponsorId: string, direction: -1 | 1, groupLogos: Sponsor[]) => {
    if (!party?.id) return;
    const groupIdx = groupLogos.findIndex(s => s.id === sponsorId);
    if (groupIdx < 0) return;
    const neighborIdx = groupIdx + direction;
    if (neighborIdx < 0 || neighborIdx >= groupLogos.length) return;

    const neighborId = groupLogos[neighborIdx].id;

    // Swap within the full sponsors array by id (so popped-out logos stay in place)
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
    const state = { positions, poppedLogos, logoSizes, sponsorBoxSize, editVenueName, editStreetAddress, editCity, editTime };
    try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch {}
  }, [storageKey, positions, poppedLogos, logoSizes, sponsorBoxSize, editVenueName, editStreetAddress, editCity, editTime]);

  // One-time backfill: if DB has no flyerConfig but localStorage does, sync to DB
  const backfillDone = useRef(false);
  useEffect(() => {
    if (backfillDone.current || !party?.id || party.flyerConfig) return;
    backfillDone.current = true;
    try {
      const raw = storageKey ? localStorage.getItem(storageKey) : null;
      if (raw) {
        const parsed = JSON.parse(raw);
        // Only backfill if there's meaningful customization data
        if (parsed && (parsed.positions || parsed.poppedLogos || parsed.logoSizes || parsed.editCity || parsed.editVenueName || parsed.editStreetAddress || parsed.editTime)) {
          updateParty(party.id, { flyer_config: parsed }).catch(() => {});
        }
      }
    } catch {}
  }, [party?.id, party?.flyerConfig, storageKey]);

  if (!party) return null;

  // Format date and time
  let timeDisplay = '';
  let dateDisplay = 'MAY 22'; // fallback if no event date
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
    // Derive "MAY 22" style date from event date in the event's timezone
    const eventDate = new Date(party.date);
    const monthFormatter = new Intl.DateTimeFormat('en-US', { timeZone: party.timezone, month: 'short' });
    const dayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: party.timezone, day: 'numeric' });
    const monthStr = monthFormatter.format(eventDate).toUpperCase();
    const dayStr = dayFormatter.format(eventDate);
    dateDisplay = `${monthStr} ${dayStr}`;
  }

  const defaultVenueName = party.venueName || 'YOUR VENUE';
  const defaultAddress = party.address || '';
  const cityFromTitle = party.name?.replace(/^Global Pizza Party\s*/i, '').trim();
  const defaultCity = cityFromTitle || (defaultAddress ? parseCityFromAddress(defaultAddress) : 'YOUR CITY');
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
  // Use edited time if set, otherwise auto-derived value
  const effectiveTimeDisplay = editTime !== null ? editTime : timeDisplay;
  // Fit the combined "MAY 22  6:00 PM - 9:00 PM" string within TIME_BOX
  // editTime === '' means user intentionally cleared it; null means use auto value
  const timeForDisplay = editTime === '' ? '' : (effectiveTimeDisplay || '6PM - 9PM');
  const fullTimeDisplay = timeForDisplay ? `${dateDisplay}  ${timeForDisplay}` : dateDisplay;
  const timeFontSize = fitText(fullTimeDisplay, 'Hub 191', 55, TIME_BOX.width);

  // Compute sponsor logo sizing to fit within bounding box
  const sponsorCount = sponsors.length;
  const sponsorCols = sponsorCount <= 4 ? sponsorCount : Math.ceil(sponsorCount / 2);
  const sponsorRows = sponsorCount <= 4 ? 1 : 2;
  const maxLogoWidth = sponsorCols > 0 ? (sponsorBoxSize.width - (sponsorCols - 1) * 16) / sponsorCols : 0;
  const maxLogoHeight = sponsorRows > 0 ? (sponsorBoxSize.height - (sponsorRows - 1) * 12) / sponsorRows : 0;
  const autoLogoSize = Math.min(maxLogoWidth / 2.5, maxLogoHeight);

  const scale = containerWidth / 1080;

  // Shared canvas render — used by both Download and Use-as-event-image.
  // Uses native Canvas 2D API instead of html2canvas — html2canvas mangles custom fonts.
  const renderFlyerToCanvas = async (): Promise<HTMLCanvasElement> => {
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1080;
    const ctx = canvas.getContext('2d')!;

    // 1) Draw template image
    const templateImg = await loadImg(getTemplateUrl(party.eventTags));
    ctx.drawImage(templateImg, 0, 0, 1080, 1080);

    ctx.textBaseline = 'top';

    // 2) City name — Hub 191 Display
    ctx.fillStyle = CITY_COLOR;
    ctx.font = `${cityFontSize}px "Hub 191 Display"`;
    ctx.fillText(city.toUpperCase(), positions.city.x, positions.city.y);

    // 3) Venue name + street address — Hub 191 Regular, black
    //    x locked to city.x so venue always left-aligns with city
    const venueX = positions.city.x;
    ctx.fillStyle = VENUE_COLOR;
    ctx.font = `${venueNameFontSize}px "Hub 191"`;
    ctx.fillText(venueName.toUpperCase(), venueX, positions.venue.y);
    if (streetAddress) {
      ctx.font = `${streetFontSize}px "Hub 191"`;
      ctx.fillText(streetAddress.toUpperCase(), venueX, positions.venue.y + venueNameFontSize + 4);
    }

    // 4) Date + Time — "MAY 22" in red, then time in white
    {
      ctx.font = `${timeFontSize}px "Hub 191"`;
      // Draw date (e.g. "MAY 22") in red
      ctx.fillStyle = CITY_COLOR;
      const dateStr = dateDisplay.toUpperCase();
      ctx.fillText(dateStr, positions.time.x, positions.time.y);
      // Measure date width to position time to its right
      const dateWidth = ctx.measureText(dateStr).width;
      const gap = 15;
      // Draw time in white
      if (effectiveTimeDisplay) {
        ctx.fillStyle = TIME_COLOR;
        ctx.fillText(effectiveTimeDisplay, positions.time.x + dateWidth + gap, positions.time.y);
      }
    }

    // 5) Sponsor logos — group logos in flex layout, popped logos at custom positions
    if (sponsors.length > 0) {
      const gap = 16;
      const boxX = positions.sponsors.x;
      const boxW = sponsorBoxSize.width;
      const boxH = sponsorBoxSize.height;

      // Separate group logos from popped-out logos
      const groupSponsors = sponsors.filter(s => !poppedLogos[s.id]);
      const poppedSponsors = sponsors.filter(s => poppedLogos[s.id]);

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

    return canvas;
  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const canvas = await renderFlyerToCanvas();
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

  const handleUseAsEventImage = async () => {
    if (!party) return;
    setSetImageState('uploading');
    try {
      const canvas = await renderFlyerToCanvas();
      const blob: Blob | null = await new Promise(resolve =>
        canvas.toBlob(b => resolve(b), 'image/png')
      );
      if (!blob) throw new Error('Failed to encode flyer as PNG');

      const file = new File(
        [blob],
        `gpp-flyer-${party.inviteCode || 'event'}.png`,
        { type: 'image/png' }
      );

      const uploadedUrl = await uploadEventImage(file);
      if (!uploadedUrl) throw new Error('Upload failed');

      // Build flyerConfig from current customization state (only save non-default values)
      const hasCustomizations =
        Object.keys(poppedLogos).length > 0 ||
        Object.keys(logoSizes).length > 0 ||
        editVenueName !== null ||
        editStreetAddress !== null ||
        editCity !== null ||
        editTime !== null ||
        positions.city.x !== DEFAULT_POSITIONS.city.x ||
        positions.city.y !== DEFAULT_POSITIONS.city.y ||
        positions.time.x !== DEFAULT_POSITIONS.time.x ||
        positions.time.y !== DEFAULT_POSITIONS.time.y ||
        positions.venue.x !== DEFAULT_POSITIONS.venue.x ||
        positions.venue.y !== DEFAULT_POSITIONS.venue.y ||
        positions.sponsors.x !== DEFAULT_POSITIONS.sponsors.x ||
        positions.sponsors.y !== DEFAULT_POSITIONS.sponsors.y ||
        sponsorBoxSize.width !== DEFAULT_SPONSOR_BOX.width ||
        sponsorBoxSize.height !== DEFAULT_SPONSOR_BOX.height;

      const flyerConfigValue = hasCustomizations ? {
        positions,
        poppedLogos: Object.keys(poppedLogos).length > 0 ? poppedLogos : undefined,
        logoSizes: Object.keys(logoSizes).length > 0 ? logoSizes : undefined,
        sponsorBoxSize: (sponsorBoxSize.width !== DEFAULT_SPONSOR_BOX.width || sponsorBoxSize.height !== DEFAULT_SPONSOR_BOX.height) ? sponsorBoxSize : undefined,
        editVenueName: editVenueName ?? undefined,
        editStreetAddress: editStreetAddress ?? undefined,
        editCity: editCity ?? undefined,
        editTime: editTime ?? undefined,
      } : null;

      const success = await updateParty(party.id, {
        event_image_url: uploadedUrl,
        flyer_generated_at: new Date().toISOString(),
        flyer_config: flyerConfigValue,
      });
      if (!success) throw new Error('Failed to update party');

      // Cancel any pending auto-regen so it doesn't overwrite the manual flyer
      cancelFlyerRegen(party.id);

      if (party.inviteCode) {
        await loadParty(party.inviteCode);
      }

      setSetImageState('success');
      setTimeout(() => setSetImageState('idle'), 2000);
    } catch (err) {
      console.error('Failed to set flyer as event image:', err);
      setSetImageState('error');
      setTimeout(() => setSetImageState('idle'), 2500);
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
    positions.sponsors.y !== DEFAULT_POSITIONS.sponsors.y ||
    sponsorBoxSize.width !== DEFAULT_SPONSOR_BOX.width ||
    sponsorBoxSize.height !== DEFAULT_SPONSOR_BOX.height;

  /** Render flyer content with drag handlers for the preview. */
  const renderFlyerContent = () => {
    // City, venue, and time are positionally locked — only sponsors can be dragged.
    const LOCKED_KEYS: ReadonlySet<keyof FlyerPositions> = new Set(['city', 'venue', 'time']);
    const getDragProps = (key: keyof FlyerPositions) => {
      const isLocked = LOCKED_KEYS.has(key);
      const isDragging = dragging === key;
      const isHovered = hoveredElement === key;
      // Disable drag when inline-editing a text field on this element
      const isEditing = (key === 'city' && editingField === 'city') ||
        (key === 'venue' && (editingField === 'venue' || editingField === 'street'));
      return {
        onMouseDown: isEditing || isLocked ? undefined : (e: React.MouseEvent) => handleMouseDown(e, key),
        onTouchStart: isEditing || isLocked ? undefined : (e: React.TouchEvent) => handleTouchStart(e, key),
        onMouseEnter: () => setHoveredElement(key),
        onMouseLeave: () => setHoveredElement(null),
        style: {
          cursor: isEditing ? 'text' : isLocked ? 'default' : isDragging ? 'grabbing' : 'grab',
          outline: isHovered && !isDragging && !isEditing && !isLocked ? '2px dashed rgba(255,255,255,0.5)' : 'none',
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
          src={getTemplateUrl(party.eventTags)}
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
                color: VENUE_COLOR,
                textTransform: 'uppercase',
                fontFamily: TEXT_FONT,
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

        {/* Date + Time - "MAY 22" in red, time in white, Hub 191 Regular */}
        {(() => {
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
                fontSize: timeFontSize,
                fontFamily: TEXT_FONT,
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
                    fontFamily: TEXT_FONT,
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

        {/* Sponsor logos - left-aligned in bounding box (skip popped-out logos) */}
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
                    color: 'rgba(255,255,255,0.7)',
                    pointerEvents: 'none',
                  }}
                />
              )}
              {/* Sponsor box resize handle — corner (resizes box width + height) */}
              {(() => {
                const handleBoxResizeStart = (e: React.MouseEvent) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const startX = e.clientX;
                  const startY = e.clientY;
                  const startW = sponsorBoxSize.width;
                  const startH = sponsorBoxSize.height;
                  const rect = canvasRef.current?.getBoundingClientRect();
                  const sc = rect ? rect.width / 1080 : 1;
                  const handleMove = (moveEvent: MouseEvent) => {
                    const deltaX = (moveEvent.clientX - startX) / sc;
                    const deltaY = (moveEvent.clientY - startY) / sc;
                    setSponsorBoxSize({
                      width: Math.round(Math.max(SPONSOR_BOX_MIN, Math.min(SPONSOR_BOX_MAX, startW + deltaX))),
                      height: Math.round(Math.max(SPONSOR_BOX_MIN, Math.min(SPONSOR_BOX_MAX, startH + deltaY))),
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
                  const sc = rect ? rect.width / 1080 : 1;
                  const handleMove = (moveEvent: TouchEvent) => {
                    moveEvent.preventDefault();
                    const deltaX = (moveEvent.touches[0].clientX - startX) / sc;
                    const deltaY = (moveEvent.touches[0].clientY - startY) / sc;
                    setSponsorBoxSize({
                      width: Math.round(Math.max(SPONSOR_BOX_MIN, Math.min(SPONSOR_BOX_MAX, startW + deltaX))),
                      height: Math.round(Math.max(SPONSOR_BOX_MIN, Math.min(SPONSOR_BOX_MAX, startH + deltaY))),
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
                    title={t('flyer.dragToResize')}
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
              {/* Sponsor box resize handle — right edge (width only) */}
              {(() => {
                const handleRightEdgeStart = (e: React.MouseEvent) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const startX = e.clientX;
                  const startW = sponsorBoxSize.width;
                  const rect = canvasRef.current?.getBoundingClientRect();
                  const sc = rect ? rect.width / 1080 : 1;
                  const handleMove = (moveEvent: MouseEvent) => {
                    const deltaX = (moveEvent.clientX - startX) / sc;
                    setSponsorBoxSize(prev => ({
                      ...prev,
                      width: Math.round(Math.max(SPONSOR_BOX_MIN, Math.min(SPONSOR_BOX_MAX, startW + deltaX))),
                    }));
                  };
                  const handleUp = () => {
                    document.removeEventListener('mousemove', handleMove);
                    document.removeEventListener('mouseup', handleUp);
                  };
                  document.addEventListener('mousemove', handleMove);
                  document.addEventListener('mouseup', handleUp);
                };
                const handleRightEdgeTouchStart = (e: React.TouchEvent) => {
                  e.stopPropagation();
                  const startX = e.touches[0].clientX;
                  const startW = sponsorBoxSize.width;
                  const rect = canvasRef.current?.getBoundingClientRect();
                  const sc = rect ? rect.width / 1080 : 1;
                  const handleMove = (moveEvent: TouchEvent) => {
                    moveEvent.preventDefault();
                    const deltaX = (moveEvent.touches[0].clientX - startX) / sc;
                    setSponsorBoxSize(prev => ({
                      ...prev,
                      width: Math.round(Math.max(SPONSOR_BOX_MIN, Math.min(SPONSOR_BOX_MAX, startW + deltaX))),
                    }));
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
                    onMouseDown={handleRightEdgeStart}
                    onTouchStart={handleRightEdgeTouchStart}
                    style={{
                      position: 'absolute',
                      top: '50%',
                      right: -4,
                      width: 6,
                      height: 28,
                      transform: 'translateY(-50%)',
                      cursor: 'ew-resize',
                      zIndex: 36,
                      background: 'rgba(255,255,255,0.5)',
                      borderRadius: 3,
                    }}
                  />
                );
              })()}
              {/* Sponsor box resize handle — bottom edge (height only) */}
              {(() => {
                const handleBottomEdgeStart = (e: React.MouseEvent) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const startY = e.clientY;
                  const startH = sponsorBoxSize.height;
                  const rect = canvasRef.current?.getBoundingClientRect();
                  const sc = rect ? rect.width / 1080 : 1;
                  const handleMove = (moveEvent: MouseEvent) => {
                    const deltaY = (moveEvent.clientY - startY) / sc;
                    setSponsorBoxSize(prev => ({
                      ...prev,
                      height: Math.round(Math.max(SPONSOR_BOX_MIN, Math.min(SPONSOR_BOX_MAX, startH + deltaY))),
                    }));
                  };
                  const handleUp = () => {
                    document.removeEventListener('mousemove', handleMove);
                    document.removeEventListener('mouseup', handleUp);
                  };
                  document.addEventListener('mousemove', handleMove);
                  document.addEventListener('mouseup', handleUp);
                };
                const handleBottomEdgeTouchStart = (e: React.TouchEvent) => {
                  e.stopPropagation();
                  const startY = e.touches[0].clientY;
                  const startH = sponsorBoxSize.height;
                  const rect = canvasRef.current?.getBoundingClientRect();
                  const sc = rect ? rect.width / 1080 : 1;
                  const handleMove = (moveEvent: TouchEvent) => {
                    moveEvent.preventDefault();
                    const deltaY = (moveEvent.touches[0].clientY - startY) / sc;
                    setSponsorBoxSize(prev => ({
                      ...prev,
                      height: Math.round(Math.max(SPONSOR_BOX_MIN, Math.min(SPONSOR_BOX_MAX, startH + deltaY))),
                    }));
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
                    onMouseDown={handleBottomEdgeStart}
                    onTouchStart={handleBottomEdgeTouchStart}
                    style={{
                      position: 'absolute',
                      bottom: -4,
                      left: '50%',
                      width: 28,
                      height: 6,
                      transform: 'translateX(-50%)',
                      cursor: 'ns-resize',
                      zIndex: 36,
                      background: 'rgba(255,255,255,0.5)',
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
                    {/* Reorder arrows (on hover) — top center of the logo */}
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
                            width: 22,
                            height: 22,
                            padding: 0,
                            borderRadius: '50%',
                            border: 'none',
                            background: 'rgba(0,0,0,0.75)',
                            color: canMoveLeft ? '#fff' : 'rgba(255,255,255,0.3)',
                            cursor: canMoveLeft ? 'pointer' : 'not-allowed',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
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
                            width: 22,
                            height: 22,
                            padding: 0,
                            borderRadius: '50%',
                            border: 'none',
                            background: 'rgba(0,0,0,0.75)',
                            color: canMoveRight ? '#fff' : 'rgba(255,255,255,0.3)',
                            cursor: canMoveRight ? 'pointer' : 'not-allowed',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
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
          {t('flyer.addLogo')}
        </button>
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="btn-primary flex items-center gap-2 px-6 py-3"
        >
          {downloading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              {t('flyer.generating')}
            </>
          ) : (
            <>
              <Download className="w-5 h-5" />
              {t('flyer.download')}
            </>
          )}
        </button>
        <button
          onClick={handleUseAsEventImage}
          disabled={setImageState === 'uploading'}
          className={`flex items-center gap-2 px-4 py-3 rounded-lg transition-colors text-sm ${
            setImageState === 'success'
              ? 'bg-green-500/20 text-green-300'
              : setImageState === 'error'
              ? 'bg-red-500/20 text-red-300'
              : 'bg-white/10 hover:bg-white/20 text-white/70 hover:text-white'
          }`}
          title={t('flyer.useAsEventImage')}
        >
          {setImageState === 'uploading' ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('flyer.uploading')}
            </>
          ) : setImageState === 'success' ? (
            <>
              <Check className="w-4 h-4" />
              {t('flyer.set')}
            </>
          ) : setImageState === 'error' ? (
            <>
              <ImagePlus className="w-4 h-4" />
              {t('flyer.uploadFailed')}
            </>
          ) : (
            <>
              <ImagePlus className="w-4 h-4" />
              {t('flyer.useForEvent')}
            </>
          )}
        </button>
        {hasCustomPositions && (
          <button
            onClick={handleResetPositions}
            className="flex items-center gap-2 px-4 py-3 rounded-lg bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors text-sm"
            title={t('flyer.resetPositions')}
          >
            <RotateCcw className="w-4 h-4" />
            {t('flyer.reset')}
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
          logoOnly={sponsorLogoOnly}
        />
      )}
    </div>
  );
}
