import React, { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { ArtDisplay } from '../components/day-of';
import { useIsAdminOrUnderboss } from '../hooks/useIsAdminOrUnderboss';

/**
 * /display/:partyId/art — full-bleed slideshow of approved party photos
 * for venue screens.
 *
 * pepperoni-58341 soft-launch gate: admins + underbosses only. The host/cohost
 * + super-admin-email check that previously lived here was replaced with the
 * canonical `useIsAdminOrUnderboss()` hook for consistency with HostPage's
 * Day-Of tab and DayOfRunPage. Loosen this when we widen the Day-Of rollout.
 */
export function ArtDisplayPage() {
  const { partyId } = useParams<{ partyId: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const isAdminOrUnderboss = useIsAdminOrUnderboss();

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate(`/login?redirect=${encodeURIComponent(`/display/${partyId}/art`)}`, {
        replace: true,
      });
    }
  }, [authLoading, user, partyId, navigate]);

  if (authLoading || isAdminOrUnderboss === null) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-white/40" />
      </div>
    );
  }

  if (!isAdminOrUnderboss || !partyId) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center text-white/50">
        Access denied.
      </div>
    );
  }

  return <ArtDisplay partyId={partyId} />;
}
