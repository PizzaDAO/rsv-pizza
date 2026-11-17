import { QRCode } from '../../QRCode';
import { SheetPage } from '../printSheet';
import { fitText, PRINT_FONT_STACK } from '../fitText';
import { tentDims, toPt, type PaperSize } from '../layouts';
import { qrCaption } from './tentPresets';

export interface TentFaceData {
  eventName: string | null;
  headline: string;
  body: string;
  dateLine: string | null;
  qrUrl: string | null;
  logoUrl: string | null;
}

/**
 * One face of the tent. The bottom panel renders it as is; the top panel renders the identical
 * face rotated 180deg, so both read correctly once the sheet is folded and stood up.
 * Padding: top = fold-side margin, bottom = page-edge margin (identical for both once rotated).
 */
export function TentFace({ paper, data }: { paper: PaperSize; data: TentFaceData }) {
  const d = tentDims(paper);
  const unit = d.unit;
  const u = (v: number) => `${v}${unit}`;
  const panelH = d.h / 2;
  const innerWpt = toPt(d.w - 2 * d.safe, unit);
  const qrSizePx = unit === 'in' ? 240 : 242; // ~2.5in / 64mm
  const head = data.headline.trim() ? fitText(data.headline, { maxWidth: innerWpt, maxSize: 64, minSize: 24, wrapBelow: 36 }) : null;

  return (
    <div
      style={{
        position: 'relative',
        width: u(d.w),
        height: u(panelH),
        boxSizing: 'border-box',
        padding: `${u(d.foldSafe)} ${u(d.safe)} ${u(d.safe)}`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: u(unit === 'in' ? 0.12 : 3),
        textAlign: 'center',
        fontFamily: PRINT_FONT_STACK,
        overflow: 'hidden',
      }}
    >
      {data.logoUrl && <img src={data.logoUrl} alt="" style={{ maxHeight: u(unit === 'in' ? 0.6 : 15), maxWidth: '40%', objectFit: 'contain' }} />}
      {data.eventName && <div style={{ fontSize: '18pt', fontWeight: 600 }}>{data.eventName}</div>}
      {head && (
        <div style={{ fontSize: `${head.size}pt`, fontWeight: 800, lineHeight: 1.1 }}>
          {head.lines.map((l, i) => (
            <div key={i} style={{ whiteSpace: 'nowrap' }}>{l}</div>
          ))}
        </div>
      )}
      {data.body.trim() && <div style={{ fontSize: '16pt', lineHeight: 1.3, whiteSpace: 'pre-wrap', maxWidth: '100%' }}>{data.body}</div>}
      {data.dateLine && <div style={{ fontSize: '12pt', color: '#333' }}>{data.dateLine}</div>}
      {data.qrUrl && (
        <div>
          <QRCode value={data.qrUrl} size={qrSizePx} margin={4} alt="" className="[image-rendering:pixelated]" />
          <div style={{ fontSize: '11pt', marginTop: u(unit === 'in' ? 0.04 : 1) }}>{qrCaption(data.qrUrl)}</div>
        </div>
      )}
    </div>
  );
}

/** One sheet: top panel upside down, fold line, bottom panel. `cropMarks` draws light ticks at the fold. */
export function TableTentPage({ paper, data, foldLine = true }: { paper: PaperSize; data: TentFaceData; foldLine?: boolean }) {
  const d = tentDims(paper);
  const panelH = d.h / 2;
  return (
    <SheetPage paper={paper}>
      <div data-tent-top style={{ position: 'absolute', left: 0, top: 0, width: `${d.w}${d.unit}`, height: `${panelH}${d.unit}`, transform: 'rotate(180deg)' }}>
        <TentFace paper={paper} data={data} />
      </div>
      <div data-tent-bottom style={{ position: 'absolute', left: 0, top: `${panelH}${d.unit}`, width: `${d.w}${d.unit}`, height: `${panelH}${d.unit}` }}>
        <TentFace paper={paper} data={data} />
      </div>
      {foldLine && (
        <div style={{ position: 'absolute', left: 0, right: 0, top: `${panelH}${d.unit}`, borderTop: '0.5pt dashed #999' }} />
      )}
    </SheetPage>
  );
}

export function TableTentSheet({ paper, data, copies, foldLine }: { paper: PaperSize; data: TentFaceData; copies: number; foldLine?: boolean }) {
  return (
    <>
      {Array.from({ length: Math.max(1, copies) }, (_, i) => (
        <TableTentPage key={i} paper={paper} data={data} foldLine={foldLine} />
      ))}
    </>
  );
}
