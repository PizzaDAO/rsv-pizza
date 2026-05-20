import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { PizzaProvider, usePizza } from '../contexts/PizzaContext';
import { useAuth } from '../contexts/AuthContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import { DayOfDashboard } from '../components/day-of';
import { useIsAdminOrUnderboss } from '../hooks/useIsAdminOrUnderboss';

/**
 * /run/:inviteCode — mobile-optimised day-of host dashboard. No `<Layout>`
 * chrome (no header/footer/sidebar) so the entire viewport is dashboard.
 *
 * pepperoni-58341 soft-launch: admin/underboss only (see `useIsAdminOrUnderboss`).
 * Logged-out visitors bounce to /login; logged-in non-admins bounce to /.
 */
function DayOfRunPageContent() {
  const { inviteCode } = useParams<{ inviteCode: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { loadParty, party, partyLoading } = usePizza();
  const [loaded, setLoaded] = useState(false);
  // pepperoni-58341 soft-launch gate: route is admin/underboss only.
  const isAdminOrUnderboss = useIsAdminOrUnderboss();

  useEffect(() => {
    if (!inviteCode || loaded) return;
    loadParty(inviteCode).then((ok) => setLoaded(true));
  }, [inviteCode, loadParty, loaded]);

  // pepperoni-58341 soft-launch: only admins/underbosses can access /run/
  // during the gated rollout. They can access ANY party regardless of
  // host/cohost status (so Snax can dogfood on any event). When we widen
  // the rollout, restore a `canEdit`-style gate (party.userId === user.id
  // || party.canEdit || super-admin email — see HostPage.tsx for the
  // pattern) and combine it with this admin/underboss check.
  const accessAllowed = isAdminOrUnderboss === true;

  useEffect(() => {
    if (authLoading || partyLoading) return;
    if (!loaded) return;
    // Logged-out users → bounce to /login so they can sign in.
    if (!user) {
      navigate(`/login?redirect=${encodeURIComponent(`/run/${inviteCode}`)}`, { replace: true });
      return;
    }
    // Wait for admin/underboss check to resolve before deciding.
    if (isAdminOrUnderboss === null) return;
    // Non-admin/underboss users are blocked during soft-launch — redirect to /.
    if (party && !accessAllowed) {
      navigate('/', { replace: true });
    }
  }, [authLoading, partyLoading, loaded, party, accessAllowed, isAdminOrUnderboss, user, navigate, inviteCode]);

  if (authLoading || partyLoading || !loaded || !party || isAdminOrUnderboss === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-theme-bg">
        <Loader2 size={32} className="animate-spin text-theme-text-muted" />
      </div>
    );
  }

  if (!accessAllowed) {
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
