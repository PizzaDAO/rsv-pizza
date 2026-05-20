import React from 'react';
import { CreditCard, Banknote, Coins, Mail, Wallet } from 'lucide-react';
import { PayoutMethod, BankDetails } from '../../types';
import { IconInput } from '../IconInput';

interface PayoutMethodPickerProps {
  method: PayoutMethod;
  onMethodChange: (method: PayoutMethod) => void;

  walletAddress: string;
  onWalletAddressChange: (v: string) => void;

  bankDetails: BankDetails;
  onBankDetailsChange: (b: BankDetails) => void;

  /** Email shown to user for the Mercury card destination + prefilled for wire. */
  userEmail?: string;
  /**
   * arugula-38633 (follow-up): the host's effective reimbursement cap. Used in
   * the Mercury copy so the host understands the card has a LIMIT, not a fixed
   * per-receipt amount. When null, we omit the dollar amount entirely.
   */
  reimbursementCapUsd?: number | null;
}

/**
 * Radio picker for payout method, with method-specific sub-form.
 *
 *   mercury_card → just a confirmation that we'll email a virtual card
 *   wire         → single email field (our bank emails the host to complete)
 *   usdc_base    → wallet address IconInput
 */
export const PayoutMethodPicker: React.FC<PayoutMethodPickerProps> = ({
  method,
  onMethodChange,
  walletAddress,
  onWalletAddressChange,
  bankDetails,
  onBankDetailsChange,
  userEmail,
  reimbursementCapUsd,
}) => {
  // For wire: prefill the field from the user's auth email if no saved value.
  // We mirror this into bankDetails on first render of the wire branch so the
  // auto-save persists it even if the host doesn't touch the field.
  const wireEmail = bankDetails.email ?? userEmail ?? '';
  React.useEffect(() => {
    if (method !== 'wire') return;
    if (bankDetails.email !== undefined) return; // already set (incl. empty string)
    if (!userEmail) return;
    onBankDetailsChange({ ...bankDetails, email: userEmail });
    // We only want to seed on the first transition into wire mode; deps below
    // intentionally exclude bankDetails/onBankDetailsChange so we don't loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, userEmail]);

  const Option: React.FC<{
    value: PayoutMethod;
    icon: React.ReactNode;
    title: string;
    description: string;
  }> = ({ value, icon, title, description }) => {
    const active = method === value;
    return (
      <button
        type="button"
        onClick={() => onMethodChange(value)}
        className={`w-full text-left rounded-xl border p-4 transition-colors ${
          active
            ? 'border-[#ff393a] bg-[#ff393a]/5'
            : 'border-theme-stroke bg-theme-surface hover:border-theme-stroke-strong'
        }`}
      >
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 ${active ? 'text-[#ff393a]' : 'text-theme-text-muted'}`}>
            {icon}
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold text-theme-text">{title}</div>
            <div className="text-xs text-theme-text-muted mt-0.5">{description}</div>
          </div>
          <div
            className={`mt-1 w-4 h-4 rounded-full border-2 flex-shrink-0 ${
              active ? 'border-[#ff393a]' : 'border-theme-stroke'
            }`}
          >
            {active && <div className="w-2 h-2 rounded-full bg-[#ff393a] m-0.5" />}
          </div>
        </div>
      </button>
    );
  };

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-3 gap-3">
        <Option
          value="usdc_base"
          icon={<Coins size={18} />}
          title="USDC on Base"
          description="Onchain payment to your wallet."
        />
        <Option
          value="mercury_card"
          icon={<CreditCard size={18} />}
          title="Mercury virtual card"
          description="We issue you a debit card for the exact amount."
        />
        <Option
          value="wire"
          icon={<Banknote size={18} />}
          title="Bank wire"
          description="We send a wire to your bank account."
        />
      </div>

      {method === 'mercury_card' && (
        <div className="rounded-xl border border-theme-stroke bg-theme-surface p-4 text-sm text-theme-text-secondary">
          <p>
            We'll issue you a Mercury virtual debit card
            {typeof reimbursementCapUsd === 'number' && reimbursementCapUsd > 0 ? (
              <>
                {' '}with a limit of{' '}
                <span className="text-theme-text font-semibold">${reimbursementCapUsd.toFixed(2)}</span>
              </>
            ) : null}
            .
          </p>
        </div>
      )}

      {method === 'usdc_base' && (
        <div className="space-y-2">
          <IconInput
            icon={Wallet}
            type="text"
            placeholder="Your wallet address on Base (0x…)"
            value={walletAddress}
            onChange={e => onWalletAddressChange(e.target.value)}
            required
          />
          <p className="text-xs text-theme-text-muted">
            USDC on Base ({/* link omitted intentionally */}
            <span className="font-mono">0x8335…2913</span>). Double-check this address — on-chain transfers can't be reversed.
          </p>
        </div>
      )}

      {method === 'wire' && (
        <div className="space-y-2">
          <IconInput
            icon={Mail}
            type="email"
            placeholder="Email for bank correspondence"
            value={wireEmail}
            onChange={e => onBankDetailsChange({ ...bankDetails, email: e.target.value })}
            required
          />
          <p className="text-xs text-theme-text-muted">
            We'll send you an email from our bank to complete the transaction.
          </p>
        </div>
      )}
    </div>
  );
};
