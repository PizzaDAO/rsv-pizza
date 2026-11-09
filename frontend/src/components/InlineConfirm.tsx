import React, { useEffect, useId, useRef } from 'react';

interface InlineConfirmProps {
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}

/**
 * basil-14648: an in-place "are you sure?" for destructive steps (cancel, release, a second order), instead of
 * window.confirm. The flow already sits in a modal on phones, so a second modal would stack; this replaces the
 * button it came from, takes focus, and Escape backs out.
 */
export const InlineConfirm: React.FC<InlineConfirmProps> = ({ message, confirmLabel, cancelLabel, onConfirm, onCancel, busy }) => {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div
      ref={ref}
      role="alertdialog"
      aria-modal="false"
      aria-describedby={id}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onCancel();
        }
      }}
      className="p-3 rounded-xl border border-theme-stroke bg-theme-surface space-y-2 outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ai-accent)]"
    >
      <p id={id} className="text-sm text-theme-text">{message}</p>
      <div className="flex flex-col sm:flex-row gap-2">
        <button type="button" className="btn-secondary w-full text-sm min-h-[44px] py-2" disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" className="btn-secondary w-full text-sm min-h-[44px] py-2" disabled={busy} onClick={onCancel}>
          {cancelLabel}
        </button>
      </div>
    </div>
  );
};
