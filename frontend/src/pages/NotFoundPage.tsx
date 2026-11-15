import { Link } from 'react-router';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { AlertCircle } from 'lucide-react';

/** Catch-all for paths no route matches (one-segment paths go to EventPage's own "not found"). */
export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Helmet>
        <meta name="robots" content="noindex" />
      </Helmet>
      <div className="card p-8 max-w-md text-center">
        <AlertCircle className="w-16 h-16 text-[#ff393a] mx-auto mb-4" />
        <h1 className="text-2xl font-bold text-theme-text mb-2">{t('notFound.title')}</h1>
        <p className="text-theme-text-secondary mb-6">{t('notFound.description')}</p>
        <Link to="/" className="btn-primary inline-block">
          {t('notFound.goHome')}
        </Link>
      </div>
    </div>
  );
}
