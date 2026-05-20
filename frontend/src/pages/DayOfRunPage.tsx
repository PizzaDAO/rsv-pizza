import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { PizzaProvider, usePizza } from '../contexts/PizzaContext';
import { useAuth } from '../contexts/AuthContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import { DayOfDashboard } from '../components/day-of';

const SUPER_ADMIN_EMAIL = 'hello@rarepizzas.com';

/**
 * /run/:inviteCode — mobile-optimised day-of host dashboard. No `<Layout>`
 * chrome (no header/footer/sidebar) so the entire viewport is dashboard.
 * Auth-gated to host or canEdit cohost; logged-out visitors bounce to /login.
 */
function DayOfRunPageContent() {
  const { inviteCode } = useParams<{ inviteCode: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { loadParty, party, partyLoading } = usePizza();
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!inviteCode || loaded) return;
    loadParty(inviteCode).then((ok) => setLoaded(true));
  }, [inviteCode, loadParty, loaded]);

  // Gate: must be owner / super-admin / canEdit cohost.
  const canEdit = (() => {
    if (!party || !user) return false;
    if (user.email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()) return true;
    if (party.userId === user.id) return true;
    if (party.canEdit) return true;
    return false;
  })();

  useEffect(() => {
    if (authLoading || partyLoading) return;
    if (!loaded) return;
    if (party && !canEdit) {
      if (!user) {
        navigate(`/login?redirect=${encodeURIComponent(`/run/${inviteCode}`)}`, { replace: true });
      } else {
        navigate(`/rsvp/${inviteCode}`, { replace: true });
      }
    }
  }, [authLoading, partyLoading, loaded, party, canEdit, user, navigate, inviteCode]);

  if (authLoading || partyLoading || !loaded || !party) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-theme-bg">
        <Loader2 size={32} className="animate-spin text-theme-text-muted" />
      </div>
    );
  }

  if (!canEdit) {
    return null;
  }

  return (
    <div className="min-h-screen bg-theme-bg text-theme-text">
      <div className="px-4 py-4 max-w-2xl mx-auto">
        <header className="mb-4 flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-wide text-theme-text-muted">
              Day-of
            </p>
            <h1 className="text-xl font-bold text-theme-text truncate">{party.name}</h1>
          </div>
          <a
            href={`/host/${party.inviteCode}`}
            className="text-xs text-theme-text-muted hover:text-theme-text whitespace-nowrap ml-3"
          >
            Full host page
          </a>
        </header>

        <DayOfDashboard party={party} layout="mobile" />
      </div>
    </div>
  );
}

function DayOfRunPageThemeWrapper() {
  const { party } = usePizza();
  const isGPP = party?.eventType === 'gpp';
  return (
    <ThemeProvider theme={isGPP ? 'gpp' : 'dark'}>
      <DayOfRunPageContent />
    </ThemeProvider>
  );
}

export function DayOfRunPage() {
  return (
    <PizzaProvider>
      <DayOfRunPageThemeWrapper />
    </PizzaProvider>
  );
}
