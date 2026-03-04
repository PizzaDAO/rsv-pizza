import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, AlertCircle, FileText, Lock } from 'lucide-react';
import { EventReport } from '../types';
import { checkReportPassword, fetchPublicReport } from '../lib/api';
import { ReportPreview } from '../components/report/ReportPreview';
import { Layout } from '../components/Layout';
import { IconInput } from '../components/IconInput';

export function PublicReportPage() {
  const { slug } = useParams<{ slug: string }>();
  const [report, setReport] = useState<EventReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [eventName, setEventName] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!slug) return;

    async function checkAccess() {
      try {
        // First check if password is required
        const check = await checkReportPassword(slug!);
        if (!check) {
          setError('Report not found');
          setLoading(false);
          return;
        }

        if (check.requiresPassword) {
          setRequiresPassword(true);
          setEventName(check.name);
          setLoading(false);
          return;
        }

        // No password needed, load directly
        const result = await fetchPublicReport(slug!);
        if (result?.report) {
          setReport(result.report);
        } else {
          setError('Report not found');
        }
      } catch (err) {
        setError('Failed to load report');
        console.error('Error loading public report:', err);
      } finally {
        setLoading(false);
      }
    }

    checkAccess();
  }, [slug]);

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!slug || !password.trim()) return;

    setSubmitting(true);
    setPasswordError(false);

    try {
      const result = await fetchPublicReport(slug, password.trim());
      if (result?.report) {
        setReport(result.report);
        setRequiresPassword(false);
      } else {
        setPasswordError(true);
      }
    } catch {
      setPasswordError(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <Layout>
        <div className="max-w-4xl mx-auto py-12 px-4 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-[#ff393a]" />
        </div>
      </Layout>
    );
  }

  if (error || (!report && !requiresPassword)) {
    return (
      <Layout>
        <div className="max-w-4xl mx-auto py-12 px-4">
          <div className="card p-8 text-center">
            {error === 'Report not found' ? (
              <>
                <FileText className="w-16 h-16 text-white/20 mx-auto mb-4" />
                <h2 className="text-xl font-semibold text-white mb-2">Report Not Found</h2>
                <p className="text-white/60">This report may have been unpublished or the link is invalid.</p>
              </>
            ) : (
              <div className="flex items-center justify-center gap-3 text-red-400">
                <AlertCircle size={24} />
                <span>{error || 'Failed to load report'}</span>
              </div>
            )}
          </div>
        </div>
      </Layout>
    );
  }

  if (requiresPassword && !report) {
    return (
      <Layout>
        <div className="max-w-4xl mx-auto py-12 px-4">
          <div className="card p-8 max-w-md mx-auto text-center">
            <Lock className="w-12 h-12 text-white/30 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-white mb-2">Password Protected</h2>
            {eventName && (
              <p className="text-white/60 mb-4">{eventName}</p>
            )}
            <p className="text-white/40 text-sm mb-6">Enter the password to view this report.</p>
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <IconInput
                icon={Lock}
                type="password"
                placeholder="Enter password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setPasswordError(false);
                }}
              />
              {passwordError && (
                <p className="text-red-400 text-sm">Incorrect password</p>
              )}
              <button
                type="submit"
                disabled={submitting || !password.trim()}
                className="w-full py-2 px-4 bg-[#ff393a] hover:bg-[#ff393a]/80 disabled:opacity-50 rounded-lg text-white font-medium transition-colors"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                ) : (
                  'View Report'
                )}
              </button>
            </form>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-4xl mx-auto py-8 px-4">
        <ReportPreview report={report!} />
      </div>
    </Layout>
  );
}
