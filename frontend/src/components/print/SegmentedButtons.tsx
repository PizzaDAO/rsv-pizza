interface Option<T extends string> {
  value: T;
  label: string;
}

/** Pill-style single-choice toggle (source, layout, paper, preset, ...). */
export function SegmentedButtons<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            value === o.value ? 'bg-[#ff393a] text-white' : 'bg-theme-surface text-theme-text-muted hover:text-theme-text'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
