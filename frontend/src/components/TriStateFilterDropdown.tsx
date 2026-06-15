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
}

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
}: TriStateFilterDropdownProps) {
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
          activeTotal > 0
            ? 'bg-theme-surface border-theme-stroke-hover text-theme-text'
            : 'bg-theme-surface border-theme-stroke text-theme-text-secondary hover:border-theme-stroke-hover'
        }`}
      >
        {activeTotal > 0 ? `${label} (${activeTotal})` : label}
        <ChevronDown size={14} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={closePanel} />
          <div className="absolute top-full left-0 mt-1 z-50 w-64 bg-theme-header border border-theme-stroke rounded-lg shadow-xl py-1">
            {(includes.length > 0 || excludes.length > 0) && (
              <div className="flex items-center justify-end px-3 py-1.5 border-b border-theme-stroke">
                <button onClick={clear} className="text-xs text-red-500/70 hover:text-red-500 transition-colors">{clearLabel}</button>
              </div>
            )}
            <div className="px-2 py-1.5 border-b border-theme-stroke">
              <input
                type="text"
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full bg-theme-surface border border-theme-stroke rounded-md px-2 py-1 text-sm text-theme-text placeholder:text-theme-text-faint focus:outline-none focus:border-theme-stroke-hover"
              />
            </div>
            <div className="max-h-80 overflow-y-auto py-1">
              {visibleItems.length === 0 && (
                <div className="px-3 py-2 text-sm text-theme-text-faint">{noMatchesLabel}</div>
              )}
              {visibleItems.map((item, i) => {
                const state = getState(item);
                const activeCount = orderedItems.filter((x) => includes.includes(x) || excludes.includes(x)).length;
                const showDivider = !search.trim() && activeCount > 0 && i === activeCount && activeCount < orderedItems.length;
                return (
                  <React.Fragment key={item}>
                    {showDivider && <div className="border-t border-theme-stroke my-1" />}
                    <div className="flex items-center justify-between gap-2 px-3 py-1.5 hover:bg-theme-surface transition-colors">
                      <span className="text-sm text-theme-text truncate">{displayLabel(item)}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => setState(item, state === 'include' ? 'neutral' : 'include')}
                          className="p-1 hover:opacity-70 transition-opacity"
                          aria-label={includeLabel}
                          title={includeLabel}
                        >
                          <ThumbsUp size={13} className={`transition-all ${state === 'include' ? 'text-[#39d98a]' : 'text-theme-text-faint'}`} />
                        </button>
                        <button
                          onClick={() => setState(item, state === 'exclude' ? 'neutral' : 'exclude')}
                          className="p-1 hover:opacity-70 transition-opacity"
                          aria-label={excludeLabel}
                          title={excludeLabel}
                        >
                          <ThumbsDown size={13} className={`transition-all ${state === 'exclude' ? 'text-[#ff393a]' : 'text-theme-text-faint'}`} />
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
