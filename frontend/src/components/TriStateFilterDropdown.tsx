import React, { useMemo, useState } from 'react';
import { ChevronDown, ThumbsUp, ThumbsDown } from 'lucide-react';

/**
 * cornetto-58510: shared tri-state filter dropdown extracted from the inline
 * /underboss EventTable tag/country dropdowns. Thumbs-up = include / thumbs-down
 * = exclude / neutral, with an in-dropdown type-ahead search and float-active-
 * to-top ordering. Controlled: the effective include/exclude arrays are driven
 * by props; only cosmetic state (open / search / touch-order) lives internally.
 */
interface TriStateFilterDropdownProps {
  label: string;
  /** available values (unordered; component sorts + orders internally) */
  items: string[];
  includes: string[];
  excludes: string[];
  onChange: (next: { includes: string[]; excludes: string[] }) => void;
  searchPlaceholder: string;
  noMatchesLabel: string;
  clearLabel: string;
  includeLabel: string;
  excludeLabel: string;
  /** applied to the outer `relative` wrapper */
  className?: string;
  /**
   * paccheri-58541: optional friendly display label for a raw item value (e.g.
   * map 'refund' → 'Refund due'). The underlying filter value is unchanged; the
   * label is used for rendering AND type-ahead matching. Items without a mapping
   * render as-is.
   */
  labelFor?: (item: string) => string;
  /**
   * ciabatta-58921: which edge the popover anchors to. 'right' opens leftward so
   * a trigger near the right viewport edge (e.g. the last filter) doesn't clip.
   * Default 'left' preserves existing /payments behaviour.
   */
  align?: 'left' | 'right';
  /**
   * ciabatta-58921: colour scheme. 'dark' (default) = the theme-token popover
   * used on /payments + /underboss. 'light' = GPP white popover for the light
   * sky-blue /partners page.
   */
  tone?: 'dark' | 'light';
}

// Tone class maps. 'dark' reproduces the original theme-token styling exactly;
// 'light' is the GPP white variant for light-background pages.
const TONES = {
  dark: {
    triggerActive: 'bg-theme-surface border-theme-stroke-hover text-theme-text',
    triggerIdle: 'bg-theme-surface border-theme-stroke text-theme-text-secondary hover:border-theme-stroke-hover',
    panel: 'bg-theme-header border-theme-stroke',
    border: 'border-theme-stroke',
    input: 'bg-theme-surface border-theme-stroke text-theme-text placeholder:text-theme-text-faint focus:border-theme-stroke-hover',
    itemText: 'text-theme-text',
    itemHover: 'hover:bg-theme-surface',
    faint: 'text-theme-text-faint',
    neutralThumb: 'text-theme-text-faint',
  },
  light: {
    triggerActive: 'bg-white border-black/25 text-[#1a1a1a]',
    triggerIdle: 'bg-white/90 border-black/10 text-[#1a1a1a] hover:border-black/30',
    panel: 'bg-white border-black/10',
    border: 'border-black/10',
    input: 'bg-white border-black/15 text-[#1a1a1a] placeholder:text-[#555]/50 focus:border-black/30',
    itemText: 'text-[#1a1a1a]',
    itemHover: 'hover:bg-black/5',
    faint: 'text-[#555]/70',
    neutralThumb: 'text-[#999]',
  },
} as const;

