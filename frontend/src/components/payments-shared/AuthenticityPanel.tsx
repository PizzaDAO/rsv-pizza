import React, { useState } from 'react';
import { Loader2, ShieldCheck, ShieldAlert, ShieldX, RefreshCw, Sparkles, Download, AlertTriangle } from 'lucide-react';
import {
  verifyImageAuthenticity,
  type ImageAuthenticityCheck,
  type ImageAuthenticityVerdict,
} from '../../lib/api';

/**
 * marinara-61455: shared "Verify authenticity" panel used by both the receipt
 * editor (in the lightbox) and the admin event-cover surface. Renders a
 * "Verify authenticity" button when no check exists, and a verdict banner +
 * reasons + a "Re-check" (force) button once a verdict is present.
 *
 * Advisory-only by design — the panel never disables a send / approve; it just
 * surfaces the AI/doctored signal for a human reviewer. Purple palette (distinct
 * from red=duplicate / amber=ineligible) so the three signals don't collide.
 */

export interface AuthenticityPanelProps {
  imageUrl: string;
  sourceKind: 'receipt' | 'event_image';
  partyId?: string | null;
  payoutDocumentId?: string | null;
  /** Prior cached check, if the parent already loaded one. */
  initialCheck?: ImageAuthenticityCheck | null;
  /** Notified after a (re-)check completes so the parent can drive overlays. */
  onResult?: (check: ImageAuthenticityCheck) => void;
  /** Compact layout (smaller paddings) for tight surfaces like the event card. */
  compact?: boolean;
}

const VERDICT_META: Record<
  ImageAuthenticityVerdict,
  { label: string; Icon: typeof ShieldCheck; classes: string; dot: string }
> = {
  authentic: {
    label: 'Likely authentic',
    Icon: ShieldCheck,
    classes: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300',
    dot: 'bg-emerald-500',
  },
  suspicious: {
    label: 'Suspicious — needs review',
    Icon: ShieldAlert,
    classes: 'bg-purple-500/15 border-purple-500/40 text-purple-200',
    dot: 'bg-purple-500',
  },
  likely_fake: {
    label: 'Likely AI-generated / doctored',
    Icon: ShieldX,
    classes: 'bg-fuchsia-600/20 border-fuchsia-500/50 text-fuchsia-200',
    dot: 'bg-fuchsia-500',
  },
};

/** Pull a flat reason list out of the persisted `reasons` jsonb for display. */
function extractReasons(reasons: unknown): string[] {
  if (!reasons || typeof reasons !== 'object') return [];
  const r = reasons as Record<string, unknown>;
  const out: string[] = [];
  if (Array.isArray(r.signals)) {
    for (const s of r.signals) {
      if (s && typeof s === 'object') {
        const sig = s as Record<string, unknown>;
        if (sig.fired === true && typeof sig.detail === 'string') {
          out.push(sig.detail);
        }
      }
    }
  }
  const vision = r.vision as Record<string, unknown> | undefined;
  if (vision && Array.isArray(vision.observations)) {
    for (const o of vision.observations) {
      if (typeof o === 'string' && o.trim()) out.push(o.trim());
    }
  }
  // De-dup while preserving order.
  return Array.from(new Set(out)).slice(0, 12);
}

export const AuthenticityPanel: React.FC<AuthenticityPanelProps> = ({
  imageUrl,
  sourceKind,
  partyId,
  payoutDocumentId,
  initialCheck = null,
  onResult,
  compact = false,
}) => {
  const [check, setCheck] = useState<ImageAuthenticityCheck | null>(initialCheck);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep local state in sync if the parent swaps the cached check (e.g. lightbox
  // navigates to a different receipt).
  React.useEffect(() => {
    setCheck(initialCheck);
    setError(null);
  }, [initialCheck, imageUrl]);

  async function run(force: boolean) {
    setLoading(true);
    setError(null);
    try {
      const { check: next } = await verifyImageAuthenticity({
        imageUrl,
        sourceKind,
        partyId,
        payoutDocumentId,
        force,
      });
      setCheck(next);
      onResult?.(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authenticity check failed');
    } finally {
      setLoading(false);
    }
  }

  const pad = compact ? 'p-2' : 'p-3';

  if (!check) {
    return (
      <div className={`rounded-lg border border-purple-500/30 bg-purple-500/5 ${pad} space-y-1.5`}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-purple-200 inline-flex items-center gap-1.5">
            <Sparkles size={12} /> Image authenticity
          </span>
          <button
            type="button"
            onClick={() => run(false)}
            disabled={loading}
            className="px-2.5 py-1 rounded border border-purple-500/40 text-purple-200 text-xs disabled:opacity-40 inline-flex items-center gap-1.5 hover:bg-purple-500/10"
            title="Run an AI-generated / doctored check on this image"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />}
            Verify authenticity
          </button>
        </div>
        <p className="text-[11px] text-white/40">
          Advisory only — flags AI-generated / doctored images for review. Never auto-rejects.
        </p>
        {error && (
          <div className="text-[11px] text-red-300 flex items-start gap-1.5">
            <AlertTriangle size={11} className="flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
      </div>
    );
  }

  const meta = VERDICT_META[check.verdict] ?? VERDICT_META.suspicious;
  const { Icon } = meta;
  const reasons = extractReasons(check.reasons);

  return (
    <div className={`rounded-lg border ${meta.classes} ${pad} space-y-2`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wide inline-flex items-center gap-1.5">
          <Icon size={13} />
          {meta.label}
        </span>
        <span className="text-[11px] opacity-80">score {check.score}/100</span>
      </div>

      {reasons.length > 0 && (
        <ul className="space-y-0.5">
          {reasons.map((reason, i) => (
            <li key={i} className="text-[11px] leading-snug opacity-90 flex items-start gap-1.5">
              <span className={`inline-block w-1 h-1 rounded-full ${meta.dot} mt-1.5 flex-shrink-0`} />
              <span>{reason}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <button
          type="button"
          onClick={() => run(true)}
          disabled={loading}
          className="px-2.5 py-1 rounded border border-white/20 text-xs disabled:opacity-40 inline-flex items-center gap-1.5 hover:bg-white/10"
          title="Re-run the check (bypasses the cache; costs an API call)"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Re-check
        </button>
        {check.elaArtifactUrl && (
          <a
            href={check.elaArtifactUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-2.5 py-1 rounded border border-white/20 text-xs inline-flex items-center gap-1.5 hover:bg-white/10"
            title="Download the error-level-analysis overlay (tampered regions stand out)"
          >
            <Download size={12} /> ELA overlay
          </a>
        )}
        <span className="text-[10px] opacity-60 ml-auto">
          {check.provider} · {new Date(check.checkedAt).toLocaleDateString()}
        </span>
      </div>

      {error && (
        <div className="text-[11px] text-red-300 flex items-start gap-1.5">
          <AlertTriangle size={11} className="flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};
