import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Loader2, Ban, RotateCcw, Crown, Github, Video, Presentation, Globe, Search, ChevronDown, ChevronUp, MessageSquareWarning } from 'lucide-react';
import { IconInput } from '../IconInput';
import { ClickableEmail } from '../ClickableEmail';
import { ErrorBanner, SectionCard, ChoicePills } from './shared';
import { StatusBadge } from './ParticipantPanel';
import {
  hackathonModerationApi as api,
  type HostHackathon,
  type HostHackathonTeam,
  type HostSubmissionsResponse,
} from '../../lib/hackathonApi';

const POLL_MS = 30_000;
type Filter = 'all' | 'submitted' | 'draft' | 'none' | 'disqualified';

export function filterTeams(teams: HostHackathonTeam[], filter: Filter, q: string): HostHackathonTeam[] {
  const needle = q.trim().toLowerCase();
  return teams.filter((t) => {
    const s = t.submission?.status;
    if (filter === 'submitted' && s !== 'submitted') return false;
    if (filter === 'draft' && s !== 'draft' && s !== 'withdrawn') return false;
    if (filter === 'none' && t.submission) return false;
    if (filter === 'disqualified' && s !== 'disqualified') return false;
    if (!needle) return true;
    return [t.name, t.submission?.name, ...t.members.flatMap((m) => [m.name, m.email])]
      .some((v) => (v ?? '').toLowerCase().includes(needle));
  });
}

