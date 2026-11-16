import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Gift } from 'lucide-react';
import { NftClaimForm } from './NftClaimForm';
import { submitNftClaimAsGuest } from '../lib/api';
import { BRAND_FEATURES } from '../config/brandScope';

interface NftClaimCardProps {
  guestId: string;
  guestToken?: string | null;
  /** parties.nft_chain */
  chain?: string | null;
}

/** Event-page card for a logged-in guest who attended and hasn't claimed their NFT yet. Hidden on branded builds. */
export function NftClaimCard({ guestId, guestToken, chain }: NftClaimCardProps) {
  const { t } = useTranslation('nft');
  const [claimed, setClaimed] = useState(false);

  if (!BRAND_FEATURES.nftMinting) return null;

  return (
    <div className="bg-theme-surface border border-theme-stroke rounded-2xl p-4 space-y-3" data-testid="nft-claim-card">
      {!claimed && (
        <div className="flex items-start gap-3">
          <Gift className="w-5 h-5 text-[#ff393a] mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="text-sm font-semibold text-theme-text">{t('card.title')}</h3>
            <p className="text-xs text-theme-text-secondary">{t('card.body')}</p>
          </div>
        </div>
      )}
      <NftClaimForm
        chain={chain || 'base'}
        onSubmit={(address) => submitNftClaimAsGuest(guestId, address, guestToken)}
        onClaimed={() => setClaimed(true)}
      />
    </div>
  );
}