export function TriStateFilterDropdown({
  label,
  items,
  includes,
  excludes,
  onChange,
  searchPlaceholder,
  noMatchesLabel,
  clearLabel,
  includeLabel,
  excludeLabel,
  className,
  labelFor,
  align = 'left',
  tone = 'dark',
}: TriStateFilterDropdownProps) {
  const t = TONES[tone];
  const displayLabel = (item: string) => (labelFor ? labelFor(item) : item);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  // touchOrder floats recently-interacted items to the top of the dropdown.
  // Purely cosmetic, owned by the component, never lifted.
  const [touchOrder, setTouchOrder] = useState<string[]>([]); // most-recently-touched first

  const availableSorted = useMemo(
    () => [...new Set(items)].sort(),
    [items],
  );

  // Dropdown ordering: floated active (include/exclude) items first (most-
  // recently touched first), then the remaining available items alphabetically.
  const orderedItems = useMemo(() => {
    const active = touchOrder.filter((x) => includes.includes(x) || excludes.includes(x));
    const rest = availableSorted.filter((x) => !active.includes(x));
    return [...active, ...rest];
  }, [availableSorted, touchOrder, includes, excludes]);

  const visibleItems = search.trim()
    ? orderedItems.filter((x) => {
        const q = search.trim().toLowerCase();
        // paccheri-58541: match the raw value OR the friendly display label.
        return x.toLowerCase().includes(q) || displayLabel(x).toLowerCase().includes(q);
      })
    : orderedItems;

  function getState(item: string): 'neutral' | 'include' | 'exclude' {
    if (includes.includes(item)) return 'include';
    if (excludes.includes(item)) return 'exclude';
    return 'neutral';
  }

  function setState(item: string, next: 'neutral' | 'include' | 'exclude') {
    const nextInc = includes.filter((k) => k !== item);
    const nextExc = excludes.filter((k) => k !== item);
    if (next === 'include') nextInc.push(item);
    else if (next === 'exclude') nextExc.push(item);
    setTouchOrder((p) => [item, ...p.filter((k) => k !== item)]); // float to top
    onChange({ includes: nextInc, excludes: nextExc });
  }

  function clear() {
    setTouchOrder([]);
    onChange({ includes: [], excludes: [] });
  }

  function closePanel() {
    setOpen(false);
    setSearch('');
  }

  const activeTotal = includes.length + excludes.length;

  return (
    <div className={`relative ${className ?? ''}`}>
      <button
        onClick={() => setOpen((v) => { if (v) setSearch(''); return !v; })}
        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
          activeTotal > 0 ? t.triggerActive : t.triggerIdle
        }`}
      >
        {activeTotal > 0 ? `${label} (${activeTotal})` : label}
        <ChevronDown size={14} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={closePanel} />
          <div className={`absolute top-full ${align === 'right' ? 'right-0' : 'left-0'} mt-1 z-50 w-64 border rounded-lg shadow-xl py-1 ${t.panel}`}>
            {(includes.length > 0 || excludes.length > 0) && (
              <div className={`flex items-center justify-end px-3 py-1.5 border-b ${t.border}`}>
                <button onClick={clear} className="text-xs text-red-500/70 hover:text-red-500 transition-colors">{clearLabel}</button>
              </div>
            )}
            <div className={`px-2 py-1.5 border-b ${t.border}`}>
              <input
                type="text"
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                className={`w-full border rounded-md px-2 py-1 text-sm focus:outline-none ${t.input}`}
              />
            </div>
            <div className="max-h-80 overflow-y-auto py-1">
              {visibleItems.length === 0 && (
                <div className={`px-3 py-2 text-sm ${t.faint}`}>{noMatchesLabel}</div>
              )}
              {visibleItems.map((item, i) => {
                const state = getState(item);
                const activeCount = orderedItems.filter((x) => includes.includes(x) || excludes.includes(x)).length;
                const showDivider = !search.trim() && activeCount > 0 && i === activeCount && activeCount < orderedItems.length;
                return (
                  <React.Fragment key={item}>
                    {showDivider && <div className={`border-t my-1 ${t.border}`} />}
                    <div className={`flex items-center justify-between gap-2 px-3 py-1.5 transition-colors ${t.itemHover}`}>
                      <span className={`text-sm truncate ${t.itemText}`}>{displayLabel(item)}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => setState(item, state === 'include' ? 'neutral' : 'include')}
                          className="p-1 hover:opacity-70 transition-opacity"
                          aria-label={includeLabel}
                          title={includeLabel}
                        >
                          <ThumbsUp size={13} className={`transition-all ${state === 'include' ? 'text-[#39d98a]' : t.neutralThumb}`} />
                        </button>
                        <button
                          onClick={() => setState(item, state === 'exclude' ? 'neutral' : 'exclude')}
                          className="p-1 hover:opacity-70 transition-opacity"
                          aria-label={excludeLabel}
                          title={excludeLabel}
                        >
                          <ThumbsDown size={13} className={`transition-all ${state === 'exclude' ? 'text-[#ff393a]' : t.neutralThumb}`} />
                        </button>
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
