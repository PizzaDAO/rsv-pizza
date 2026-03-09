import React, { useState, useEffect } from 'react';
import { X, Tag, DollarSign, Users, Palette, Type } from 'lucide-react';
import { IconInput } from '../IconInput';
import { Checkbox } from '../Checkbox';
import { Rental, RentalShapeType, RentalStatus } from '../../types';

interface RentalFormProps {
  rental?: Rental | null;
  onSave: (data: RentalFormData) => void;
  onClose: () => void;
  isLoading?: boolean;
  error?: string | null;
}

export interface RentalFormData {
  name: string;
  description?: string | null;
  shapeType: RentalShapeType;
  color: string;
  borderColor: string;
  price?: number | null;
  priceUnit: string;
  capacity?: number | null;
  status: RentalStatus;
  bookedBy?: string | null;
  bookedEmail?: string | null;
  bookedNotes?: string | null;
  showLabel: boolean;
  showOnDisplay: boolean;
  opacity: number;
  width: number;
  height: number;
}

const SHAPE_TYPES: { value: RentalShapeType; label: string }[] = [
  { value: 'rectangle', label: 'Rectangle' },
  { value: 'square', label: 'Square' },
  { value: 'circle', label: 'Circle' },
];

const STATUS_OPTIONS: { value: RentalStatus; label: string }[] = [
  { value: 'available', label: 'Available' },
  { value: 'reserved', label: 'Reserved' },
  { value: 'sold', label: 'Sold' },
];

const PRICE_UNITS: { value: string; label: string }[] = [
  { value: 'flat', label: 'Flat rate' },
  { value: 'per_hour', label: 'Per hour' },
  { value: 'per_day', label: 'Per day' },
];

