import { useEffect, useState } from 'react';

interface WideElement {
  selector: string;
  right: number;
  width: number;
}

/** TEMPORARY DEBUG (bismarck-58392): list elements whose right edge exceeds the viewport.
 *  Renders a fixed overlay on the bottom-left. Remove before merging. */
export const OverflowDebug = () => {
  const [items, setItems] = useState<WideElement[]>([]);
  const [vw, setVw] = useState(0);

  useEffect(() => {
    const scan = () => {
      const viewportWidth = window.innerWidth;
      setVw(viewportWidth);
      const found: WideElement[] = [];
      const allEls = document.querySelectorAll<HTMLElement>('body *');
      allEls.forEach((el) => {
        // skip our own debug overlay
        if (el.closest('[data-overflow-debug]')) return;
        const rect = el.getBoundingClientRect();
        if (rect.right > viewportWidth + 1 && rect.width > 1) {
          const tag = el.tagName.toLowerCase();
          const id = el.id ? `#${el.id}` : '';
          const cls = el.className && typeof el.className === 'string'
            ? '.' + el.className.split(/\s+/).filter(Boolean).slice(0, 3).join('.')
            : '';
          found.push({
            selector: `${tag}${id}${cls}`.slice(0, 80),
            right: Math.round(rect.right),
            width: Math.round(rect.width),
          });
        }
      });
      // dedupe by selector, keep widest
      const dedup = new Map<string, WideElement>();
      for (const it of found) {
        const prev = dedup.get(it.selector);
        if (!prev || it.width > prev.width) dedup.set(it.selector, it);
      }
      const sorted = Array.from(dedup.values()).sort((a, b) => b.right - a.right).slice(0, 15);
      setItems(sorted);
    };
    // scan after paint + a small delay for images/async content
    const t1 = setTimeout(scan, 500);
    const t2 = setTimeout(scan, 2000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  return (
    <div
      data-overflow-debug
      style={{
        position: 'fixed',
        bottom: 8,
        left: 8,
        right: 8,
        maxHeight: '40vh',
        overflowY: 'auto',
        background: 'rgba(0,0,0,0.85)',
        color: '#fff',
        font: '11px ui-monospace, monospace',
        padding: 8,
        borderRadius: 8,
        zIndex: 999999,
        border: '2px solid #ff0',
      }}
    >
      <div style={{ color: '#ff0', marginBottom: 4 }}>
        OVERFLOW DEBUG — vw={vw}px — {items.length} wide elements
      </div>
      {items.map((it, i) => (
        <div key={i} style={{ borderBottom: '1px solid #333', padding: '2px 0' }}>
          <span style={{ color: '#f99' }}>right={it.right}px</span>
          {' '}<span style={{ color: '#9f9' }}>w={it.width}px</span>
          {' '}<span style={{ color: '#fff' }}>{it.selector}</span>
        </div>
      ))}
    </div>
  );
};
