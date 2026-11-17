import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Layout } from '../components/Layout';
import { useAuth } from '../contexts/AuthContext';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3006';

/**
 * /link/pizzadao?return=<url>&state=<nonce>
 *
 * "Link your account" for pizzadao.org. Signed-out visitors go through the normal
 * email login first, then land back here. Nothing is sent until the visitor taps confirm
 * (so a forged link can't silently link whichever account happens to be signed in); the
 * backend validates the return URL against its allowlist and returns the redirect target.
 */
export function PizzadaoLinkPage() {
  const { user, loading: authLoading, signOut } = useAuth();
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const returnUrl = params.get('return') || '';
  const state = params.get('state') || '';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  let returnHost = '';
  try {
    returnHost = new URL(returnUrl).host;
  } catch {
    /* invalid: handled below */
  }
  const valid = returnHost.length > 0 && state.length > 0;

  useEffect(() => {
    if (authLoading || user || !valid) return;
    const here = location.pathname + location.search;
    navigate(`/login?redirect=${encodeURIComponent(here)}`, { replace: true });
  }, [authLoading, user, valid, location.pathname, location.search, navigate]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${API_URL}/api/pizzadao-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? ''}` },
        body: JSON.stringify({ returnUrl, state }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data?.url !== 'string') throw new Error('link failed');
      window.location.assign(data.url);
    } catch {
      setError(t('pizzadaoLink.failed'));
      setBusy(false);
    }
  };

  const switchAccount = () => {
    signOut();
    // user becomes null, so the effect above sends the visitor through login and back here.
  };

  return (
    <Layout>
      <div className="max-w-md mx-auto px-4 py-12">
        <div className="card p-8 space-y-4">
          <h1 className="text-2xl font-bold text-theme-text">{t('pizzadaoLink.title')}</h1>
          {!valid ? (
            <p className="text-theme-text-secondary text-sm" data-testid="link-invalid">{t('pizzadaoLink.invalid')}</p>
          ) : !user ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <>
              <p className="text-theme-text-secondary text-sm">{t('pizzadaoLink.body')}</p>
              <p className="text-sm text-theme-text-secondary" data-testid="link-return-host">
                {t('pizzadaoLink.returnTo', { host: returnHost })}
              </p>
              <p className="text-sm text-theme-text">
                {t('pizzadaoLink.signedInAs')} <strong data-testid="link-email">{user.email}</strong>
              </p>
              {error && <p className="text-sm text-red-500" role="alert">{error}</p>}
              <button className="btn-primary w-full" onClick={confirm} disabled={busy} data-testid="link-confirm">
                {busy ? t('pizzadaoLink.linking') : t('pizzadaoLink.confirm')}
              </button>
              <button className="text-sm underline text-theme-text-secondary" onClick={switchAccount}>
                {t('pizzadaoLink.useDifferent')}
              </button>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}
