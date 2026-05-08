import React from 'react';
import { Download } from 'lucide-react';

type StickerShape = 'square' | 'round' | 'wide' | 'banner';

interface Sticker {
  id: string;
  name: string;
  shape: StickerShape;
}

const STICKERS: Sticker[] = [
  { id: 'sticker-1', name: 'Pizza The Planet', shape: 'square' },
  { id: 'sticker-2', name: 'Pizza The Planet Badge', shape: 'round' },
  { id: 'sticker-3', name: 'No Gods No Masters', shape: 'wide' },
  { id: 'sticker-4', name: 'Pizza Shud Be Free', shape: 'round' },
  { id: 'sticker-5', name: 'Powered By Pizza', shape: 'wide' },
  { id: 'sticker-6', name: 'Love Language Red Flag', shape: 'square' },
  { id: 'sticker-7', name: 'Pizza Shud Be Free', shape: 'square' },
  { id: 'sticker-8', name: 'Pizzamaxxing', shape: 'banner' },
  { id: 'sticker-9', name: 'Pizza Rizzler', shape: 'wide' },
  { id: 'sticker-10', name: 'Bitcoin Pizza Day 2026', shape: 'round' },
  { id: 'sticker-gpp2026-round', name: 'Global Pizza Party 2026', shape: 'round' },
  { id: 'sticker-gpp2026-square', name: 'Global Pizza Party 2026', shape: 'square' },
];

const shapeLabel: Record<StickerShape, string> = {
  square: 'Square',
  round: 'Round',
  wide: 'Wide',
  banner: 'Banner',
};

export function PrintTab() {
  return (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="text-xl font-bold text-theme-text">Sticker Pack</h2>
        <p className="text-sm text-theme-text-secondary mt-1">
          Download print-ready sticker PDFs for your event
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {STICKERS.map((sticker) => (
          <div key={sticker.id} className="card p-4 flex flex-col items-center gap-3">
            <div className="w-full aspect-square flex items-center justify-center overflow-hidden rounded-lg bg-theme-surface">
              <img
                src={`/stickers/${sticker.id}@2x.png`}
                alt={sticker.name}
                className="max-w-full max-h-full object-contain"
                loading="lazy"
              />
            </div>
            <div className="text-center w-full">
              <p className="text-sm font-medium text-theme-text leading-tight">{sticker.name}</p>
              <p className="text-xs text-theme-text-muted mt-0.5">{shapeLabel[sticker.shape]}</p>
            </div>
            <a
              href={`/stickers/${sticker.id}.pdf`}
              download
              className="flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg bg-[#ff393a]/15 text-[#ff393a] hover:bg-[#ff393a]/25 transition-colors text-sm font-medium"
            >
              <Download size={14} />
              Download PDF
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
