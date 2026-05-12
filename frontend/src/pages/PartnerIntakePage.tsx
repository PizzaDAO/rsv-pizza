import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { getPartnerIntake, submitPartnerIntake, PartnerIntakeData, PartnerIntakeResponse } from '../lib/api';
import { PartnerForm, PartnerFormData } from '../components/sponsors/PartnerForm';

/** Shape a PartnerFormData into the subset accepted by the partner intake endpoint. */
function partnerFormDataToIntakeData(data: PartnerFormData): PartnerIntakeData {
  return {
    name: data.name?.trim() || undefined,
    website: data.website || undefined,
    brandTwitter: data.brandTwitter || undefined,
    brandInstagram: data.brandInstagram || undefined,
    brandDescription: data.brandDescription || undefined,
    contactName: data.contactName || undefined,
    contactEmail: data.contactEmail || undefined,
    contactPhone: data.contactPhone || undefined,
    contactTwitter: data.contactTwitter || undefined,
    telegram: data.telegram || undefined,
    sponsorshipType: data.sponsorshipType,
    productService: data.productService || undefined,
    logoUrl: data.logoUrl || undefined,
    sponsorMessage: data.sponsorMessage || undefined,
  };
}

export function PartnerIntakePage() {
  const { t } = useTranslation('partner');
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [eventName, setEventName] = useState('');
  const [sponsor, setSponsor] = useState<PartnerIntakeResponse['sponsor'] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [previouslySubmitted, setPreviouslySubmitted] = useState(false);

  // Load sponsor data on mount
  useEffect(() => {
    if (!token) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    async function loadData() {
      const result = await getPartnerIntake(token!);
      if (!result) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      setEventName(result.eventName);
      setSponsor(result.sponsor);
      setPreviouslySubmitted(!!result.sponsor.intakeSubmittedAt);
      setLoading(false);
    }

    loadData();
  }, [token]);

  const handleSubmit = async (data: PartnerFormData) => {
    if (!token) return;
    setSubmitting(true);
    try {
      const payload = partnerFormDataToIntakeData(data);
      await submitPartnerIntake(token, payload);
      setSubmitted(true);
    } catch (err) {
      // PartnerForm catches thrown errors and surfaces them via its error banner
      throw err;
    } finally {
      setSubmitting(false);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-[#1a1a2e] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-white/50" />
      </div>
    );
  }

  // Not found / invalid token
  if (notFound) {
    return (
      <div className="min-h-screen bg-[#1a1a2e] flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white mb-2">{t('intake.linkNotFound')}</h1>
          <p className="text-white/60">
            {t('intake.linkNotFoundDesc')}
          </p>
        </div>
      </div>
    );
  }

  // Success state
  if (submitted) {
    return (
      <div className="min-h-screen bg-[#1a1a2e] flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <CheckCircle className="w-16 h-16 text-green-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white mb-2">{t('intake.thankYou')}</h1>
          <p className="text-white/60 mb-4">
            Your partner information for <span className="text-white font-medium">{eventName}</span> has been submitted successfully.
          </p>
          <p className="text-white/40 text-sm">
            {t('intake.revisitLink')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#1a1a2e] py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl md:text-3xl font-bold text-white mb-2">
            {t('intake.headerTitle', { eventName })}
          </h1>
          <p className="text-white/60">
            {previouslySubmitted
              ? t('intake.headerDescUpdate')
              : t('intake.headerDescNew')}
          </p>
        </div>

        {/* Form */}
        <div className="bg-[#16213e] rounded-xl border border-white/10">
          <PartnerForm
            mode="intake"
            intakeInitialData={sponsor}
            eventName={eventName}
            wasPreviouslySubmitted={previouslySubmitted}
            isLoading={submitting}
            onSubmit={handleSubmit}
          />
        </div>

        {/* Footer */}
        <div className="text-center mt-6">
          <p className="text-white/30 text-xs">
            Powered by <a href="https://rsv.pizza" className="text-white/40 hover:text-white/60 transition-colors">RSV.Pizza</a>
          </p>
        </div>
      </div>
    </div>
  );
}
