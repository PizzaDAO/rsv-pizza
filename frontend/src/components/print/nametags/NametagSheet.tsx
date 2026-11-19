import { QRCode } from '../../QRCode';
import { SheetPage } from '../printSheet';
import { fitText, PRINT_FONT_STACK } from '../fitText';
import { paginate, slotPosition, toPt, type SheetLayout } from '../layouts';
import { qrCaption } from '../tents/tentPresets';
import { splitName, type Badge } from './nametagData';

export interface BadgeHeader {
  title: string;
  logoUrl: string | null;
  /** First name big, last name small (Latin-script names with 2+ words only). */
  splitName?: boolean;
  /** Optional QR in the bottom corner (event page or custom http(s) link). */
  qrUrl?: string | null;
}

export type OutlineMode = 'cut' | 'preview' | 'none';

const u = (v: number, layout: SheetLayout) => `${v}${layout.unit}`;

function outlineStyle(mode: OutlineMode) {
  if (mode === 'cut') return '0.5pt dashed #666';
  if (mode === 'preview') return '1px dashed #cfcfcf';
  return 'none';
}

export function BadgeLabel({
  badge,
  layout,
  header,
  pronouns,
}: {
  badge: Badge;
  layout: SheetLayout;
  header: BadgeHeader;
  pronouns?: string;
}) {
  const pad = layout.unit === 'in' ? 0.12 : 3;
  const headerH = layout.unit === 'in' ? 0.42 : 10.5;
  const widthPt = toPt(layout.labelW - 2 * pad, layout.unit);
  const second = [pronouns?.trim(), badge.role].filter(Boolean).join(' · ');
  const inch = layout.unit === 'in';
  // Bigger labels (4x3in inserts) allow bigger names; QR + caption reserve the bottom strip.
  const sizeScale = (inch ? layout.labelW * 25.4 : layout.labelW) / 85.7;
  const maxSize = Math.max(34, Math.min(52, Math.round(40 * sizeScale)));
  const qrSize = inch ? 0.8 : 20;
  const qrCaptionH = inch ? 0.13 : 3.3;
  const qrReserve = header.qrUrl ? qrSize + qrCaptionH + (inch ? 0.04 : 1) : 0;
  const availPt = toPt(layout.labelH - headerH - qrReserve - (inch ? 0.1 : 2.5), layout.unit) - (second ? 17 : 0);
  const parts = !badge.blank && badge.name && header.splitName ? splitName(badge.name) : null;

  let fit: { size: number; lines: string[] } | null = null;
  let lastFit: { size: number; lines: string[] } | null = null;
  if (!badge.blank && badge.name) {
    if (parts) {
      fit = fitText(parts.first, { maxWidth: widthPt, maxSize: Math.min(maxSize, Math.max(14, Math.floor(availPt / 1.75))), wrapBelow: 14 });
      const lastMax = Math.max(10, Math.floor(fit.size * 0.5));
      lastFit = fitText(parts.last, { maxWidth: widthPt, maxSize: lastMax, minSize: 9, wrapBelow: 9, weight: 500 });
    } else {
      fit = fitText(badge.name, { maxWidth: widthPt, maxSize: Math.min(maxSize, Math.max(14, Math.floor(availPt / 1.15))) });
      if (fit.lines.length > 1 && fit.size * 1.1 * fit.lines.length > availPt) fit = { ...fit, size: Math.max(12, Math.floor(availPt / 2.3)) };
    }
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', fontFamily: PRINT_FONT_STACK }}>
      <div
        style={{
          height: u(headerH, layout),
          display: 'flex',
          alignItems: 'center',
          gap: u(pad / 2, layout),
          padding: `0 ${u(pad, layout)}`,
          borderBottom: '0.75pt solid #000',
          boxSizing: 'border-box',
          overflow: 'hidden',
        }}
      >
        {header.logoUrl && (
          <img src={header.logoUrl} alt="" style={{ height: '70%', width: 'auto', maxWidth: '25%', objectFit: 'contain' }} />
        )}
        <span style={{ fontSize: '10pt', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{header.title}</span>
      </div>
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: `0 ${u(pad, layout)} ${u(qrReserve, layout)}`,
          textAlign: 'center',
          overflow: 'hidden',
        }}
      >
        {fit ? (
          <>
            <div data-badge-name style={{ fontSize: `${fit.size}pt`, fontWeight: 700, lineHeight: 1.1 }}>
              {fit.lines.map((l, i) => (
                <div key={i} style={{ whiteSpace: 'nowrap' }}>{l}</div>
              ))}
            </div>
            {lastFit && (
              <div data-badge-last style={{ fontSize: `${lastFit.size}pt`, fontWeight: 500, lineHeight: 1.15 }}>
                {lastFit.lines.map((l, i) => (
                  <div key={i} style={{ whiteSpace: 'nowrap' }}>{l}</div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div data-blank-line style={{ width: '85%', borderBottom: '1pt solid #000', height: header.qrUrl ? u(inch ? 0.3 : 7, layout) : '0.5in', marginTop: header.qrUrl ? 0 : '0.3in' }} />
        )}
        {second && fit && <div style={{ fontSize: '12pt', marginTop: '0.05in', fontWeight: 500 }}>{second}</div>}
      </div>
      {header.qrUrl && (
        <div
          data-badge-qr
          style={{
            position: 'absolute',
            right: u(pad, layout),
            bottom: u(inch ? 0.08 : 2, layout),
            width: u(qrSize, layout),
            textAlign: 'center',
          }}
        >
          <QRCode
            value={header.qrUrl}
            size={240}
            margin={1}
            alt=""
            style={{ display: 'block', width: u(qrSize, layout), height: u(qrSize, layout), imageRendering: 'pixelated' }}
          />
          <div style={{ fontSize: '5.5pt', lineHeight: `${u(qrCaptionH, layout)}`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: u(qrSize + (inch ? 0.3 : 8), layout), marginLeft: u(-(inch ? 0.15 : 4), layout) }}>
            {qrCaption(header.qrUrl)}
          </div>
        </div>
      )}
    </div>
  );
}

/** One page of badges at their exact slot positions. */
export function NametagPage({
  layout,
  badges,
  header,
  outline,
  pronouns,
}: {
  layout: SheetLayout;
  badges: Badge[];
  header: BadgeHeader;
  outline: OutlineMode;
  pronouns?: Record<string, string>;
}) {
  return (
    <SheetPage paper={layout.page}>
      {badges.map((b, i) => {
        const p = slotPosition(layout, i);
        return (
          <div
            key={b.key}
            data-badge
            style={{
              position: 'absolute',
              left: u(p.x, layout),
              top: u(p.y, layout),
              width: u(layout.labelW, layout),
              height: u(layout.labelH, layout),
              boxSizing: 'border-box',
              border: outlineStyle(outline),
              overflow: 'hidden',
            }}
          >
            <BadgeLabel badge={b} layout={layout} header={header} pronouns={pronouns?.[b.key]} />
          </div>
        );
      })}
    </SheetPage>
  );
}

/** Whole job (every page) -- used inside the print portal. */
export function NametagSheet({
  layout,
  badges,
  header,
  outline,
  pronouns,
}: {
  layout: SheetLayout;
  badges: Badge[];
  header: BadgeHeader;
  outline: OutlineMode;
  pronouns?: Record<string, string>;
}) {
  return (
    <>
      {paginate(badges, layout).map((page, i) => (
        <NametagPage key={i} layout={layout} badges={page} header={header} outline={outline} pronouns={pronouns} />
      ))}
    </>
  );
}

/** One page with only label outlines and a ruler, to check against the real label sheet. */
export function AlignmentTestPage({ layout, text, rulerLabel }: { layout: SheetLayout; text: string; rulerLabel: string }) {
  const n = layout.cols * layout.rows;
  const ruler = layout.unit === 'in' ? 1 : 25;
  return (
    <SheetPage paper={layout.page}>
      {Array.from({ length: n }, (_, i) => {
        const p = slotPosition(layout, i);
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: u(p.x, layout),
              top: u(p.y, layout),
              width: u(layout.labelW, layout),
              height: u(layout.labelH, layout),
              boxSizing: 'border-box',
              border: '0.5pt solid #000',
              fontFamily: PRINT_FONT_STACK,
              fontSize: '9pt',
              padding: '2mm',
            }}
          >
            {i + 1}
          </div>
        );
      })}
      <div style={{ position: 'absolute', left: u(layout.marginLeft, layout), top: u(layout.marginTop / 2 - (layout.unit === 'in' ? 0.05 : 1.5), layout), fontFamily: PRINT_FONT_STACK, fontSize: '8pt' }}>
        {text}
      </div>
      <div style={{ position: 'absolute', right: u(layout.marginLeft, layout), top: u(layout.marginTop / 2 - (layout.unit === 'in' ? 0.05 : 1.5), layout), fontFamily: PRINT_FONT_STACK, fontSize: '8pt', textAlign: 'right' }}>
        <div style={{ width: u(ruler, layout), borderTop: '0.5pt solid #000', marginLeft: 'auto' }} />
        {rulerLabel}
      </div>
    </SheetPage>
  );
}
