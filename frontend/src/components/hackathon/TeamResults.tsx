import { Medal, MessageSquareHeart } from 'lucide-react';
import { PAYOUT_LABEL, ordinal, type TeamResults as TeamResultsData } from '../../lib/hackathonApi';

/**
 * The team's own results after the reveal (plans §16 Q8, PR 5): its awards with payout status
 * (the recipient also sees the wallet + reference on record) and the judges' written feedback.
 * The API sends feedback as text only: no judge names, scores or private comments.
 */
export function TeamResults({ results }: { results: TeamResultsData }) {
  return (
    <div className="rounded-xl border border-theme-stroke bg-theme-surface p-4" data-testid="hackathon-team-results">
      <p className="text-xs uppercase tracking-wide text-theme-text-muted mb-2">Results</p>
      {results.awards.length > 0 ? (
        <ul className="space-y-2 mb-3">
          {results.awards.map((a, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <Medal size={18} className="text-theme-accent shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-theme-text break-words">
                  {a.prizeName}{a.place && a.place > 1 ? ` (${ordinal(a.place)})` : ''}{a.prizeAmount ? ` · ${a.prizeAmount}` : ''}
                </p>
                <p className="text-xs text-theme-text-muted break-words">
                  Prize: {PAYOUT_LABEL[a.payoutStatus].toLowerCase()}
                  {a.isRecipient ? ' · you are the recipient' : a.recipientName ? ` · goes to ${a.recipientName}` : ''}
                </p>
                {a.isRecipient && (a.recipientWallet || a.payoutReference) && (
                  <p className="text-xs text-theme-text-muted break-all mt-0.5">
                    {[a.recipientWallet && `Wallet: ${a.recipientWallet}`, a.payoutReference && `Ref: ${a.payoutReference}`].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-theme-text-secondary mb-3">Results are out. Thanks for building!</p>
      )}
      {results.feedback.length > 0 ? (
        <div>
          <p className="text-sm font-medium text-theme-text flex items-center gap-1.5 mb-1.5">
            <MessageSquareHeart size={16} className="text-theme-text-muted" /> Feedback from the judges
          </p>
          <ul className="space-y-2">
            {results.feedback.map((f, i) => (
              <li key={i} className="text-sm text-theme-text-secondary border-l-2 border-theme-stroke pl-3 whitespace-pre-wrap break-words">{f}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-theme-text-muted">The judges didn&apos;t leave written feedback for your team.</p>
      )}
    </div>
  );
}
