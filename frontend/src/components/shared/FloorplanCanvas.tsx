import React, { useRef, useCallback } from 'react';
import { MapPin } from 'lucide-react';
import { Rental } from '../../types';

interface FloorplanPin {
  displayId: string;
  x: number;
  y: number;
  name: string;
  isActive: boolean;
}

interface FloorplanCanvasProps {
  floorplanUrl: string;
  displayPins?: FloorplanPin[];
  rentalShapes?: Rental[];
  mode: 'display-pins' | 'rental-shapes' | 'view-only';
  onCanvasClick?: (x: number, y: number) => void;
  onShapeClick?: (rentalId: string) => void;
  onShapeMove?: (rentalId: string, x: number, y: number) => void;
  selectedRentalId?: string | null;
  showDisplayPins?: boolean;
  showRentalShapes?: boolean;
  showLabels?: boolean;
  showPrices?: boolean;
  showStatus?: boolean;
  maxHeight?: string;
}

const STATUS_COLORS: Record<string, { fill: string; border: string; pattern?: string }> = {
  available: { fill: 'rgba(57, 217, 138, 0.3)', border: '#39d98a' },
  reserved: { fill: 'rgba(255, 193, 7, 0.3)', border: '#ffc107', pattern: 'dashed' },
  sold: { fill: 'rgba(255, 57, 58, 0.3)', border: '#ff393a' },
};

