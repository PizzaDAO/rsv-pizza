import { useRef, useCallback, useState } from 'react';

export interface FlyerPositions {
  city: { x: number; y: number };
  time: { x: number; y: number };
  venue: { x: number; y: number };
  sponsors: { x: number; y: number };
}

/** Default positions (in 1080px canvas coordinates) matching the 2026 template layout */
export const DEFAULT_POSITIONS: FlyerPositions = {
  city: { x: 50, y: 580 },
  time: { x: 50, y: 650 },
  venue: { x: 50, y: 700 },
  sponsors: { x: 27, y: 884 },
};

type ElementKey = keyof FlyerPositions;

interface UseFlyerDragOptions {
  /** The ref to the 1080x1080 canvas container (the one that gets CSS-scaled) */
  canvasRef: React.RefObject<HTMLDivElement | null>;
  positions: FlyerPositions;
  onPositionChange: (key: ElementKey, pos: { x: number; y: number }) => void;
}

/**
 * Custom hook for drag-and-drop on the flyer canvas.
 * Handles mouse and touch events with scale-aware coordinate conversion.
 * Follows the same pattern as DisplaysWidget.tsx free-form drag.
 */
export function useFlyerDrag({ canvasRef, positions, onPositionChange }: UseFlyerDragOptions) {
  const [dragging, setDragging] = useState<ElementKey | null>(null);
  const offsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  /** Convert a client (screen) coordinate to 1080px canvas coordinate */
  const clientToCanvas = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    // The canvas is 1080px but CSS-scaled to fit its container
    const scale = rect.width / 1080;
    const x = (clientX - rect.left) / scale;
    const y = (clientY - rect.top) / scale;
    return { x, y };
  }, [canvasRef]);

  const handleMouseDown = useCallback((e: React.MouseEvent, key: ElementKey) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(key);

    const canvasPos = clientToCanvas(e.clientX, e.clientY);
    if (!canvasPos) return;

    // Store offset from element position to cursor so element doesn't jump
    offsetRef.current = {
      x: canvasPos.x - positions[key].x,
      y: canvasPos.y - positions[key].y,
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const pos = clientToCanvas(moveEvent.clientX, moveEvent.clientY);
      if (!pos) return;
      const newX = Math.max(0, Math.min(1080, pos.x - offsetRef.current.x));
      const newY = Math.max(0, Math.min(1080, pos.y - offsetRef.current.y));
      onPositionChange(key, { x: newX, y: newY });
    };

    const handleMouseUp = () => {
      setDragging(null);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [clientToCanvas, positions, onPositionChange]);

  const handleTouchStart = useCallback((e: React.TouchEvent, key: ElementKey) => {
    e.stopPropagation();
    setDragging(key);

    const touch = e.touches[0];
    const canvasPos = clientToCanvas(touch.clientX, touch.clientY);
    if (!canvasPos) return;

    offsetRef.current = {
      x: canvasPos.x - positions[key].x,
      y: canvasPos.y - positions[key].y,
    };

    const handleTouchMove = (moveEvent: TouchEvent) => {
      moveEvent.preventDefault();
      const t = moveEvent.touches[0];
      const pos = clientToCanvas(t.clientX, t.clientY);
      if (!pos) return;
      const newX = Math.max(0, Math.min(1080, pos.x - offsetRef.current.x));
      const newY = Math.max(0, Math.min(1080, pos.y - offsetRef.current.y));
      onPositionChange(key, { x: newX, y: newY });
    };

    const handleTouchEnd = () => {
      setDragging(null);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };

    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
  }, [clientToCanvas, positions, onPositionChange]);

  return {
    dragging,
    handleMouseDown,
    handleTouchStart,
  };
}
