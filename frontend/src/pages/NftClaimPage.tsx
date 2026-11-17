import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Check, ExternalLink, Loader2 } from 'lucide-react';
import { Layout } from '../components/Layout';
import { NftClaimForm } from '../components/NftClaimForm';
import { ThemeProvider } from '../contexts/ThemeContext';
import { BRAND_FEATURES } from '../config/brandScope';
import { BRAND } from '../config/brand';
import { getNftClaim, submitNftClaim, NftClaimError, type NftClaimInfo } from '../lib/api';

/** Private claim link from the post-event email: /nft/claim/:token. The token is the capability. */
export function NftClaimPage() {
  return (
    <ThemeProvider theme="gpp">
      <NftClaimPageInner />
    </ThemeProvider>
  );
}

function Notice({ title, body, tone = 'info' }: { title: string; body: string; tone?: 'info' | 'error' }) {
  return (
    <div className="text-center space-y-2 py-6" data-testid="nft-claim-notice">
      <AlertCircle className={`w-10 h-10 mx-auto ${tone === 'error' ? 'text-[#ff393a]' : 'text-theme-text-muted'}`} />
      <h2 className="text-lg font-semibold text-theme-text">{title}</h2>
      <p className="text-sm text-theme-text-secondary">{body}</p>
    </div>
  );
}

function NftClaimPageInner() {
  const { token } = useParams<{ token: string }>();
  const { t } = useTranslation('nft');

  // All hooks declared above any early return (rules-of-hooks).
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [info, setInfo] = useState<NftClaimInfo | null>(null);

  const load = useCallback(async () => {
    if (!token || !BRAND_FEATURES.nftMinting) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setNotFound(false);
    setLoadError(false);
    try {
      setInfo(await getNftClaim(token));
    } catch (e) {
      if (e instanceof NftClaimError && e.http === 404) setNotFound(true);
      else setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  // The token is the capability, so the in-wallet-browser hand-off is just this page's URL.
  const getHandoffUrl = useCallback(async () => window.location.href, []);

  let body: React.ReactNode;
  if (!BRAND_FEATURES.nftMinting) {
    body = <Notice title={t('states.unavailable.title')} body={t('states.unavailable.body')} />;
  } else if (loading) {
    body = (
      <div className="flex items-center justify-center gap-2 text-theme-text-secondary py-10">
        <Loader2 className="w-5 h-5 animate-spin" />
        {t('loading')}
      </div>
    );
  } else if (notFound || !token) {
    body = <Notice title={t('states.notFound.title')} body={t('states.notFound.body')} />;
  } else if (loadError || !info) {
    body = <Notice tone="error" title={t('errors.generic')} body="" />;
  } else if (info.status === 'minted') {
    body = (
      <div className="text-center space-y-3" data-testid="nft-claim-already">
        <Check className="w-10 h-10 text-[#39d98a] mx-auto" />
        <h2 className="text-lg font-semibold text-theme-text">{t('minted.title')}</h2>
        <p className="text-sm text-theme-text-secondary">
          {t('minted.body', { to: info.maskedRecipient ? ` to ${info.maskedRecipient}` : '' })}
        </p>
        {info.explorerUrl && (
          <a
            href={info.explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-[#ff393a] hover:underline"
          >
            {t('success.view')}
            <ExternalLink size={14} />
          </a>
        )}
      </div>
    );
  } else if (info.paused) {
    body = <Notice title={t('states.paused.title')} body={t('states.paused.body')} />;
  } else {
    body = <NftClaimForm chain={info.chain} onSubmit={(address) => submitNftClaim(token, address)} getHandoffUrl={getHandoffUrl} />;
  }

  return (
    <Layout>
      <Helmet>
        <title>{`${t('title')} | ${BRAND.name}`}</title>
        <meta name="robots" content="noindex" />
      </Helmet>
      <div className="max-w-md mx-auto px-4 py-8">
        <div className="bg-theme-surface border border-theme-stroke rounded-2xl p-6 space-y-5">
          {info && !notFound && BRAND_FEATURES.nftMinting && (
            <div className="text-center space-y-3">
              {info.eventImageUrl && (
                <img src={info.eventImageUrl} alt={info.partyName} className="w-full rounded-xl" />
              )}
              <h1 className="text-xl font-bold text-theme-text">{t('title')}</h1>
              <p className="text-sm text-theme-text-secondary">{t('subtitle', { name: info.partyName })}</p>
              <span className="inline-block text-xs px-2.5 py-1 rounded-full bg-theme-surface-hover text-theme-text-secondary" data-testid="nft-chain-badge">
                {t(`chain.${info.chain === 'monad' ? 'monad' : 'base'}`)}
              </span>
            </div>
          )}
          {body}
        </div>
      </div>
    </Layout>
  );
}
