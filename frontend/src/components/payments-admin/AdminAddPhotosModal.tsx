import React from 'react';
import { X } from 'lucide-react';
import { EventPhotosCard } from '../payouts/EventPhotosCard';

/**
 * provolone-58531: admin/underboss "Add photo" modal for /payments.
 *
 * Replaces the old pizza/event document-kind AdminAddAttachment photo control
 * with a modal that mirrors the HOST "submit photos" UI — the 3 role slots
 * (group / box_stack / pizza) + the generic additional-photos uploader — by
 * reusing the host `EventPhotosCard` component for an ARBITRARY party (the party
 * being reviewed, which is NOT the PizzaContext party). Uploads route through
 * the existing photo endpoints which now auto-approve for admins/underbosses.
 *
 * Follows the repo modal pattern: fixed inset backdrop + z-50 +
 * click-outside-to-close + a close (X) button. Body scrolls if tall.
 */

interface AdminAddPhotosModalProps {
  partyId: string;
  /** Reviewed party's start date (ISO) or null (null ⇒ no event-start cutoff). */
  eventStart: string | null;
  partyName?: string;
  onClose: () => void;
  /** Fires whenever the gallery reloads (a photo was added / role designated). */
  onAdded: () => void;
}

export const AdminAddPhotosModal: React.FC<AdminAddPhotosModalProps> = ({
  partyId,
  eventStart,
  partyName,
  onClose,
  onAdded,
}) => {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-theme-stroke">
          <div>
            <h3 className="text-base font-semibold text-theme-text">
              {partyName || 'Add event photos'}
            </h3>
            <p className="text-xs text-theme-text-muted mt-0.5">Add event photos</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-theme-text-secondary hover:text-theme-text transition-colors"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body (scrolls if tall) */}
        <div className="flex-1 overflow-y-auto p-5">
          <EventPhotosCard
            partyId={partyId}
            eventStartDate={eventStart}
            onPhotosChange={onAdded}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end p-4 border-t border-theme-stroke">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-[#ff393a] text-white hover:bg-[#ff393a]/90 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
