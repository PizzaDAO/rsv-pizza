import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Checkbox } from '../Checkbox';

/**
 * parmigiana-92104: shared amber warning + ack panel surfaced on every admin
 * reimbursement modal when the target party is an SWC Hub party. Mirrors the
 * salame-92103 / bianco-89172 per-cap override pattern so the visual + dark-
 * amber gpp-theme overrides stay consistent across PayoutReviewModal,
 * BulkSendModal, ExternalPaymentModal, and MarkPartyPaidModal.
 *
 * Frontend-only soft block — the action buttons in the parent disable until
 * `acked` flips true. The backend stays open so admins can override when
 * needed (this is a guardrail, not a hard wall).
 *
 * Props:
 *  - isSwcHub: when false, the panel renders nothing (callers don't need to
 *    null-guard).
 *  - acked / onAckChange: controlled ack state owned by the parent so the
 *    parent can also use it to flip its action buttons' `disabled`.
 *  - title / body: optional overrides for the bulk-send batch summary copy.
 *    Default copy matches the per-party PayoutReviewModal / ExternalPayment /
 *    MarkPartyPaid case.
 *  - ackLabel: optional override for the checkbox label so the bulk variant
 *    can read "Allow SWC Hub sends — I acknowledge".
 */
interface SwcHubWarningProps {
  isSwcHub: boolean;
  acked: boolean;
  onAckChange: (next: boolean) => void;
  title?: string;
  body?: React.ReactNode;
  ackLabel?: string;
}

const DEFAULT_TITLE = 'SWC Hub party';
const DEFAULT_BODY = (
  <>
    Reimbursement for SWC Hub parties is processed through SWC, not rsv.pizza.
    Don&apos;t push payments through this flow unless you&apos;ve cleared it
    with the SWC operator.
  </>
);
const DEFAULT_ACK_LABEL = 'I understand — proceed anyway';

export const SwcHubWarning: React.FC<SwcHubWarningProps> = ({
  isSwcHub,
  acked,
  onAckChange,
  title = DEFAULT_TITLE,
  body = DEFAULT_BODY,
  ackLabel = DEFAULT_ACK_LABEL,
}) => {
  if (!isSwcHub) return null;
  return (
    // ricotta-92103: dark-amber overrides under .gpp-theme to keep the panel
    // legible on light-mint pages — mirrors PayoutReviewModal's salame /
    // bianco warning panels.
    <div className="card p-3 border-l-4 border-l-amber-500 bg-amber-500/10 mb-4">
      <div className="flex items-start gap-2.5">
        <AlertTriangle
          className="text-amber-300 [.gpp-theme_&]:text-amber-700 mt-0.5 flex-shrink-0"
          size={16}
        />
        <div className="flex-1 text-sm">
          <div className="font-medium text-amber-200 [.gpp-theme_&]:text-amber-900 mb-1">
            {title}
          </div>
          <div className="text-theme-text-secondary [.gpp-theme_&]:text-amber-900 text-xs">
            {body}
          </div>
          <div className="mt-3">
            <Checkbox
              checked={acked}
              onChange={() => onAckChange(!acked)}
              label={ackLabel}
              labelClassName="text-sm text-amber-100 [.gpp-theme_&]:text-amber-900"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
