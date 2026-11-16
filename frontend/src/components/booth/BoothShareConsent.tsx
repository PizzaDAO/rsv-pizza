import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { Checkbox } from '../Checkbox';

export type ConsentStatus = 'asking' | 'uploading' | 'done' | 'error';

interface Props {
  partyName: string;
  status: ConsentStatus;
  /** Result line after an upload ("Added. The host will review it" / an API error message). */
  message?: string | null;
  onAdd: () => void;
  /** `dontAskAgain` is true when the guest ticked the box. */
  onDismiss: (dontAskAgain: boolean) => void;
}

/**
 * Small bottom card shown after a booth photo is saved. It must not take focus or call anything
 * that eats the user gesture: on iOS the share sheet opens right after `questpass:photo` fires.
 * Nothing uploads until the guest taps Add.
 */
export function BoothShareConsent({ partyName, status, message, onAdd, onDismiss }: Props) {
  const [dontAsk, setDontAsk] = useState(false);
  const finished = status === 'done' || status === 'error';
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 p-3 sm:p-4 pointer-events-none"
      data-testid="booth-consent"
    >
      <div className="pointer-events-auto max-w-md mx-auto rounded-2xl border border-theme-stroke bg-theme-surface p-4 shadow-xl">
        {status === 'done' ? (
          <p className="flex items-center gap-2 text-sm text-theme-text" role="status">
            <Check size={16} className="text-green-400 shrink-0" />
            {message}
          </p>
        ) : (
          <>
            <p className="text-sm font-medium text-theme-text">Add this photo to {partyName}&apos;s photos?</p>
            {status === 'error' && message && (
              <p className="text-xs text-red-400 mt-1" role="alert">{message}</p>
            )}
            <div className="flex items-center gap-2 mt-3">
              <button
                type="button"
                onClick={onAdd}
                disabled={status === 'uploading'}
                className="btn-primary px-4 py-2 text-sm inline-flex items-center gap-2 disabled:opacity-60"
                data-testid="booth-consent-add"
              >
                {status === 'uploading' && <Loader2 size={14} className="animate-spin" />}
                {status === 'error' ? 'Try again' : 'Add'}
              </button>
              <button
                type="button"
                onClick={() => onDismiss(dontAsk)}
                disabled={status === 'uploading'}
                className="px-4 py-2 text-sm text-theme-text-secondary hover:text-theme-text disabled:opacity-60"
                data-testid="booth-consent-no"
              >
                No thanks
              </button>
            </div>
            <div className="mt-2">
              <Checkbox
                checked={dontAsk}
                onChange={() => setDontAsk((v) => !v)}
                label="Don't ask again"
                labelClassName="text-xs text-theme-text-secondary"
                checkboxRole
              />
            </div>
          </>
        )}
        {finished && status === 'done' && (
          <button
            type="button"
            onClick={() => onDismiss(dontAsk)}
            className="mt-2 text-xs text-theme-text-secondary underline"
            data-testid="booth-consent-close"
          >
            Close
          </button>
        )}
      </div>
    </div>
  );
}