export function FloorplanCanvas({
  floorplanUrl,
  displayPins = [],
  rentalShapes = [],
  mode,
  onCanvasClick,
  onShapeClick,
  onShapeMove,
  selectedRentalId,
  showDisplayPins = true,
  showRentalShapes = true,
  showLabels = true,
  showPrices = false,
  showStatus = true,
  maxHeight = '400px',
}: FloorplanCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<string | null>(null);

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (draggingRef.current) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-shape]') || target.closest('[data-pin]')) return;

    if (!onCanvasClick) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    onCanvasClick(Math.max(0, Math.min(100, x)), Math.max(0, Math.min(100, y)));
  }, [onCanvasClick]);

  const handleShapeDragStart = useCallback((e: React.MouseEvent, rentalId: string) => {
    if (mode === 'view-only' || !onShapeMove) return;
    e.stopPropagation();
    e.preventDefault();
    draggingRef.current = rentalId;

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const handleMove = (moveEvent: MouseEvent) => {
      const x = ((moveEvent.clientX - rect.left) / rect.width) * 100;
      const y = ((moveEvent.clientY - rect.top) / rect.height) * 100;
      onShapeMove(rentalId, Math.max(0, Math.min(100, x)), Math.max(0, Math.min(100, y)));
    };

    const handleUp = () => {
      draggingRef.current = null;
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [mode, onShapeMove]);

  const handleShapeTouchStart = useCallback((e: React.TouchEvent, rentalId: string) => {
    if (mode === 'view-only' || !onShapeMove) return;
    e.stopPropagation();
    draggingRef.current = rentalId;

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const handleMove = (moveEvent: TouchEvent) => {
      moveEvent.preventDefault();
      const touch = moveEvent.touches[0];
      const x = ((touch.clientX - rect.left) / rect.width) * 100;
      const y = ((touch.clientY - rect.top) / rect.height) * 100;
      onShapeMove!(rentalId, Math.max(0, Math.min(100, x)), Math.max(0, Math.min(100, y)));
    };

    const handleEnd = () => {
      draggingRef.current = null;
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleEnd);
    };

    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleEnd);
  }, [mode, onShapeMove]);

  const getStatusStyle = (status: string) => {
    return STATUS_COLORS[status] || STATUS_COLORS.available;
  };

  const formatPrice = (price: number | null | undefined, unit: string | null | undefined) => {
    if (price === null || price === undefined) return '';
    const formatted = `$${Number(price).toFixed(0)}`;
    if (unit === 'per_hour') return `${formatted}/hr`;
    if (unit === 'per_day') return `${formatted}/day`;
    return formatted;
  };

  return (
    <div
      ref={canvasRef}
      className={`relative rounded-lg overflow-hidden border border-white/10 select-none ${
        mode !== 'view-only' ? 'cursor-crosshair' : ''
      }`}
      onClick={handleClick}
    >
      <img
        src={floorplanUrl}
        alt="Venue Floorplan"
        className="w-full object-contain bg-black/30 pointer-events-none"
        style={{ maxHeight }}
        draggable={false}
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />

      {/* SVG overlay for rental shapes */}
      {showRentalShapes && rentalShapes.length > 0 && (
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          <defs>
            <pattern id="crosshatch" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="4" stroke="rgba(255,57,58,0.3)" strokeWidth="1" />
            </pattern>
          </defs>
          {rentalShapes.map((rental) => {
            const statusStyle = getStatusStyle(rental.status);
            const isSelected = selectedRentalId === rental.id;
            const strokeDash = statusStyle.pattern === 'dashed' ? '0.5,0.3' : undefined;

            if (rental.shapeType === 'circle') {
              const rx = rental.width / 2;
              const ry = rental.height / 2;
              return (
                <g key={rental.id}>
                  <ellipse
                    data-shape="true"
                    cx={rental.x}
                    cy={rental.y}
                    rx={rx}
                    ry={ry}
                    fill={statusStyle.fill}
                    stroke={isSelected ? '#ffffff' : statusStyle.border}
                    strokeWidth={isSelected ? 0.4 : 0.2}
                    strokeDasharray={strokeDash}
                    opacity={rental.opacity}
                    style={{ pointerEvents: 'all', cursor: mode !== 'view-only' ? 'grab' : 'default' }}
                    onMouseDown={(e) => handleShapeDragStart(e as any, rental.id)}
                    onTouchStart={(e) => handleShapeTouchStart(e as any, rental.id)}
                    onClick={(e) => {
                      e.stopPropagation();
                      onShapeClick?.(rental.id);
                    }}
                  />
                  {rental.status === 'sold' && (
                    <ellipse
                      cx={rental.x}
                      cy={rental.y}
                      rx={rx}
                      ry={ry}
                      fill="url(#crosshatch)"
                      opacity={0.3}
                      style={{ pointerEvents: 'none' }}
                    />
                  )}
                </g>
              );
            }

            // Rectangle / Square
            const w = rental.shapeType === 'square' ? Math.min(rental.width, rental.height) : rental.width;
            const h = rental.shapeType === 'square' ? Math.min(rental.width, rental.height) : rental.height;
            return (
              <g key={rental.id}>
                <rect
                  data-shape="true"
                  x={rental.x - w / 2}
                  y={rental.y - h / 2}
                  width={w}
                  height={h}
                  fill={statusStyle.fill}
                  stroke={isSelected ? '#ffffff' : statusStyle.border}
                  strokeWidth={isSelected ? 0.4 : 0.2}
                  strokeDasharray={strokeDash}
                  opacity={rental.opacity}
                  rx={0.3}
                  ry={0.3}
                  transform={rental.rotation ? `rotate(${rental.rotation}, ${rental.x}, ${rental.y})` : undefined}
                  style={{ pointerEvents: 'all', cursor: mode !== 'view-only' ? 'grab' : 'default' }}
                  onMouseDown={(e) => handleShapeDragStart(e as any, rental.id)}
                  onTouchStart={(e) => handleShapeTouchStart(e as any, rental.id)}
                  onClick={(e) => {
                    e.stopPropagation();
                    onShapeClick?.(rental.id);
                  }}
                />
                {rental.status === 'sold' && (
                  <rect
                    x={rental.x - w / 2}
                    y={rental.y - h / 2}
                    width={w}
                    height={h}
                    fill="url(#crosshatch)"
                    opacity={0.3}
                    rx={0.3}
                    ry={0.3}
                    transform={rental.rotation ? `rotate(${rental.rotation}, ${rental.x}, ${rental.y})` : undefined}
                    style={{ pointerEvents: 'none' }}
                  />
                )}
              </g>
            );
          })}
        </svg>
      )}

      {/* HTML labels overlay for rental shapes (better text rendering) */}
      {showRentalShapes && rentalShapes.map((rental) => {
        if (!showLabels && !showPrices && !showStatus) return null;
        const statusStyle = getStatusStyle(rental.status);

        return (
          <div
            key={`label-${rental.id}`}
            className="absolute pointer-events-none flex flex-col items-center"
            style={{
              left: `${rental.x}%`,
              top: `${rental.y}%`,
              transform: 'translate(-50%, -50%)',
              zIndex: 15,
            }}
          >
            {rental.showLabel && showLabels && (
              <div className="bg-black/70 backdrop-blur-sm px-1.5 py-0.5 rounded text-[9px] font-medium text-white whitespace-nowrap max-w-[80px] truncate">
                {rental.name}
              </div>
            )}
            {showPrices && rental.price != null && (
              <div className="text-[8px] text-white/70 mt-0.5">
                {formatPrice(rental.price, rental.priceUnit)}
              </div>
            )}
            {showStatus && (
              <div
                className="w-1.5 h-1.5 rounded-full mt-0.5"
                style={{ backgroundColor: statusStyle.border }}
              />
            )}
          </div>
        );
      })}

      {/* Display pins overlay */}
      {showDisplayPins && displayPins.map((pin) => (
        <div
          key={`pin-${pin.displayId}`}
          data-pin="true"
          className="absolute"
          style={{
            left: `${pin.x}%`,
            top: `${pin.y}%`,
            transform: 'translate(-50%, -100%)',
            zIndex: 20,
          }}
        >
          <MapPin
            size={24}
            className="drop-shadow-lg"
            fill={pin.isActive ? '#ff393a' : 'rgba(255,255,255,0.3)'}
            color={pin.isActive ? '#cc2e2f' : 'rgba(255,255,255,0.5)'}
          />
          {showLabels && (
            <div className="mt-0.5 px-1 py-0.5 rounded text-[8px] font-medium bg-black/70 text-white whitespace-nowrap text-center">
              {pin.name}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
