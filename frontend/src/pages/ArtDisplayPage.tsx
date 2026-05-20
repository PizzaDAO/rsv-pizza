import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { ArtDisplay } from '../components/day-of';
import { fetchMyEvents } from '../lib/api';

const SUPER_ADMIN_EMAIL = 'hello@rarepizzas.com';

/**
 * /display/:partyId/art — full-bleed slideshow of approved party photos
 * for venue screens. Host/cohost auth required (NOT public anon access).
 */
export function ArtDisplayPage() {
  const { partyId } = useParams<{ partyId: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate(`/login?redirect=${encodeURIComponent(`/display/${partyId}/art`)}`, {
        replace: true,
      });
      return;
    }
    if (!partyId) {
      setAllowed(false);
      return;
    }
    // Super admin bypass
    if (user.email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()) {
      setAllowed(true);
      return;
    }
    // Otherwise: must be a host/cohost of the party (not just a guest)
    fetchMyEvents()
      .then((parties) => {
        const match = parties.find(
          (p) => p.id === partyId && (p.role === 'host' || p.role === 'cohost')
        );
        setAllowed(!!match);
      })
      .catch(() => setAllowed(false));
  }, [authLoading, user, partyId, navigate]);

  if (authLoading || allowed === null) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-white/40" />
      </div>
    );
  }

  if (!allowed || !partyId) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center text-white/50">
        Access denied.
      </div>
    );
  }

  return <ArtDisplay partyId={partyId} />;
}
