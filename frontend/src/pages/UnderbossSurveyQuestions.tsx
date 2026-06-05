import { Loader2 } from 'lucide-react';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { SurveyQuestionsTab } from '../components/underboss';
import { useIsAdminOrUnderboss } from '../hooks/useIsAdminOrUnderboss';

/**
 * pugliese-58297: standalone admin page wrapper for the survey question CRUD
 * UI. The same `SurveyQuestionsTab` component is also rendered as a tab on
 * UnderbossDashboard — this page exists for direct URL access (and so
 * permission rules can be applied page-level via `useIsAdminOrUnderboss`).
 *
 * Hooks order rule: every hook is declared above any conditional return.
 */
export function UnderbossSurveyQuestions() {
  const allowed = useIsAdminOrUnderboss();

  if (allowed === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 size={28} className="animate-spin text-theme-text-muted" />
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 flex items-center justify-center px-4">
          <p className="text-theme-text-muted">Not authorized.</p>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col gpp-theme" style={{ background: 'linear-gradient(180deg, #7EC8E3 0%, #B6E4F7 100%)' }}>
      <Header />
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-8">
        <h1 className="text-2xl font-semibold text-theme-text mb-4">Survey questions</h1>
        <SurveyQuestionsTab />
      </main>
      <Footer />
    </div>
  );
}
