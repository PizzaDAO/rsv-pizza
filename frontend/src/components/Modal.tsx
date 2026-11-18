import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export interface ModalProps {
  onClose: () => void;
  children: React.ReactNode;
  /** id of the visible heading inside the modal (preferred). */
  labelledBy?: string;
  /** Accessible name when the modal has no visible heading to point at. */
  ariaLabel?: string;
  /** Classes for the dialog panel (default matches LoginModal). */
  panelClassName?: string;
  /** Extra classes for the fixed backdrop (z-index, tint, ...). */
  backdropClassName?: string;
  /** Render the built-in top-right close button (default true). */
  showClose?: boolean;
  /** Clicking the backdrop closes the modal (default true). */
  closeOnBackdrop?: boolean;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Shared accessible modal: portal, fixed backdrop (z-50), click-outside + Esc close, focus trap,
 * focus return to the previously focused element, role=dialog aria-modal.
 * Render it conditionally (`{open && <Modal ...>}`); it mounts/unmounts with the dialog.
 */
export function Modal({
  onClose,
  children,
  labelledBy,
  ariaLabel,
  panelClassName = 'card p-8 max-w-md w-full relative',
  backdropClassName = 'z-50 bg-black/60 backdrop-blur-sm',
  showClose = true,
  closeOnBackdrop = true,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // Move focus into the dialog unless a child (e.g. an autoFocus input) already has it.
    if (panel && !panel.contains(document.activeElement)) {
      const first = panel.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panel).focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden',
      );
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
  }, []);

  return createPortal(
    <div
      className={`fixed inset-0 flex items-center justify-center p-4 ${backdropClassName}`}
      onClick={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onCloseRef.current();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabel ? undefined : labelledBy}
        aria-label={ariaLabel}
        tabIndex={-1}
        className={`${panelClassName} focus:outline-none`}
      >
        {showClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute top-4 right-4 text-theme-text-muted hover:text-theme-text transition-colors"
          >
            <X size={24} />
          </button>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