export function RentalForm({ rental, onSave, onClose, isLoading, error }: RentalFormProps) {
  const [name, setName] = useState(rental?.name || '');
  const [description, setDescription] = useState(rental?.description || '');
  const [shapeType, setShapeType] = useState<RentalShapeType>(rental?.shapeType || 'rectangle');
  const [color, setColor] = useState(rental?.color || '#ff393a');
  const [borderColor, setBorderColor] = useState(rental?.borderColor || '#ffffff');
  const [price, setPrice] = useState(rental?.price?.toString() || '');
  const [priceUnit, setPriceUnit] = useState(rental?.priceUnit || 'flat');
  const [capacity, setCapacity] = useState(rental?.capacity?.toString() || '');
  const [status, setStatus] = useState<RentalStatus>(rental?.status || 'available');
  const [bookedBy, setBookedBy] = useState(rental?.bookedBy || '');
  const [bookedEmail, setBookedEmail] = useState(rental?.bookedEmail || '');
  const [bookedNotes, setBookedNotes] = useState(rental?.bookedNotes || '');
  const [showLabel, setShowLabel] = useState(rental?.showLabel ?? true);
  const [showOnDisplay, setShowOnDisplay] = useState(rental?.showOnDisplay ?? true);
  const [opacity, setOpacity] = useState(rental?.opacity ?? 0.3);
  const [width, setWidth] = useState(rental?.width ?? 10);
  const [height, setHeight] = useState(rental?.height ?? 10);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      name,
      description: description || null,
      shapeType,
      color,
      borderColor,
      price: price ? parseFloat(price) : null,
      priceUnit,
      capacity: capacity ? parseInt(capacity) : null,
      status,
      bookedBy: bookedBy || null,
      bookedEmail: bookedEmail || null,
      bookedNotes: bookedNotes || null,
      showLabel,
      showOnDisplay,
      opacity,
      width,
      height,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-[#1a1a2e] rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-[#1a1a2e] border-b border-white/10 p-4 flex items-center justify-between z-10">
          <h2 className="text-lg font-bold text-white">
            {rental ? 'Edit Rental' : 'New Rental'}
          </h2>
          <button onClick={onClose} className="text-white/50 hover:text-white">
            <X size={22} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-5">
          {/* Name */}
          <IconInput
            icon={Tag}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Rental name (e.g., Booth A, Table 1)"
            required
          />

          {/* Description */}
          <IconInput
            icon={Type}
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            multiline
          />

          {/* Shape Type */}
          <div>
            <p className="text-xs text-white/50 mb-2">Shape</p>
            <div className="flex gap-2">
              {SHAPE_TYPES.map((st) => (
                <button
                  key={st.value}
                  type="button"
                  onClick={() => setShapeType(st.value)}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm border transition-colors ${
                    shapeType === st.value
                      ? 'border-[#ff393a] bg-[#ff393a]/10 text-white'
                      : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10'
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>
          </div>

          {/* Size */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-white/50 mb-1">Width (%)</p>
              <input
                type="number"
                min={2}
                max={50}
                step={1}
                value={width}
                onChange={(e) => setWidth(parseFloat(e.target.value) || 10)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm"
              />
            </div>
            <div>
              <p className="text-xs text-white/50 mb-1">Height (%)</p>
              <input
                type="number"
                min={2}
                max={50}
                step={1}
                value={height}
                onChange={(e) => setHeight(parseFloat(e.target.value) || 10)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm"
              />
            </div>
          </div>

          {/* Colors */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-white/50 mb-1">Fill color</p>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="w-8 h-8 rounded cursor-pointer"
                />
                <input
                  type="text"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white font-mono text-xs"
                />
              </div>
            </div>
            <div>
              <p className="text-xs text-white/50 mb-1">Border color</p>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={borderColor}
                  onChange={(e) => setBorderColor(e.target.value)}
                  className="w-8 h-8 rounded cursor-pointer"
                />
                <input
                  type="text"
                  value={borderColor}
                  onChange={(e) => setBorderColor(e.target.value)}
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white font-mono text-xs"
                />
              </div>
            </div>
          </div>

          {/* Opacity */}
          <div>
            <p className="text-xs text-white/50 mb-1">Opacity: {(opacity * 100).toFixed(0)}%</p>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={opacity}
              onChange={(e) => setOpacity(parseFloat(e.target.value))}
              className="w-full accent-[#ff393a]"
            />
          </div>

          {/* Status */}
          <div>
            <p className="text-xs text-white/50 mb-2">Status</p>
            <div className="flex gap-2">
              {STATUS_OPTIONS.map((so) => (
                <button
                  key={so.value}
                  type="button"
                  onClick={() => setStatus(so.value)}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm border transition-colors ${
                    status === so.value
                      ? 'border-[#ff393a] bg-[#ff393a]/10 text-white'
                      : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10'
                  }`}
                >
                  {so.label}
                </button>
              ))}
            </div>
          </div>

          {/* Price & Capacity */}
          <div className="grid grid-cols-3 gap-3">
            <IconInput
              icon={DollarSign}
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="Price"
            />
            <div>
              <select
                value={priceUnit}
                onChange={(e) => setPriceUnit(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm h-[42px]"
              >
                {PRICE_UNITS.map((pu) => (
                  <option key={pu.value} value={pu.value}>{pu.label}</option>
                ))}
              </select>
            </div>
            <IconInput
              icon={Users}
              type="number"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="Capacity"
            />
          </div>

          {/* Booking info (shown when reserved or sold) */}
          {(status === 'reserved' || status === 'sold') && (
            <div className="border border-white/10 rounded-lg p-3 space-y-3">
              <p className="text-xs text-white/50">Booking Info</p>
              <IconInput
                icon={Tag}
                type="text"
                value={bookedBy}
                onChange={(e) => setBookedBy(e.target.value)}
                placeholder="Booked by (name / organization)"
              />
              <IconInput
                icon={Tag}
                type="email"
                value={bookedEmail}
                onChange={(e) => setBookedEmail(e.target.value)}
                placeholder="Contact email"
              />
              <IconInput
                icon={Type}
                type="text"
                value={bookedNotes}
                onChange={(e) => setBookedNotes(e.target.value)}
                placeholder="Booking notes"
                multiline
              />
            </div>
          )}

          {/* Display options */}
          <div className="space-y-3">
            <Checkbox
              checked={showLabel}
              onChange={() => setShowLabel(!showLabel)}
              label="Show label on floorplan"
            />
            <Checkbox
              checked={showOnDisplay}
              onChange={() => setShowOnDisplay(!showOnDisplay)}
              label="Show on public display"
            />
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-4 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg border border-white/10 text-white/70 hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !name}
              className="flex-1 px-4 py-2 rounded-lg bg-[#ff393a] text-white font-medium hover:bg-[#ff393a]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Saving...' : rental ? 'Save Changes' : 'Create Rental'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
