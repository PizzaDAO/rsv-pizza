import React from 'react';
import { RentalStatus } from '../../types';

interface RentalShapePreviewProps {
  shapeType: string;
  color: string;
  status: RentalStatus;
  size?: number;
}

const STATUS_COLORS: Record<string, string> = {
  available: '#39d98a',
  reserved: '#ffc107',
  sold: '#ff393a',
};

export function RentalShapePreview({ shapeType, color, status, size = 32 }: RentalShapePreviewProps) {
  const borderColor = STATUS_COLORS[status] || STATUS_COLORS.available;
  const strokeDash = status === 'reserved' ? '3,2' : undefined;

  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      {shapeType === 'circle' ? (
        <circle
          cx={16}
          cy={16}
          r={12}
          fill={`${color}40`}
          stroke={borderColor}
          strokeWidth={2}
          strokeDasharray={strokeDash}
        />
      ) : (
        <rect
          x={4}
          y={shapeType === 'square' ? 4 : 8}
          width={24}
          height={shapeType === 'square' ? 24 : 16}
          rx={2}
          fill={`${color}40`}
          stroke={borderColor}
          strokeWidth={2}
          strokeDasharray={strokeDash}
        />
      )}
      {status === 'sold' && (
        <>
          <line x1={8} y1={8} x2={24} y2={24} stroke={borderColor} strokeWidth={1.5} opacity={0.5} />
          <line x1={24} y1={8} x2={8} y2={24} stroke={borderColor} strokeWidth={1.5} opacity={0.5} />
        </>
      )}
    </svg>
  );
}
