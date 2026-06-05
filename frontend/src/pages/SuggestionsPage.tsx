import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { ClickableEmail } from '../components/ClickableEmail';
import { ReceiptLightbox } from '../components/payments-shared/ReceiptLightbox';
import { Shield, Loader2, ExternalLink, Lightbulb, MessageSquare } from 'lucide-react';
import { fetchSuggestions } from '../lib/api';
import type { Suggestion } from '../lib/api';

// scarpetta-58472: view-only list of site-wide suggestions. The backend
// endpoint IS the access gate (admins / super-admins / active underbosses);
// any error (403 / 401 / network) renders the Access-Denied screen.
export function SuggestionsPage() {
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetchSuggestions();
        if (cancelled) return;
        setSuggestions(res.suggestions);
      } catch {
        if (!cancelled) setDenied(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="flex items-center justify-center py-32">
          <Loader2 size={32} className="animate-spin text-gray-400" />
        </div>
        <Footer />
      </div>
    );
  }

  if (denied) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="flex flex-col items-center justify-center px-4 py-32">
          <Shield size={48} className="text-red-400/60 mb-4" />
          <h1 className="text-2xl font-bold mb-2 text-gray-900">Access Denied</h1>
          <p className="text-gray-500 text-center max-w-md">
            You don't have permission to view suggestions. This page is for admins
            and underbosses only.
          </p>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Helmet>
        <title>Suggestions | RSV.Pizza</title>
      </Helmet>

      <Header />

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
            <Lightbulb size={20} className="text-amber-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Suggestions</h1>
            <p className="text-sm text-gray-500">
              {suggestions.length} {suggestions.length === 1 ? 'suggestion' : 'suggestions'} submitted from across the site
            </p>
          </div>
        </div>

        {suggestions.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center">
            <MessageSquare size={40} className="mx-auto text-gray-300 mb-3" />
            <h2 className="text-lg font-semibold text-gray-700 mb-1">No suggestions yet</h2>
            <p className="text-sm text-gray-500">
              When people submit suggestions, they'll show up here.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {suggestions.map((s) => {
              const hasSubmitter = !!(s.name || s.email);
              return (
                <div
                  key={s.id}
                  className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200 capitalize">
                      {s.status}
                    </span>
                    <span className="text-xs text-gray-400 whitespace-nowrap">
                      {new Date(s.createdAt).toLocaleDateString(undefined, {
                        year: 'numeric', month: 'short', day: 'numeric',
                      })}
                    </span>
                  </div>

                  <p className="text-gray-900 text-base whitespace-pre-wrap break-words mb-4">
                    {s.body}
                  </p>

                  {s.imageUrl && (
                    <button
                      type="button"
                      onClick={() => setLightboxUrl(s.imageUrl)}
                      className="block mb-4 rounded-xl overflow-hidden border border-gray-200 hover:opacity-90 transition-opacity"
                      title="Click to enlarge"
                    >
                      <img
                        src={s.imageUrl}
                        alt="Suggestion attachment"
                        className="max-h-48 w-auto object-cover"
                      />
                    </button>
                  )}

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
                    <span className="flex items-center gap-1.5">
                      {hasSubmitter ? (
                        <>
                          {s.name && <span className="text-gray-700 font-medium">{s.name}</span>}
                          {s.email && (
                            <ClickableEmail email={s.email} className="text-gray-500" />
                          )}
                        </>
                      ) : (
                        <span className="italic text-gray-400">Anonymous</span>
                      )}
                    </span>

                    {s.pageUrl && (
                      <a
                        href={s.pageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-700 hover:underline"
                      >
                        submitted from {s.pageUrl}
                        <ExternalLink size={12} className="opacity-60" />
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <Footer />

      <ReceiptLightbox
        isOpen={lightboxUrl != null}
        images={lightboxUrl ? [{ url: lightboxUrl, fileName: 'Suggestion attachment' }] : []}
        onClose={() => setLightboxUrl(null)}
      />
    </div>
  );
}