function TeamRow({ team, hackathon, busy, onModerate }: {
  team: HostHackathonTeam;
  hackathon: HostHackathon;
  busy: boolean;
  onModerate: (submissionId: string, body: { action: 'disqualify' | 'restore'; reason?: string }) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const s = team.submission;
  const trackNames = s ? hackathon.tracks.filter((t) => s.trackIds.includes(t.id)).map((t) => t.name) : [];
  const links = s
    ? ([[Github, 'Repo', s.repoUrl], [Video, 'Demo', s.demoVideoUrl], [Presentation, 'Deck', s.deckUrl], [Globe, 'Live', s.liveUrl]] as const).filter(([, , u]) => !!u)
    : [];

  return (
    <li className="py-3" data-testid="hackathon-host-team">
      <button type="button" className="w-full flex items-start gap-3 text-left min-h-[44px]" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-theme-text break-words">{s?.name || <span className="text-theme-text-muted font-normal">No project yet</span>}</p>
          <p className="text-xs text-theme-text-muted break-words">
            {team.name} · {team.memberCount} member{team.memberCount === 1 ? '' : 's'}{trackNames.length ? ` · ${trackNames.join(', ')}` : ''}
          </p>
        </div>
        {s && <StatusBadge status={s.status} />}
        {open ? <ChevronUp size={16} className="text-theme-text-muted mt-0.5 shrink-0" /> : <ChevronDown size={16} className="text-theme-text-muted mt-0.5 shrink-0" />}
      </button>

      {open && (
        <div className="mt-3 space-y-3 pl-0 sm:pl-1">
          <ul className="space-y-1">
            {team.members.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-x-2 text-sm min-w-0">
                <span className="text-theme-text">{m.name}</span>
                {m.role === 'captain' && <Crown size={12} className="text-theme-accent" aria-label="Captain" />}
                {m.email && <span className="text-theme-text-muted text-xs min-w-0 break-all"><ClickableEmail email={m.email} /></span>}
              </li>
            ))}
          </ul>
          {s && (
            <>
              {s.tagline && <p className="text-sm text-theme-text-secondary break-words">{s.tagline}</p>}
              {s.description && <p className="text-sm text-theme-text-secondary whitespace-pre-wrap break-words line-clamp-6">{s.description}</p>}
              {links.length > 0 && (
                <div className="flex flex-wrap gap-3">
                  {links.map(([Icon, label, u]) => (
                    <a key={label} href={u!} target="_blank" rel="noopener noreferrer nofollow ugc" className="text-sm text-theme-accent inline-flex items-center gap-1 underline">
                      <Icon size={14} /> {label}
                    </a>
                  ))}
                </div>
              )}
              {(s.cover || s.screenshots.length > 0) && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {[s.cover, ...s.screenshots].filter(Boolean).map((img, i) => img!.url && (
                    <a key={img!.path} href={img!.url} target="_blank" rel="noopener noreferrer">
                      <img src={img!.url} alt={i === 0 && s.cover ? 'Cover' : `Screenshot ${i}`} className="h-16 w-24 object-cover rounded-md border border-theme-stroke shrink-0" />
                    </a>
                  ))}
                </div>
              )}
              {s.status === 'disqualified' && s.disqualifiedReason && (
                <p className="text-sm text-theme-error flex items-start gap-1.5"><MessageSquareWarning size={14} className="mt-0.5 shrink-0" /> {s.disqualifiedReason}</p>
              )}
              <div className="flex flex-wrap gap-2">
                {s.status === 'disqualified' ? (
                  <button type="button" className="btn-secondary text-sm inline-flex items-center gap-2" disabled={busy}
                    onClick={() => void onModerate(s.id, { action: 'restore' })}>
                    <RotateCcw size={14} /> Restore
                  </button>
                ) : reason === null ? (
                  <button type="button" className="btn-secondary text-sm inline-flex items-center gap-2" disabled={busy} onClick={() => setReason('')}>
                    <Ban size={14} /> Disqualify
                  </button>
                ) : (
                  <form
                    className="w-full space-y-2"
                    onSubmit={(e) => { e.preventDefault(); void onModerate(s.id, { action: 'disqualify', reason }).then((ok) => ok && setReason(null)); }}
                  >
                    <IconInput icon={Ban} value={reason} maxLength={1000} placeholder="Reason (the team sees this)" onChange={(e) => setReason(e.target.value)} autoFocus />
                    <div className="flex gap-2">
                      <button type="submit" className="btn-primary text-sm" disabled={busy || !reason.trim()}>Disqualify</button>
                      <button type="button" className="btn-secondary text-sm" onClick={() => setReason(null)}>Cancel</button>
                    </div>
                  </form>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </li>
  );
}

/** Host "Teams & Submissions" (plans/hackathon-platform.md §8, PR 3): list, moderation, CSV. */
export function TeamsSubmissionsSection({ partyId, hackathon }: { partyId: string; hackathon: HostHackathon }) {
  const [data, setData] = useState<HostSubmissionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [exporting, setExporting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.list(partyId));
    } catch (e: any) {
      setError(e?.message || 'Could not load teams');
    }
  }, [partyId]);

  useEffect(() => {
    void load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, POLL_MS);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [load]);

  const moderate = useCallback(async (submissionId: string, body: { action: 'disqualify' | 'restore'; reason?: string }) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.moderate(partyId, submissionId, body);
      if (res.team) setData((d) => d && { ...d, teams: d.teams.map((t) => (t.id === res.team!.id ? res.team! : t)) });
      void load();
      return true;
    } catch (e: any) {
      setError(e?.message || 'Something went wrong');
      return false;
    } finally {
      setBusy(false);
    }
  }, [partyId, load]);

  const shown = useMemo(() => (data ? filterTeams(data.teams, filter, q) : []), [data, filter, q]);

  const exportCsv = async (kind: 'projects' | 'members') => {
    setExporting(kind);
    try {
      await api.exportCsv(partyId, kind);
    } catch (e: any) {
      setError(e?.message || 'Export failed');
    } finally {
      setExporting(null);
    }
  };

  const c = data?.counts;
  return (
    <div className="space-y-4" data-testid="hackathon-submissions-section">
      <SectionCard
        title="Teams & Submissions"
        subtitle={c ? `${c.teams} team${c.teams === 1 ? '' : 's'} · ${c.submitted} submitted · ${c.draft + c.withdrawn} in progress${c.disqualified ? ` · ${c.disqualified} disqualified` : ''}` : 'Loading...'}
        action={
          <div className="flex flex-col sm:flex-row gap-2 shrink-0">
            <button type="button" className="btn-secondary text-sm inline-flex items-center gap-2" disabled={!!exporting} onClick={() => void exportCsv('projects')}>
              {exporting === 'projects' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Projects CSV
            </button>
            <button type="button" className="btn-secondary text-sm inline-flex items-center gap-2" disabled={!!exporting} onClick={() => void exportCsv('members')}>
              {exporting === 'members' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Members CSV
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          <IconInput icon={Search} value={q} placeholder="Search teams, projects, members" onChange={(e) => setQ(e.target.value)} />
          <ChoicePills<Filter>
            ariaLabel="Filter"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'submitted', label: 'Submitted' },
              { value: 'draft', label: 'In progress' },
              { value: 'none', label: 'No project' },
              { value: 'disqualified', label: 'Disqualified' },
            ]}
          />
        </div>
        <ErrorBanner message={error} onClose={() => setError(null)} />
        {!data ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-theme-text-muted" /></div>
        ) : shown.length === 0 ? (
          <p className="text-sm text-theme-text-muted py-6 text-center">
            {data.teams.length === 0 ? 'No teams yet. Approved guests can create teams from the event page once the hackathon is published.' : 'Nothing matches.'}
          </p>
        ) : (
          <ul className="divide-y divide-theme-stroke mt-2">
            {shown.map((t) => <TeamRow key={t.id} team={t} hackathon={hackathon} busy={busy} onModerate={moderate} />)}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
