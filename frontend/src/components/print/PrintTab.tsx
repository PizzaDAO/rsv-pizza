import React from 'react';
import { Download, Tag } from 'lucide-react';
import { usePizza } from '../../contexts/PizzaContext';
import { PosterGenerator } from '../generative/PosterGenerator';
import { RollupGenerator } from '../generative/RollupGenerator';

type StickerShape = 'square' | 'round' | 'wide' | 'banner';

interface Sticker {
  id: string;
  name: string;
  shape: StickerShape;
  pngOnly?: boolean;
  /** If set, only show this sticker when the event has this tag */
  requireTag?: string;
  /** If true, the image is an SVG (not PNG) */
  svg?: boolean;
}

interface PrintAsset {
  id: string;
  name: string;
  preview: string;
  pdf: string;
}

interface NameTag {
  id: string;
  name: string;
  description: string;
  preview?: string;
  pdf: string;
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

const SWC_ASSETS: Sticker[] = [
  { id: 'swc', name: 'Stand With Crypto', shape: 'wide', svg: true, requireTag: 'swc' },
  { id: 'swc-canada', name: 'Stand With Crypto Canada', shape: 'wide', pngOnly: true, requireTag: 'swccanada' },
  { id: 'swc-au', name: 'Stand With Crypto Australia', shape: 'wide', svg: true, requireTag: 'swcau' },
  { id: 'swc-europe', name: 'Stand With Crypto Europe', shape: 'wide', svg: true, requireTag: 'swceu' },
  { id: 'swc-br', name: 'Stand With Crypto Brazil', shape: 'wide', svg: true, requireTag: 'swcbr' },
  { id: 'swc-uk', name: 'Stand With Crypto UK', shape: 'wide', svg: true, requireTag: 'swcuk' },
];

const FLYERS: PrintAsset[] = [
  {
    id: 'join-the-mafia-8.5x11',
    name: 'Join The Pizza Mafia (8.5" x 11")',
    preview: '/print-assets/flyers/join-the-mafia-8.5x11.png',
    pdf: '/print-assets/flyers/join-the-mafia-8.5x11.pdf',
  },
  {
    id: 'join-the-mafia-a4',
    name: 'Join The Pizza Mafia (A4)',
    preview: '/print-assets/flyers/join-the-mafia-a4.jpg',
    pdf: '/print-assets/flyers/join-the-mafia-a4.pdf',
  },
];

const TABLE_TENTS: PrintAsset[] = [
  {
    id: 'pizzaday-table-tent',
    name: 'PizzaDAO Table Tent',
    preview: '/print-assets/table-tents/pizzaday-table-tent.jpg',
    pdf: '/print-assets/table-tents/pizzaday-table-tent.pdf',
  },
];

const NAME_TAGS: NameTag[] = [
  {
    id: 'tmnt-nametags',
    name: 'TMNT Name Tags',
    description: 'Ninja Turtle themed name tags (without sponsor logos)',
    preview: '/print-assets/name-tags/tmnt-nametags-preview.png',
    pdf: '/print-assets/name-tags/tmnt-nametags.pdf',
  },
];

const shapeLabel: Record<StickerShape, string> = {
  square: 'Square',
  round: 'Round',
  wide: 'Wide',
  banner: 'Banner',
};

/**
 * PrintMaterials renders all print assets with no party context.
 * Shows everything including all SWC assets. Used on /shipping.
 */
export function PrintMaterials() {
  return <PrintContent showAllSwc />;
}

export function PrintTab() {
  const { party } = usePizza();
  const eventTags = party?.eventTags || [];
  return (
    <div className="space-y-8">
      {party?.eventType === 'gpp' && (
        <>
          <section>
            <h3 className="text-lg font-semibold text-theme-text mb-3">Event Poster</h3>
            <PosterGenerator />
          </section>
          <section>
            <h3 className="text-lg font-semibold text-theme-text mb-3">Roll-Up Banner</h3>
            <RollupGenerator />
          </section>
        </>
      )}
      <PrintContent eventTags={eventTags} />
    </div>
  );
}

function PrintContent({ eventTags = [], showAllSwc = false }: { eventTags?: string[]; showAllSwc?: boolean }) {
  const visibleSwcAssets = showAllSwc
    ? SWC_ASSETS
    : SWC_ASSETS.filter((s) => eventTags.includes(s.requireTag!));

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center">
        <h2 className="text-xl font-bold text-theme-text">Print Materials</h2>
        <p className="text-sm text-theme-text-secondary mt-1">
          Download print-ready materials for your event
        </p>
        <p className="text-sm text-theme-text-secondary mt-1">
          Need something custom?{' '}
          <a
            href="https://www.figma.com/design/itTDjW8plqdUiEGIXlwBP8/PizzaDAO---Marketing?node-id=588-1909&t=gkFsmruefaXmimZs-1"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#ff393a] hover:underline font-medium"
          >
            Browse the PizzaDAO Figma →
          </a>
        </p>
      </div>

      {/* Stickers Section */}
      <section>
        <h3 className="text-lg font-semibold text-theme-text mb-3">Stickers</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {STICKERS.map((sticker) => {
            const imgSrc = sticker.svg
              ? `/stickers/${sticker.id}.svg`
              : sticker.pngOnly
                ? `/stickers/${sticker.id}.png`
                : `/stickers/${sticker.id}@2x.png`;
            const downloadHref = sticker.svg
              ? `/stickers/${sticker.id}.svg`
              : sticker.pngOnly
                ? `/stickers/${sticker.id}.png`
                : `/stickers/${sticker.id}.pdf`;
            const downloadLabel = sticker.svg ? 'Download SVG' : sticker.pngOnly ? 'Download PNG' : 'Download PDF';

            return (
              <div key={sticker.id} className="card p-4 flex flex-col items-center gap-3">
                <div className="w-full aspect-square flex items-center justify-center overflow-hidden rounded-lg bg-theme-surface p-3">
                  <img
                    src={imgSrc}
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
                  href={downloadHref}
                  download
                  className="flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg bg-[#ff393a]/15 text-[#ff393a] hover:bg-[#ff393a]/25 transition-colors text-sm font-medium"
                >
                  <Download size={14} />
                  {downloadLabel}
                </a>
              </div>
            );
          })}
        </div>
      </section>

      {/* Stand With Crypto Section — only visible for SWC-tagged events */}
      {visibleSwcAssets.length > 0 && (
        <section>
          <h3 className="text-lg font-semibold text-theme-text mb-3">Stand With Crypto</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {visibleSwcAssets.map((asset) => {
              const imgSrc = asset.svg
                ? `/stickers/${asset.id}.svg`
                : `/stickers/${asset.id}.png`;
              const downloadHref = imgSrc;
              const downloadLabel = asset.svg ? 'Download SVG' : 'Download PNG';

              return (
                <div key={asset.id} className="card p-4 flex flex-col items-center gap-3">
                  <div className="w-full aspect-square flex items-center justify-center overflow-hidden rounded-lg bg-theme-surface p-3">
                    <img
                      src={imgSrc}
                      alt={asset.name}
                      className="max-w-full max-h-full object-contain"
                      loading="lazy"
                    />
                  </div>
                  <div className="text-center w-full">
                    <p className="text-sm font-medium text-theme-text leading-tight">{asset.name}</p>
                  </div>
                  <a
                    href={downloadHref}
                    download
                    className="flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg bg-[#6100FF]/15 text-[#6100FF] hover:bg-[#6100FF]/25 transition-colors text-sm font-medium"
                  >
                    <Download size={14} />
                    {downloadLabel}
                  </a>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Flyers Section */}
      <section>
        <h3 className="text-lg font-semibold text-theme-text mb-3">Flyers</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {FLYERS.map((flyer) => (
            <div key={flyer.id} className="card p-4 flex flex-col items-center gap-3">
              <div className="w-full aspect-[8.5/11] flex items-center justify-center overflow-hidden rounded-lg bg-theme-surface">
                <img
                  src={flyer.preview}
                  alt={flyer.name}
                  className="max-w-full max-h-full object-contain"
                  loading="lazy"
                />
              </div>
              <div className="text-center w-full">
                <p className="text-sm font-medium text-theme-text leading-tight">{flyer.name}</p>
              </div>
              <a
                href={flyer.pdf}
                download
                className="flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg bg-[#ff393a]/15 text-[#ff393a] hover:bg-[#ff393a]/25 transition-colors text-sm font-medium"
              >
                <Download size={14} />
                Download PDF
              </a>
            </div>
          ))}
        </div>
      </section>

      {/* Table Tents Section */}
      <section>
        <h3 className="text-lg font-semibold text-theme-text mb-3">Table Tents</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {TABLE_TENTS.map((tent) => (
            <div key={tent.id} className="card p-4 flex flex-col items-center gap-3">
              <div className="w-full aspect-video flex items-center justify-center overflow-hidden rounded-lg bg-theme-surface">
                <img
                  src={tent.preview}
                  alt={tent.name}
                  className="max-w-full max-h-full object-contain"
                  loading="lazy"
                />
              </div>
              <div className="text-center w-full">
                <p className="text-sm font-medium text-theme-text leading-tight">{tent.name}</p>
              </div>
              <a
                href={tent.pdf}
                download
                className="flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg bg-[#ff393a]/15 text-[#ff393a] hover:bg-[#ff393a]/25 transition-colors text-sm font-medium"
              >
                <Download size={14} />
                Download PDF
              </a>
            </div>
          ))}
        </div>
      </section>

      {/* Name Tags Section */}
      <section>
        <h3 className="text-lg font-semibold text-theme-text mb-3">Name Tags</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {NAME_TAGS.map((tag) => (
            <div key={tag.id} className="card p-4 flex flex-col items-center gap-3">
              <div className="w-full aspect-video flex items-center justify-center overflow-hidden rounded-lg bg-theme-surface">
                {tag.preview ? (
                  <img
                    src={tag.preview}
                    alt={tag.name}
                    className="max-w-full max-h-full object-contain"
                    loading="lazy"
                  />
                ) : (
                  <Tag size={48} className="text-theme-text-muted" />
                )}
              </div>
              <div className="text-center w-full">
                <p className="text-sm font-medium text-theme-text leading-tight">{tag.name}</p>
                <p className="text-xs text-theme-text-muted mt-0.5">{tag.description}</p>
              </div>
              <a
                href={tag.pdf}
                download
                className="flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg bg-[#ff393a]/15 text-[#ff393a] hover:bg-[#ff393a]/25 transition-colors text-sm font-medium"
              >
                <Download size={14} />
                Download PDF
              </a>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
