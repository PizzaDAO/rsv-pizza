import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface CollapsibleCardProps {
  /** Unique key for localStorage, e.g. 'pizza', 'music'. */
  id: string;
  /** Party ID — collapse state is persisted per party. */
  partyId: string;
  /** Card title shown in the collapsed strip. */
  title: string;
  /** Default to expanded if no persisted state exists. */
  defaultOpen?: boolean;
  /** The original card (with its own `card` shell). */
  children: React.ReactNode;
}

/**
 * prosciutto-78201: Lightweight wrapper that makes a Day-of dashboard card
 * collapsible. The wrapper is purely additive — the existing card retains
 * its own visual shell when expanded; the chevron sits absolutely in the
 * top-right corner so we don't double up the `card` outline.
 *
 * When collapsed, we replace the card entirely with a thin strip showing
 * just the title and chevron so the host can re-open it.
 *
 * Persistence key: `dayof.collapsed.{id}.{partyId}` in localStorage.
 *   '1' = collapsed, '0' or missing = open.
 */
export const CollapsibleCard: React.FC<CollapsibleCardProps> = ({
  id,
  partyId,
  title,
  defaultOpen = true,
  children,
}) => {
  const storageKey = `dayof.collapsed.${id}.${partyId}`;

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    // Initialise from localStorage so we don't flash the open state before
    // hydrating. SSR-safe: window check.
    if (typeof window === 'undefined') return !defaultOpen;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw === '1') return true;
      if (raw === '0') return false;
    } catch {
      /* ignore */
    }
    return !defaultOpen;
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsed, storageKey]);

  const toggle = () => setCollapsed((c) => !c);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-expanded={false}
        aria-label={`Expand ${title}`}
        className="card w-full flex items-center justify-between px-5 py-3 text-left hover:bg-white/5 transition-colors"
      >
        <span className="text-sm font-medium text-theme-text-secondary">{title}</span>
        <ChevronDown size={16} className="text-theme-text-secondary" />
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={true}
        aria-label={`Collapse ${title}`}
        className="absolute top-3 right-3 z-10 inline-flex items-center justify-center rounded p-1 text-theme-text-secondary hover:text-theme-text hover:bg-white/10 transition-colors"
      >
        <ChevronUp size={16} />
      </button>
      {children}
    </div>
  );
};
