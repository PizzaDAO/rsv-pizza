import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { pageDims, pageSizeCss, toPx, type PaperSize } from './layouts';

/**
 * Shared print plumbing for the badge and table-tent builders.
 *
 * - `PrintPortal` mounts the full sheet set in `#print-root` on document.body (outside HostPage's
 *   themed/overflow containers) together with a print-only `@page` rule that hides everything
 *   else. It is only mounted while printing, so big guest lists don't cost anything on screen.
 * - `usePrintSheets()` mounts the portal, waits for images/QR/fonts, then calls window.print().
 * - `SheetPage` is one fixed-size page; `PrintPreview` shows scaled copies on screen.
 */

export const PRINT_ROOT_ID = 'print-root';

export function PrintPortal({ paper, children }: { paper: PaperSize; children: ReactNode }) {
  const [el] = useState(() => {
    const d = document.createElement('div');
    d.id = PRINT_ROOT_ID;
    return d;
  });
  useLayoutEffect(() => {
    document.body.appendChild(el);
    return () => {
      el.remove();
    };
  }, [el]);
  const css = `
#${PRINT_ROOT_ID} { display: none; }
@page { size: ${pageSizeCss(paper)}; margin: 0; }
@media print {
  html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; height: auto !important; overflow: visible !important; }
  body > *:not(#${PRINT_ROOT_ID}) { display: none !important; }
  #${PRINT_ROOT_ID} { display: block !important; background: #fff; color: #000; }
  #${PRINT_ROOT_ID} > [data-sheet-page]:last-of-type { break-after: auto !important; page-break-after: auto !important; }
}`;
  return createPortal(
    <>
      <style>{css}</style>
      {children}
    </>,
    el,
  );
}

async function waitForAssets(): Promise<void> {
  const root = document.getElementById(PRINT_ROOT_ID);
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  if (!root) return;
  // QR codes render asynchronously (data URL); wait for them, up to ~3s.
  for (let i = 0; i < 30 && root.querySelector('[data-qr-pending]'); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  await Promise.all(
    Array.from(root.querySelectorAll('img')).map((img) => (img.decode ? img.decode().catch(() => undefined) : Promise.resolve())),
  );
  try {
    await document.fonts?.ready;
  } catch {
    /* ignore */
  }
}

/** `print(paper)` mounts the sheets (render `<PrintPortal>` while `printing` is set) then opens the print dialog. */
export function usePrintSheets() {
  const [printing, setPrinting] = useState<PaperSize | null>(null);
  const print = useCallback((paper: PaperSize) => setPrinting(paper), []);

  useEffect(() => {
    if (!printing) return;
    let cancelled = false;
    const done = () => setPrinting(null);
    window.addEventListener('afterprint', done);
    // iOS Safari fires afterprint unreliably.
    const fallback = window.setTimeout(done, 120000);
    (async () => {
      await waitForAssets();
      if (!cancelled) window.print();
    })();
    return () => {
      cancelled = true;
      window.removeEventListener('afterprint', done);
      window.clearTimeout(fallback);
    };
  }, [printing]);

  return { printing, print };
}

/** One page: fixed physical size, white, exact colours. Pages break after themselves except the last. */
export function SheetPage({ paper, children, style }: { paper: PaperSize; children: ReactNode; style?: CSSProperties }) {
  const d = pageDims(paper);
  return (
    <div
      data-sheet-page
      style={{
        position: 'relative',
        width: `${d.w}${d.unit}`,
        height: `${d.h}${d.unit}`,
        overflow: 'hidden',
        background: '#fff',
        color: '#000',
        boxSizing: 'border-box',
        breakAfter: 'page',
        pageBreakAfter: 'always',
        WebkitPrintColorAdjust: 'exact',
        printColorAdjust: 'exact',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

const MAX_PREVIEW_PAGES = 3;

/** Scaled on-screen copies of the first few pages. `renderPage(i)` must return a `SheetPage`. */
export function PrintPreview({
  paper,
  pageCount,
  renderPage,
  moreLabel,
}: {
  paper: PaperSize;
  pageCount: number;
  renderPage: (i: number) => ReactNode;
  moreLabel?: (shown: number, total: number) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth || 320);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || 320));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const d = pageDims(paper);
  const pw = toPx(d.w, d.unit);
  const ph = toPx(d.h, d.unit);
  const scale = Math.min(1, Math.max(0.2, width / pw));
  const shown = Math.min(pageCount, MAX_PREVIEW_PAGES);

  return (
    <div ref={ref} className="w-full space-y-3" data-testid="print-preview">
      {Array.from({ length: shown }, (_, i) => (
        <div
          key={i}
          className="mx-auto shadow-lg border border-white/10"
          style={{ width: pw * scale, height: ph * scale, overflow: 'hidden' }}
        >
          <div style={{ width: pw, height: ph, transform: `scale(${scale})`, transformOrigin: 'top left' }}>{renderPage(i)}</div>
        </div>
      ))}
      {pageCount > shown && moreLabel && <p className="text-xs text-theme-text-muted text-center">{moreLabel(shown, pageCount)}</p>}
    </div>
  );
}
