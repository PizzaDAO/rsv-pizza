import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, AlertCircle, FileText } from 'lucide-react';
import { EventReport } from '../types';
import { getPublicReport } from '../lib/api';
import { ReportPreview } from '../components/report/ReportPreview';
import { Layout } from '../components/Layout';

export function PublicReportPage() {
  const { slug } = useParams<{ slug: string }>();
  const [report, setReport] = useState<EventReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;

    async function loadReport() {
      try {
        const result = await getPublicReport(slug!);
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

    loadReport();
  }, [slug]);

  if (loading) {
    return (
      <Layout>
        <div className="max-w-4xl mx-auto py-12 px-4 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-[#ff393a]" />
        </div>
      </Layout>
    );
  }

  if (error || !report) {
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

  return (
    <Layout>
      <div className="max-w-4xl mx-auto py-8 px-4">
        <ReportPreview report={report} />
      </div>
    </Layout>
  );
}
