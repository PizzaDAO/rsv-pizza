import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { ArtDisplay } from '../components/day-of';
import { supabase } from '../lib/supabase';

/**
 * /display/:partyId/art — full-bleed slideshow of approved party photos
 * for venue screens.
 *
 * salami-39204 approval gate: replaces the pepperoni-58341 admin/underboss
 * soft-launch check with an approval gate keyed on
 * `parties.underboss_status === 'approved'`. Anyone logged-in viewing an
 * approved party gets the slideshow; unapproved/pending parties show
 * "Access denied".
 */
export function ArtDisplayPage() {
  const { partyId } = useParams<{ partyId: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  // null = still loading, 'approved' | other string | null = resolved.
  const [partyStatus, setPartyStatus] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate(`/login?redirect=${encodeURIComponent(`/display/${partyId}/art`)}`, {
        replace: true,
      });
    }
  }, [authLoading, user, partyId, navigate]);

  // Fetch party.underboss_status by ID to decide the gate.
  useEffect(() => {
    if (!partyId || !user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('parties')
        .select('underboss_status')
        .eq('id', partyId)
        .maybeSingle();
      if (cancelled) return;
      setPartyStatus((data?.underboss_status as string | null | undefined) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [partyId, user]);

  const isApproved = partyStatus === 'approved';

  if (authLoading || partyStatus === undefined) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-white/40" />
      </div>
    );
  }

  if (!isApproved || !partyId) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center text-white/50">
        Access denied.
      </div>
    );
  }

  return <ArtDisplay partyId={partyId} />;
}
