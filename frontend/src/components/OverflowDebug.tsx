import { useEffect, useState } from 'react';

interface WideElement {
  tag: string;
  cls: string;
  text: string;
  right: number;
  width: number;
  parents: string;
}

function describe(el: HTMLElement): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : '';
  const cls = (typeof el.className === 'string' && el.className)
    ? '.' + el.className.split(/\s+/).filter(Boolean).join('.')
    : '';
  return `${tag}${id}${cls}`;
}

function hasClippingAncestor(el: HTMLElement): boolean {
  let p: HTMLElement | null = el.parentElement;
  while (p && p !== document.body) {
    const cs = getComputedStyle(p);
    if (cs.overflowX === 'hidden' || cs.overflowX === 'clip' || cs.overflow === 'hidden' || cs.overflow === 'clip') {
      return true;
    }
    p = p.parentElement;
  }
  return false;
}

function parentChain(el: HTMLElement, depth = 3): string {
  const chain: string[] = [];
  let p: HTMLElement | null = el.parentElement;
  while (p && p !== document.body && chain.length < depth) {
    chain.push(describe(p).slice(0, 60));
    p = p.parentElement;
  }
  return chain.join(' > ');
}

/** TEMPORARY DEBUG (bismarck-58392) v2 — list elements that visibly extend past viewport
 *  (i.e. NOT inside an overflow:hidden|clip ancestor). Includes parent chain for context. */
export const OverflowDebug = () => {
  const [items, setItems] = useState<WideElement[]>([]);
  const [meta, setMeta] = useState({ vw: 0, bodyScrollW: 0, bodyClientW: 0, htmlScrollW: 0 });

  useEffect(() => {
    const scan = () => {
      const vw = window.innerWidth;
      const body = document.body;
      const html = document.documentElement;
      setMeta({
        vw,
        bodyScrollW: body.scrollWidth,
        bodyClientW: body.clientWidth,
        htmlScrollW: html.scrollWidth,
      });
      const found: WideElement[] = [];
      const allEls = document.querySelectorAll<HTMLElement>('body *');
      allEls.forEach((el) => {
        if (el.closest('[data-overflow-debug]')) return;
        const rect = el.getBoundingClientRect();
        if (rect.right <= vw + 1) return;
        if (rect.width <= 1) return;
        if (hasClippingAncestor(el)) return;  // visually clipped — skip
        const tag = el.tagName.toLowerCase();
        const cls = (typeof el.className === 'string' && el.className) ? el.className.slice(0, 80) : '';
        const txt = (el.textContent || '').trim().slice(0, 40).replace(/\s+/g, ' ');
        found.push({
          tag,
          cls,
          text: txt,
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          parents: parentChain(el, 3),
        });
      });
      const dedup = new Map<string, WideElement>();
      for (const it of found) {
        const key = `${it.tag}|${it.cls}|${it.width}`;
        const prev = dedup.get(key);
        if (!prev || it.right > prev.right) dedup.set(key, it);
      }
      const sorted = Array.from(dedup.values()).sort((a, b) => b.right - a.right).slice(0, 20);
      setItems(sorted);
    };
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
        maxHeight: '60vh',
        overflowY: 'auto',
        background: 'rgba(0,0,0,0.92)',
        color: '#fff',
        font: '10px ui-monospace, monospace',
        padding: 8,
        borderRadius: 8,
        zIndex: 999999,
        border: '2px solid #ff0',
      }}
    >
      <div style={{ color: '#ff0', marginBottom: 4 }}>
        OVERFLOW DEBUG v2 — vw={meta.vw}px body.scrollW={meta.bodyScrollW}px html.scrollW={meta.htmlScrollW}px — {items.length} unclipped wide elements
      </div>
      {items.length === 0 && (
        <div style={{ color: '#9f9' }}>No unclipped overflowing elements. Body/html scrollWidth may still exceed vw — check the numbers above.</div>
      )}
      {items.map((it, i) => (
        <div key={i} style={{ borderBottom: '1px solid #333', padding: '4px 0' }}>
          <div>
            <span style={{ color: '#f99' }}>right={it.right}px</span>
            {' '}<span style={{ color: '#9f9' }}>w={it.width}px</span>
            {' '}<span style={{ color: '#ffa' }}>{it.tag}</span>
            {it.text && <span style={{ color: '#aaf' }}> "{it.text}"</span>}
          </div>
          <div style={{ color: '#ccc', paddingLeft: 8 }}>{it.cls}</div>
          <div style={{ color: '#888', paddingLeft: 8 }}>↑ {it.parents}</div>
        </div>
      ))}
    </div>
  );
};
