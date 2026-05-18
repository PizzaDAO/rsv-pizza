import React from 'react';
import { CreditCard, Banknote, Coins, User, Building, Globe, Wallet } from 'lucide-react';
import { PayoutMethod, BankDetails } from '../../types';
import { IconInput } from '../IconInput';

interface PayoutMethodPickerProps {
  method: PayoutMethod;
  onMethodChange: (method: PayoutMethod) => void;

  walletAddress: string;
  onWalletAddressChange: (v: string) => void;

  bankDetails: BankDetails;
  onBankDetailsChange: (b: BankDetails) => void;

  /** Email shown to user for the Mercury card destination. */
  userEmail?: string;
  /** Amount in USD, used in copy. */
  amountUsd: number;
}

type BankMode = 'us' | 'intl';

/**
 * Radio picker for payout method, with method-specific sub-form.
 *
 *   mercury_card → just a confirmation that we'll email a virtual card
 *   wire         → IconInput grid for bank details (US or international toggle)
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
  amountUsd,
}) => {
  const [bankMode, setBankMode] = React.useState<BankMode>(
    bankDetails.iban || bankDetails.swift ? 'intl' : 'us'
  );

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
          value="mercury_card"
          icon={<CreditCard size={18} />}
          title="Mercury virtual card"
          description="We email you a debit card for the exact amount."
        />
        <Option
          value="wire"
          icon={<Banknote size={18} />}
          title="Bank wire"
          description="We send a wire to your bank account."
        />
        <Option
          value="usdc_base"
          icon={<Coins size={18} />}
          title="USDC on Base"
          description="On-chain payout to your wallet."
        />
      </div>

      {method === 'mercury_card' && (
        <div className="rounded-xl border border-theme-stroke bg-theme-surface p-4 text-sm text-theme-text-secondary">
          <p>
            We'll issue you a Mercury virtual debit card for{' '}
            <span className="text-theme-text font-semibold">${amountUsd.toFixed(2)} USD</span>.
            Mercury will email the card details
            {userEmail ? <> directly to <span className="text-theme-text">{userEmail}</span></> : ' to the email on your account'}.
          </p>
          <p className="mt-2 text-xs text-theme-text-muted">
            No card or bank info needs to leave RSV.Pizza.
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
        <div className="space-y-3">
          {/* US vs intl toggle */}
          <div className="inline-flex rounded-lg border border-theme-stroke overflow-hidden">
            <button
              type="button"
              onClick={() => setBankMode('us')}
              className={`px-3 py-1.5 text-xs font-medium ${
                bankMode === 'us' ? 'bg-[#ff393a] text-white' : 'text-theme-text-secondary'
              }`}
            >
              US bank
            </button>
            <button
              type="button"
              onClick={() => setBankMode('intl')}
              className={`px-3 py-1.5 text-xs font-medium ${
                bankMode === 'intl' ? 'bg-[#ff393a] text-white' : 'text-theme-text-secondary'
              }`}
            >
              International
            </button>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <IconInput
              icon={User}
              type="text"
              placeholder="Account holder name"
              value={bankDetails.accountHolderName || ''}
              onChange={e => onBankDetailsChange({ ...bankDetails, accountHolderName: e.target.value })}
              required
            />
            <IconInput
              icon={Building}
              type="text"
              placeholder="Bank name"
              value={bankDetails.bankName || ''}
              onChange={e => onBankDetailsChange({ ...bankDetails, bankName: e.target.value })}
              required
            />
            {bankMode === 'us' ? (
              <>
                <IconInput
                  type="text"
                  placeholder="Routing number"
                  value={bankDetails.routingNumber || ''}
                  onChange={e => onBankDetailsChange({ ...bankDetails, routingNumber: e.target.value })}
                  required
                />
                <IconInput
                  type="text"
                  placeholder="Account number"
                  value={bankDetails.accountNumber || ''}
                  onChange={e => onBankDetailsChange({ ...bankDetails, accountNumber: e.target.value })}
                  required
                />
              </>
            ) : (
              <>
                <IconInput
                  icon={Globe}
                  type="text"
                  placeholder="IBAN"
                  value={bankDetails.iban || ''}
                  onChange={e => onBankDetailsChange({ ...bankDetails, iban: e.target.value })}
                />
                <IconInput
                  type="text"
                  placeholder="SWIFT / BIC"
                  value={bankDetails.swift || ''}
                  onChange={e => onBankDetailsChange({ ...bankDetails, swift: e.target.value })}
                />
              </>
            )}
            <IconInput
              type="text"
              placeholder="Bank address (optional)"
              value={bankDetails.bankAddress || ''}
              onChange={e => onBankDetailsChange({ ...bankDetails, bankAddress: e.target.value })}
            />
            <IconInput
              type="text"
              placeholder="Notes (intermediary bank, etc.)"
              value={bankDetails.notes || ''}
              onChange={e => onBankDetailsChange({ ...bankDetails, notes: e.target.value })}
            />
          </div>
        </div>
      )}
    </div>
  );
};
