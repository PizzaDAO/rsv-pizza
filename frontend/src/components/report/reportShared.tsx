import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, Globe } from 'lucide-react';
import { NotableAttendee } from '../../types';
import { extractEmailDomain, getDomainFaviconUrl } from '../../utils/emailUtils';

// pecorino-64118: shared report building blocks, extracted from ReportPreview so
// both ReportPreview and ConsolidatedReportPreview render identical KPI cards,
// org favicons, and the org-grouped notable-attendee chips.

export interface KPICardProps {
  label: string;
  value: number;
  icon: React.ElementType;
  color: string;
  url?: string | null;
  onAction?: () => void;
  actionIcon?: React.ElementType;
}

export function KPICard({ label, value, icon: Icon, color, url, onAction, actionIcon: ActionIcon }: KPICardProps) {
  const { t } = useTranslation('host');
  const content = (
    <div className="bg-theme-surface rounded-xl p-4 border border-theme-stroke">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} className={color} />
        <span className="text-xs text-theme-text-secondary flex-1">{label}</span>
        {onAction && ActionIcon && (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onAction(); }}
            className="p-1 rounded hover:bg-theme-surface-hover transition-colors text-theme-text-muted hover:text-theme-text"
            title={`Download ${label}`}
          >
            <ActionIcon size={14} />
          </button>
        )}
      </div>
      <div className="text-2xl font-bold text-theme-text">
        {value.toLocaleString()}
      </div>
      {url && (
        <span className="text-xs text-theme-text-muted hover:text-theme-text-secondary underline mt-1 block truncate">
          {t('report.viewPost')}
        </span>
      )}
    </div>
  );

  if (url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer">
        {content}
      </a>
    );
  }

  return content;
}

// Group attendees by org domain
export function groupAttendeesByOrg(attendees: NotableAttendee[]) {
  const map = new Map<string, NotableAttendee[]>();
  const independent: NotableAttendee[] = [];

  for (const a of attendees) {
    const domain = a.email ? extractEmailDomain(a.email, true) : null;
    if (domain) {
      const list = map.get(domain) || [];
      list.push(a);
      map.set(domain, list);
    } else {
      independent.push(a);
    }
  }

  const groups: { domain: string | null; attendees: NotableAttendee[] }[] = [...map.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([domain, members]) => ({ domain, attendees: members }));

  if (independent.length > 0) {
    groups.push({ domain: null, attendees: independent });
  }

  return groups;
}

export function ReportOrgFavicon({ domain, size = 20 }: { domain: string; size?: number }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        className="rounded bg-theme-surface-hover flex items-center justify-center flex-shrink-0"
        style={{ width: size, height: size }}
      >
        <span className="text-[10px] font-bold text-theme-text-secondary uppercase">{domain.charAt(0)}</span>
      </div>
    );
  }

  return (
    <img
      src={getDomainFaviconUrl(domain, size * 2)}
      alt={domain}
      width={size}
      height={size}
      className="rounded flex-shrink-0"
      onError={() => setFailed(true)}
    />
  );
}

export function ReportOrgCard({ group }: { group: { domain: string | null; attendees: NotableAttendee[] } }) {
  const { domain, attendees } = group;

  return (
    <div className="inline-flex items-center gap-2 bg-theme-surface rounded-lg px-3 py-2 border border-theme-stroke">
      {domain ? (
        <>
          <ReportOrgFavicon domain={domain} size={16} />
          <a
            href={`https://${domain}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-theme-text-secondary hover:text-theme-text transition-colors"
          >
            {domain}
          </a>
          {attendees.length > 1 && (
            <span className="text-xs text-theme-text-muted">({attendees.length})</span>
          )}
        </>
      ) : (
        <>
          <Building2 size={14} className="text-theme-text-muted" />
          {attendees.map((a) =>
            a.link ? (
              <a
                key={a.id}
                href={a.link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-theme-text-secondary hover:text-theme-text transition-colors"
              >
                {a.name}
                <Globe size={12} className="text-theme-text-muted flex-shrink-0" />
              </a>
            ) : (
              <span key={a.id} className="text-sm text-theme-text-secondary">{a.name}</span>
            )
          )}
        </>
      )}
    </div>
  );
}
