import React from 'react';

/** Single-choice pill group (instead of a raw <select>). */
export function ChoicePills<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`px-3 py-1.5 rounded-full text-sm border transition-colors min-h-[36px] ${
              active
                ? 'border-theme-accent text-theme-accent font-medium bg-theme-surface'
                : 'border-theme-stroke text-theme-text-secondary hover:text-theme-text hover:border-theme-stroke-hover'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Small muted helper line under a field (CLAUDE.md: placeholders, not labels). */
export function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-theme-text-muted mt-1">{children}</p>;
}

export function SectionCard({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-theme-text">{title}</h3>
          {subtitle && <p className="text-sm text-theme-text-secondary mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

export function ErrorBanner({ message, onClose }: { message: string | null; onClose?: () => void }) {
  if (!message) return null;
  return (
    <div role="alert" className="bg-red-500/10 border border-red-500/30 text-theme-error p-3 rounded-lg text-sm flex items-start justify-between gap-3">
      <span>{message}</span>
      {onClose && (
        <button type="button" onClick={onClose} className="text-xs underline shrink-0">Dismiss</button>
      )}
    </div>
  );
}

/** Integer from a number input, clamped; NaN -> fallback. */
export function toInt(v: string, fallback: number, min: number, max: number): number {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
