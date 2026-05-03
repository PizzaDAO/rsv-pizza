import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Layout } from '../components/Layout';
import { Loader2, CheckCircle2, XCircle, Clock, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { checkInGuest, CheckInResponse } from '../lib/api';

type CheckInState = 'loading' | 'success' | 'already-checked-in' | 'unauthorized' | 'error' | 'not-found';

export function CheckInPage() {
  const { inviteCode, guestId } = useParams<{ inviteCode: string; guestId: string }>();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation('checkin');

  const [state, setState] = useState<CheckInState>('loading');
  const [guestName, setGuestName] = useState<string>('');
  const [checkedInAt, setCheckedInAt] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [hasAttemptedCheckIn, setHasAttemptedCheckIn] = useState(false);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      // Store the current URL to redirect back after login
      const currentUrl = `/checkin/${inviteCode}/${guestId}`;
      sessionStorage.setItem('authReturnUrl', currentUrl);
      navigate(`/login?redirect=${encodeURIComponent(currentUrl)}`);
    }
  }, [authLoading, user, inviteCode, guestId, navigate]);

  // Auto check-in when authenticated
  useEffect(() => {
    if (authLoading || !user || hasAttemptedCheckIn || !inviteCode || !guestId) {
      return;
    }

    const performCheckIn = async () => {
      setHasAttemptedCheckIn(true);
      setState('loading');

      try {
        const response: CheckInResponse = await checkInGuest(inviteCode, guestId);

        setGuestName(response.guest.name);

        if (response.alreadyCheckedIn) {
          setState('already-checked-in');
          setCheckedInAt(response.guest.checkedInAt);
        } else {
          setState('success');
          setCheckedInAt(response.guest.checkedInAt);
        }
      } catch (error: any) {
        console.error('Check-in error:', error);

        if (error.message?.includes('not authorized') || error.message?.includes('UNAUTHORIZED')) {
          setState('unauthorized');
          setErrorMessage(t('unauthorized.message'));
        } else if (error.message?.includes('not found') || error.message?.includes('NOT_FOUND')) {
          setState('not-found');
          setErrorMessage(error.message || 'Guest or event not found');
        } else {
          setState('error');
          setErrorMessage(error.message || 'An error occurred during check-in');
        }
      }
    };

    performCheckIn();
  }, [authLoading, user, inviteCode, guestId, hasAttemptedCheckIn, t]);

  // Format the check-in time
  const formatCheckInTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  // Render content based on state
  const renderContent = () => {
    if (authLoading || state === 'loading') {
      return (
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 size={48} className="animate-spin text-[#ff393a] mb-4" />
          <p className="text-theme-text-secondary">{t('loading')}</p>
        </div>
      );
    }

    if (state === 'success') {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mb-6">
            <CheckCircle2 size={48} className="text-green-500" />
          </div>
          <h2 className="text-2xl font-bold text-theme-text mb-2">{t('success.title')}</h2>
          <p className="text-xl text-theme-text mb-4">{guestName}</p>
          {checkedInAt && (
            <p className="text-theme-text-muted text-sm flex items-center gap-2">
              <Clock size={14} />
              {formatCheckInTime(checkedInAt)}
            </p>
          )}
          <button
            onClick={() => navigate(`/host/${inviteCode}`)}
            className="mt-8 btn-secondary"
          >
            {t('success.backToDashboard')}
          </button>
        </div>
      );
    }

    if (state === 'already-checked-in') {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-20 h-20 rounded-full bg-blue-500/20 flex items-center justify-center mb-6">
            <CheckCircle2 size={48} className="text-blue-500" />
          </div>
          <h2 className="text-2xl font-bold text-theme-text mb-2">{t('alreadyCheckedIn.title')}</h2>
          <p className="text-xl text-theme-text mb-4">{guestName}</p>
          {checkedInAt && (
            <p className="text-theme-text-muted text-sm flex items-center gap-2">
              <Clock size={14} />
              {t('alreadyCheckedIn.checkedInAt', { time: formatCheckInTime(checkedInAt) })}
            </p>
          )}
          <button
            onClick={() => navigate(`/host/${inviteCode}`)}
            className="mt-8 btn-secondary"
          >
            {t('success.backToDashboard')}
          </button>
        </div>
      );
    }

    if (state === 'unauthorized') {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-20 h-20 rounded-full bg-yellow-500/20 flex items-center justify-center mb-6">
            <AlertCircle size={48} className="text-yellow-500" />
          </div>
          <h2 className="text-2xl font-bold text-theme-text mb-2">{t('unauthorized.title')}</h2>
          <p className="text-theme-text-secondary mb-4 max-w-md">{errorMessage}</p>
          <button
            onClick={() => navigate('/')}
            className="mt-4 btn-secondary"
          >
            {t('unauthorized.goHome')}
          </button>
        </div>
      );
    }

    if (state === 'not-found') {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-20 h-20 rounded-full bg-gray-500/20 flex items-center justify-center mb-6">
            <XCircle size={48} className="text-gray-500" />
          </div>
          <h2 className="text-2xl font-bold text-theme-text mb-2">{t('notFound.title')}</h2>
          <p className="text-theme-text-secondary mb-4 max-w-md">{errorMessage}</p>
          <button
            onClick={() => navigate('/')}
            className="mt-4 btn-secondary"
          >
            {t('notFound.goHome')}
          </button>
        </div>
      );
    }

    // Error state
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-20 h-20 rounded-full bg-[#ff393a]/20 flex items-center justify-center mb-6">
          <XCircle size={48} className="text-[#ff393a]" />
        </div>
        <h2 className="text-2xl font-bold text-theme-text mb-2">{t('error.title')}</h2>
        <p className="text-theme-text-secondary mb-4 max-w-md">{errorMessage}</p>
        <div className="flex gap-4 mt-4">
          <button
            onClick={() => {
              setHasAttemptedCheckIn(false);
              setState('loading');
            }}
            className="btn-primary"
          >
            {t('error.tryAgain')}
          </button>
          <button
            onClick={() => navigate('/')}
            className="btn-secondary"
          >
            {t('error.goHome')}
          </button>
        </div>
      </div>
    );
  };

  return (
    <Layout>
      <div className="max-w-md mx-auto px-4 py-12">
        <div className="card p-8">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold text-theme-text mb-2">{t('title')}</h1>
          </div>
          {renderContent()}
        </div>
      </div>
    </Layout>
  );
}
