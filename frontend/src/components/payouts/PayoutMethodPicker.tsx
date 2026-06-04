import React from 'react';
import { Coins, Wallet } from 'lucide-react';
import { PayoutMethod } from '../../types';
import { IconInput } from '../IconInput';
import { resolveEnsName } from '../../lib/api';

// taleggio-30219: mirror of backend `looksLikeEnsName` — accepts dotted
// names like `vitalik.eth` or `alice.cb.id` and rejects 0x… inputs.
const ENS_NAME_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
function looksLikeEnsName(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed || trimmed.startsWith('0x')) return false;
  return ENS_NAME_RE.test(trimmed);
}

type EnsPreviewState =
  | { kind: 'idle' }
  | { kind: 'resolving'; name: string }
  | { kind: 'resolved'; name: string; address: string }
  | { kind: 'error'; name: string };

interface PayoutMethodPickerProps {
  method: PayoutMethod;
  onMethodChange: (method: PayoutMethod) => void;

  walletAddress: string;
  onWalletAddressChange: (v: string) => void;
}

/**
 * casatiello-58291: USDC-on-Base is now the ONLY host-facing payout method.
 * Mercury card + Bank wire were removed from this picker (they remain valid
 * `PayoutMethod` union members so historical payout rows still render in the
 * admin views). With a single method there's no radio choice to make — we
 * render a fixed "USDC on Base" header followed by the wallet sub-form.
 *
 *   usdc_base → wallet address IconInput (with live ENS preview)
 */
export const PayoutMethodPicker: React.FC<PayoutMethodPickerProps> = ({
  method,
  onMethodChange,
  walletAddress,
  onWalletAddressChange,
}) => {
  // Ensure the (only) method is selected. The consumer seeds this, but if a
  // historical row had mercury_card/wire we still surface the USDC sub-form.
  React.useEffect(() => {
    if (method !== 'usdc_base') {
      onMethodChange('usdc_base');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method]);

  // taleggio-30219: debounced ENS preview state for the USDC sub-form.
  const [ensPreview, setEnsPreview] = React.useState<EnsPreviewState>({ kind: 'idle' });
  React.useEffect(() => {
    const trimmed = walletAddress.trim();
    if (!trimmed || !looksLikeEnsName(trimmed)) {
      setEnsPreview({ kind: 'idle' });
      return;
    }
    setEnsPreview({ kind: 'resolving', name: trimmed });
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      const addr = await resolveEnsName(trimmed);
      if (cancelled) return;
      if (addr) {
        setEnsPreview({ kind: 'resolved', name: trimmed, address: addr });
      } else {
        setEnsPreview({ kind: 'error', name: trimmed });
      }
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [walletAddress]);

  return (
    <div className="space-y-4">
      <div className="w-full rounded-xl border border-[#ff393a] bg-[#ff393a]/5 p-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 text-[#ff393a]">
            <Coins size={18} />
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold text-theme-text">USDC on Base</div>
            <div className="text-xs text-theme-text-muted mt-0.5">
              Onchain payment to your wallet.
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <IconInput
          icon={Wallet}
          type="text"
          placeholder="Your wallet address or ENS name (0x… or alice.eth)"
          value={walletAddress}
          onChange={e => onWalletAddressChange(e.target.value)}
          required
        />
        {/* taleggio-30219: live ENS preview. Hidden when the input is 0x or empty. */}
        {ensPreview.kind === 'resolving' && (
          <p className="text-xs text-theme-text-muted">
            Resolving <span className="font-mono">{ensPreview.name}</span>…
          </p>
        )}
        {ensPreview.kind === 'resolved' && (
          <p className="text-xs text-theme-text-muted">
            → <span className="font-mono">{ensPreview.address.slice(0, 6)}…{ensPreview.address.slice(-4)}</span>
          </p>
        )}
        {ensPreview.kind === 'error' && (
          <p className="text-xs text-red-400">
            Could not resolve "<span className="font-mono">{ensPreview.name}</span>"
          </p>
        )}
        <p className="text-xs text-theme-text-muted">
          USDC on Base ({/* link omitted intentionally */}
          <span className="font-mono">0x8335…2913</span>). ENS names resolve against Ethereum mainnet. Double-check the resolved address — onchain transfers can't be reversed.
        </p>
      </div>
    </div>
  );
};
