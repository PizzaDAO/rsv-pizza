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
  /** What the QR encodes (URL, or a WIFI: payload). */
  qrUrl: string | null;
  /** Text under the QR; defaults to the short URL. Never the wifi password. */
  qrCaptionText?: string | null;
  /** The QR payload is a secret (wifi password): keep it out of the DOM and never caption it. */
  qrSensitive?: boolean;
  logoUrl: string | null;
  /** Sponsor logo URLs (only ever filled when the viewer has Partners access). Max 8 shown. */
  sponsorLogos?: string[];
}

export const MAX_TENT_SPONSORS = 8;

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
  const head = data.headline.trim() ? fitText(data.headline, { maxWidth: innerWpt, maxSize: 44, minSize: 24, wrapBelow: 30 }) : null;
  const sponsors = (data.sponsorLogos ?? []).slice(0, MAX_TENT_SPONSORS);
  const fixed = { flexShrink: 0, maxWidth: '100%' } as const;
  const clamp = (n: number) =>
    ({ display: '-webkit-box', WebkitLineClamp: n, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }) as const;

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
        gap: u(unit === 'in' ? 0.1 : 2.5),
        textAlign: 'center',
        fontFamily: PRINT_FONT_STACK,
        overflow: 'hidden',
      }}
    >
      {data.logoUrl && <img data-tent-logo src={data.logoUrl} alt="" style={{ ...fixed, maxHeight: u(unit === 'in' ? 0.4 : 10), maxWidth: '40%', objectFit: 'contain' }} />}
      {data.eventName && <div style={{ ...fixed, ...clamp(2), fontSize: '16pt', fontWeight: 600 }}>{data.eventName}</div>}
      {head && (
        <div style={{ ...fixed, fontSize: `${head.size}pt`, fontWeight: 800, lineHeight: 1.1 }}>
          {head.lines.map((l, i) => (
            <div key={i} style={{ whiteSpace: 'nowrap' }}>{l}</div>
          ))}
        </div>
      )}
      {data.body.trim() && <div style={{ ...fixed, ...clamp(3), fontSize: '13pt', lineHeight: 1.3, whiteSpace: 'pre-wrap' }}>{data.body}</div>}
      {data.dateLine && <div style={{ ...fixed, ...clamp(1), fontSize: '11pt', color: '#333' }}>{data.dateLine}</div>}
      {data.qrUrl && (
        <div data-tent-qr style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0, maxHeight: u(unit === 'in' ? 2.5 : 64), width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0, width: '100%', position: 'relative' }}>
            <QRCode value={data.qrUrl} size={480} margin={4} alt="" exposeValue={!data.qrSensitive} style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', height: '100%', width: 'auto', maxWidth: '100%', objectFit: 'contain', imageRendering: 'pixelated' }} />
          </div>
          <div style={{ flexShrink: 0, ...clamp(1), fontSize: '10pt', marginTop: u(unit === 'in' ? 0.03 : 1), maxWidth: '100%' }}>{data.qrCaptionText ?? (data.qrSensitive ? '' : qrCaption(data.qrUrl))}</div>
        </div>
      )}
      {sponsors.length > 0 && (
        <div
          data-tent-sponsors
          style={{
            ...fixed,
            width: '100%',
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            alignItems: 'center',
            gap: u(unit === 'in' ? 0.1 : 2.5),
          }}
        >
          {sponsors.map((src, i) => (
            <img
              key={`${src}-${i}`}
              data-tent-sponsor
              src={src}
              alt=""
              style={{
                // 4 per row at most: (100% - 3 gaps) / 4
                flex: '0 0 auto',
                height: u(unit === 'in' ? 0.45 : 11),
                width: `calc((100% - ${u(unit === 'in' ? 0.3 : 7.5)}) / 4)`,
                objectFit: 'contain',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** One sheet: top panel upside down, fold line, bottom panel. `cropMarks` draws light ticks at the fold. */
export function TableTentPage({ paper, data, backData, foldLine = true }: { paper: PaperSize; data: TentFaceData; backData?: TentFaceData; foldLine?: boolean }) {
  const d = tentDims(paper);
  const panelH = d.h / 2;
  return (
    <SheetPage paper={paper}>
      <div data-tent-top style={{ position: 'absolute', left: 0, top: 0, width: `${d.w}${d.unit}`, height: `${panelH}${d.unit}`, transform: 'rotate(180deg)' }}>
        <TentFace paper={paper} data={backData ?? data} />
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

export function TableTentSheet({ paper, data, backData, copies, foldLine }: { paper: PaperSize; data: TentFaceData; backData?: TentFaceData; copies: number; foldLine?: boolean }) {
  return (
    <>
      {Array.from({ length: Math.max(1, copies) }, (_, i) => (
        <TableTentPage key={i} paper={paper} data={data} backData={backData} foldLine={foldLine} />
      ))}
    </>
  );
}
