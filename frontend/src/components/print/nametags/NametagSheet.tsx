import { SheetPage } from '../printSheet';
import { fitText, PRINT_FONT_STACK } from '../fitText';
import { paginate, slotPosition, toPt, type SheetLayout } from '../layouts';
import type { Badge } from './nametagData';

export interface BadgeHeader {
  title: string;
  logoUrl: string | null;
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
  const fit = badge.blank || !badge.name ? null : fitText(badge.name, { maxWidth: widthPt });
  const second = [pronouns?.trim(), badge.role].filter(Boolean).join(' · ');

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', fontFamily: PRINT_FONT_STACK }}>
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
          padding: `0 ${u(pad, layout)}`,
          textAlign: 'center',
          overflow: 'hidden',
        }}
      >
        {fit ? (
          <div style={{ fontSize: `${fit.size}pt`, fontWeight: 700, lineHeight: 1.1 }}>
            {fit.lines.map((l, i) => (
              <div key={i} style={{ whiteSpace: 'nowrap' }}>{l}</div>
            ))}
          </div>
        ) : (
          <div data-blank-line style={{ width: '85%', borderBottom: '1pt solid #000', height: '0.5in', marginTop: '0.3in' }} />
        )}
        {second && fit && <div style={{ fontSize: '12pt', marginTop: '0.05in', fontWeight: 500 }}>{second}</div>}
      </div>
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
