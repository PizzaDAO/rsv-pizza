import { useRef, useCallback, useState } from 'react';
import type { CanvasPositions, FormatConfig } from './types';

type ElementKey = string;

interface UseCanvasDragOptions {
  canvasRef: React.RefObject<HTMLDivElement | null>;
  config: FormatConfig;
  positions: CanvasPositions;
  onPositionChange: (key: ElementKey, pos: { x: number; y: number }) => void;
}

/**
 * Generalized drag hook for canvas editors with configurable dimensions.
 * Same pattern as useFlyerDrag but supports arbitrary canvas sizes.
 */
export function useCanvasDrag({ canvasRef, config, positions, onPositionChange }: UseCanvasDragOptions) {
  const [dragging, setDragging] = useState<ElementKey | null>(null);
  const offsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const clientToCanvas = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width / config.canvasWidth;
    const x = (clientX - rect.left) / scale;
    const y = (clientY - rect.top) / scale;
    return { x, y };
  }, [canvasRef, config.canvasWidth]);

  const handleMouseDown = useCallback((e: React.MouseEvent, key: ElementKey) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(key);

    const canvasPos = clientToCanvas(e.clientX, e.clientY);
    if (!canvasPos || !positions[key]) return;

    offsetRef.current = {
      x: canvasPos.x - positions[key].x,
      y: canvasPos.y - positions[key].y,
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const pos = clientToCanvas(moveEvent.clientX, moveEvent.clientY);
      if (!pos) return;
      const newX = Math.max(0, Math.min(config.canvasWidth, pos.x - offsetRef.current.x));
      const newY = Math.max(0, Math.min(config.canvasHeight, pos.y - offsetRef.current.y));
      onPositionChange(key, { x: newX, y: newY });
    };

    const handleMouseUp = () => {
      setDragging(null);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [clientToCanvas, positions, onPositionChange, config.canvasWidth, config.canvasHeight]);

  const handleTouchStart = useCallback((e: React.TouchEvent, key: ElementKey) => {
    e.stopPropagation();
    setDragging(key);

    const touch = e.touches[0];
    const canvasPos = clientToCanvas(touch.clientX, touch.clientY);
    if (!canvasPos || !positions[key]) return;

    offsetRef.current = {
      x: canvasPos.x - positions[key].x,
      y: canvasPos.y - positions[key].y,
    };

    const handleTouchMove = (moveEvent: TouchEvent) => {
      moveEvent.preventDefault();
      const t = moveEvent.touches[0];
      const pos = clientToCanvas(t.clientX, t.clientY);
      if (!pos) return;
      const newX = Math.max(0, Math.min(config.canvasWidth, pos.x - offsetRef.current.x));
      const newY = Math.max(0, Math.min(config.canvasHeight, pos.y - offsetRef.current.y));
      onPositionChange(key, { x: newX, y: newY });
    };

    const handleTouchEnd = () => {
      setDragging(null);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };

    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
  }, [clientToCanvas, positions, onPositionChange, config.canvasWidth, config.canvasHeight]);

  return {
    dragging,
    clientToCanvas,
    handleMouseDown,
    handleTouchStart,
  };
}
