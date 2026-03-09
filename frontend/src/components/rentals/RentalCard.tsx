import React from 'react';
import { Edit2, Trash2, DollarSign, Users, Eye, EyeOff } from 'lucide-react';
import { Rental, RentalStatus } from '../../types';
import { RentalShapePreview } from './RentalShape';

interface RentalCardProps {
  rental: Rental;
  onEdit: (rental: Rental) => void;
  onDelete: (rental: Rental) => void;
  isSelected: boolean;
  onSelect: (rentalId: string) => void;
}

const STATUS_LABELS: Record<RentalStatus, { label: string; className: string }> = {
  available: { label: 'Available', className: 'bg-[#39d98a]/20 text-[#39d98a]' },
  reserved: { label: 'Reserved', className: 'bg-[#ffc107]/20 text-[#ffc107]' },
  sold: { label: 'Sold', className: 'bg-[#ff393a]/20 text-[#ff393a]' },
};

export function RentalCard({ rental, onEdit, onDelete, isSelected, onSelect }: RentalCardProps) {
  const statusInfo = STATUS_LABELS[rental.status] || STATUS_LABELS.available;

  const formatPrice = () => {
    if (rental.price === null || rental.price === undefined) return null;
    const formatted = `$${Number(rental.price).toFixed(0)}`;
    if (rental.priceUnit === 'per_hour') return `${formatted}/hr`;
    if (rental.priceUnit === 'per_day') return `${formatted}/day`;
    return formatted;
  };

  return (
    <div
      className={`card p-3 transition-colors cursor-pointer ${
        isSelected ? 'ring-1 ring-[#ff393a] bg-[#ff393a]/5' : 'hover:bg-white/5'
      }`}
      onClick={() => onSelect(rental.id)}
    >
      <div className="flex items-start gap-3">
        <RentalShapePreview
          shapeType={rental.shapeType}
          color={rental.color}
          status={rental.status}
          size={36}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-white truncate">{rental.name}</span>
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${statusInfo.className}`}>
              {statusInfo.label}
            </span>
          </div>

          <div className="flex items-center gap-3 mt-1">
            {formatPrice() && (
              <span className="flex items-center gap-1 text-xs text-white/50">
                <DollarSign size={10} />
                {formatPrice()}
              </span>
            )}
            {rental.capacity && (
              <span className="flex items-center gap-1 text-xs text-white/50">
                <Users size={10} />
                {rental.capacity}
              </span>
            )}
            <span className="flex items-center gap-1 text-xs text-white/30">
              {rental.showOnDisplay ? <Eye size={10} /> : <EyeOff size={10} />}
            </span>
          </div>

          {rental.bookedBy && (
            <div className="mt-1 text-[10px] text-white/40 truncate">
              Booked: {rental.bookedBy}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit(rental);
            }}
            className="p-1.5 text-white/30 hover:text-white/60 hover:bg-white/5 rounded transition-colors"
          >
            <Edit2 size={14} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(rental);
            }}
            className="p-1.5 text-white/30 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
