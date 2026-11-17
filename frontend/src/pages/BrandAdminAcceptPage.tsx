import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { Loader2, ShieldCheck, AlertCircle } from 'lucide-react';
import { Layout } from '../components/Layout';
import { LoginModal } from '../components/LoginModal';
import { useAuth } from '../contexts/AuthContext';
import { acceptBrandAdminInvite } from '../lib/api';

const TOKEN_KEY = 'brandAdminInviteToken';

// localStorage (not sessionStorage) so the token survives the emailed sign-in link opening in a
// new tab. It expires after an hour and is cleared on accept.
const TOKEN_TTL_MS = 60 * 60 * 1000;

function readStored(): string | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const { t, exp } = JSON.parse(raw) as { t?: string; exp?: number };
    if (typeof t !== 'string' || typeof exp !== 'number' || exp < Date.now()) {
      localStorage.removeItem(TOKEN_KEY);
      return null;
    }
    return t;
  } catch { return null; }
}
function store(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, JSON.stringify({ t: token, exp: Date.now() + TOKEN_TTL_MS }));
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage blocked */ }
}

/**
 * Landing page for the emailed brand-admin invite link (`/brand-admin/accept?token=...`).
 * The token is moved out of the address bar into localStorage (1h expiry) right away (the sign-in flow
 * only returns to the path, not the query). Signed-in users accept with one tap; the server
 * requires the signed-in email to match the invited email.
 */
export function BrandAdminAcceptPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [token, setToken] = useState<string | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  const initial = useRef(new URLSearchParams(location.search).get('token'));

  useEffect(() => {
    const t = initial.current || readStored();
    if (initial.current) {
      store(initial.current);
      navigate(location.pathname, { replace: true });
    }
    setToken(t);
    // Run once on mount: the token is captured in a ref above.
  }, []);

  const accept = async () => {
    if (!token) return;
    setStatus('working');
    setError('');
    try {
      await acceptBrandAdminInvite(token);
      store(null);
      setStatus('done');
    } catch (e: any) {
      setStatus('error');
      setError(e?.message || 'Could not accept the invite');
    }
  };

  let body;
  if (loading) {
    body = <Loader2 size={28} className="animate-spin text-theme-text-muted" />;
  } else if (status === 'done') {
    body = (
      <>
        <ShieldCheck size={40} className="text-theme-accent mb-3" />
        <h1 className="text-xl font-bold text-theme-text mb-2">You're a brand admin</h1>
        <p className="text-theme-text-muted text-sm">Your brand settings will be available here soon.</p>
      </>
    );
  } else if (!token) {
    body = (
      <>
        <AlertCircle size={40} className="text-red-400/70 mb-3" />
        <h1 className="text-xl font-bold text-theme-text mb-2">Invite link missing</h1>
        <p className="text-theme-text-muted text-sm">Open the link from your invite email again.</p>
      </>
    );
  } else if (!user) {
    body = (
      <>
        <ShieldCheck size={40} className="text-theme-accent mb-3" />
        <h1 className="text-xl font-bold text-theme-text mb-2">Accept your brand admin invite</h1>
        <p className="text-theme-text-muted text-sm mb-4">Sign in with the email address the invite was sent to.</p>
        <button type="button" onClick={() => setShowLogin(true)} className="px-4 py-2 rounded-lg bg-[#E52828] text-white hover:bg-[#CC2020] text-sm">
          Sign in
        </button>
      </>
    );
  } else {
    body = (
      <>
        <ShieldCheck size={40} className="text-theme-accent mb-3" />
        <h1 className="text-xl font-bold text-theme-text mb-2">Accept your brand admin invite</h1>
        <p className="text-theme-text-muted text-sm mb-4">Signed in as {user.email}.</p>
        {status === 'error' && <p className="text-sm text-red-400 mb-3">{error}</p>}
        <button type="button" onClick={accept} disabled={status === 'working'}
          className="px-4 py-2 rounded-lg bg-[#E52828] text-white hover:bg-[#CC2020] text-sm disabled:opacity-50">
          {status === 'working' ? 'Accepting…' : 'Accept invite'}
        </button>
      </>
    );
  }

  return (
    <Layout>
      <div className="flex flex-col items-center text-center px-4 py-24 max-w-md mx-auto">{body}</div>
      <LoginModal isOpen={showLogin} onClose={() => setShowLogin(false)} />
    </Layout>
  );
}

export default BrandAdminAcceptPage;
