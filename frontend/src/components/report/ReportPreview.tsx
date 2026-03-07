import React, { useState, useEffect, useCallback } from 'react';
import { Calendar, MapPin, Users, Mail, Wallet, Award, Video, Eye, ExternalLink, X, MousePointerClick, FileText, Download, Building2, ChevronLeft, ChevronRight } from 'lucide-react';
import { EventReport, PageViewStats, NotableAttendee, Photo } from '../../types';
import { ReportRoleChart } from './ReportRoleChart';
import { SocialPostsList } from './SocialPostsList';
import { extractEmailDomain, getDomainFaviconUrl } from '../../utils/emailUtils';

interface ReportPreviewProps {
  report: EventReport;
  onClose?: () => void;
  pageViewStats?: PageViewStats | null;
}

export function ReportPreview({ report, onClose, pageViewStats }: ReportPreviewProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const config = report.reportStatsConfig || {};
  const socialPostViews = report.socialPosts.reduce((sum, p) => sum + (p.views || 0), 0);
  const socialPostCount = report.socialPosts.length;

  // Build stats list with config-aware values
  const downloadWallets = report.walletAddressList && report.walletAddressList.length > 0 ? () => {
    const csv = 'wallet_address\n' + report.walletAddressList!.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${report.name.replace(/[^a-zA-Z0-9]/g, '_')}_wallet_addresses.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } : undefined;

  const statsDefs: { key: string; label: string; autoValue: number | null | undefined; icon: React.ElementType; color: string; url?: string; onAction?: () => void; actionIcon?: React.ElementType }[] = [
    ...(pageViewStats ? [
      { key: 'pageViews', label: 'Page Views', autoValue: pageViewStats.totalViews, icon: MousePointerClick, color: 'text-[#ff393a]' },
      { key: 'uniqueVisitors', label: 'Unique Visitors', autoValue: pageViewStats.uniqueViews, icon: Eye, color: 'text-[#ff393a]' },
    ] : []),
    { key: 'socialPostViews', label: 'Social Post Views', autoValue: socialPostViews || null, icon: Eye, color: 'text-blue-400' },
    { key: 'socialPosts', label: 'Social Posts', autoValue: socialPostCount || null, icon: FileText, color: 'text-blue-400' },
    { key: 'totalRsvps', label: 'Total RSVPs', autoValue: report.stats.totalRsvps, icon: Users, color: 'text-green-400' },
    { key: 'attendees', label: 'Attendees', autoValue: report.stats.approvedGuests, icon: Users, color: 'text-emerald-400' },
    { key: 'newsletterSignups', label: 'Newsletter Sign-ups', autoValue: report.stats.mailingListSignups, icon: Mail, color: 'text-orange-400' },
    { key: 'walletAddresses', label: 'Wallet Addresses', autoValue: report.stats.walletAddresses, icon: Wallet, color: 'text-cyan-400', onAction: downloadWallets, actionIcon: Download },
    { key: 'poapMints', label: 'POAP Mints', autoValue: report.poapMints, icon: Award, color: 'text-yellow-400', url: report.poapEventId ? `https://poap.gallery/event/${report.poapEventId}` : undefined },
    { key: 'poapMoments', label: 'POAP Moments', autoValue: report.poapMoments, icon: Video, color: 'text-yellow-400' },
  ];

  const visibleStats = statsDefs
    .filter(s => config[s.key]?.hidden !== true)
    .map(s => ({ ...s, value: config[s.key]?.override != null ? config[s.key]!.override! : (s.autoValue ?? null) }))
    .filter(s => s.value != null);

  const hasKPIs = visibleStats.length > 0;

  return (
    <div className="space-y-6">
      {/* Close button if in modal/overlay mode */}
      {onClose && (
        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="p-2 text-white/60 hover:text-white transition-colors"
          >
            <X size={24} />
          </button>
        </div>
      )}

      {/* Header with event info */}
      <div className="bg-white/5 rounded-xl p-6 border border-white/10">
        <div className="flex flex-col md:flex-row gap-6">
          {/* Event image */}
          {report.eventImageUrl && (
            <div className="flex-shrink-0">
              <img
                src={report.eventImageUrl}
                alt={report.name}
                className="w-full md:w-48 h-48 object-cover rounded-xl"
              />
            </div>
          )}
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-white mb-3">{report.name}</h1>

            {report.date && (
              <div className="flex items-center gap-2 text-white/60 text-sm mb-2">
                <Calendar size={16} />
                <span>
                  {new Date(report.date).toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </span>
              </div>
            )}

            {report.venueName && (
              <div className="flex items-center gap-2 text-white/60 text-sm mb-2">
                <MapPin size={16} />
                <span>{report.venueName}{report.address ? ` - ${report.address}` : ''}</span>
              </div>
            )}

            {report.flyerArtist && (
              <p className="text-white/40 text-xs mt-2">
                Flyer by{' '}
                {report.flyerArtistUrl ? (
                  <a href={report.flyerArtistUrl} target="_blank" rel="noopener noreferrer" className="text-white/60 hover:text-white underline">
                    {report.flyerArtist}
                  </a>
                ) : (
                  report.flyerArtist
                )}
              </p>
            )}

            {(report.host?.name || (report.coHosts && report.coHosts.length > 0)) && (
              <p className="text-white/40 text-xs mt-1">
                Hosted by{' '}
                {[
                  ...(report.host?.name ? [{ name: report.host.name }] : []),
                  ...(report.coHosts || []).filter(c => c.showOnEvent !== false),
                ].map((person, i, arr) => {
                  const coHost = 'website' in person ? person as { name: string; website?: string; twitter?: string } : null;
                  const link = coHost?.website || (coHost?.twitter ? `https://x.com/${coHost.twitter.replace(/^@/, '')}` : null);
                  return (
                    <span key={i}>
                      {link ? (
                        <a href={link} target="_blank" rel="noopener noreferrer" className="text-white/60 hover:text-white underline">
                          {person.name}
                        </a>
                      ) : (
                        <span className="text-white/60">{person.name}</span>
                      )}
                      {i < arr.length - 1 ? ', ' : ''}
                    </span>
                  );
                })}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Recap */}
      {report.reportRecap && (
        <div className="bg-white/5 rounded-xl p-6 border border-white/10">
          <h2 className="text-lg font-semibold text-white mb-3">Event Recap</h2>
          <p className="text-white/80 text-sm leading-relaxed whitespace-pre-wrap">{report.reportRecap}</p>
        </div>
      )}

      {/* Media */}
      {(report.reportPhotosUrl || report.featuredPhotos.length > 0) && (
        <div className="bg-white/5 rounded-xl p-6 border border-white/10">
          <h2 className="text-lg font-semibold text-white mb-4">Media</h2>
          {report.featuredPhotos.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 mb-4">
              {report.featuredPhotos.map((photo, i) => (
                <button
                  key={photo.id}
                  onClick={() => setLightboxIndex(i)}
                  className="w-full aspect-square overflow-hidden rounded-lg cursor-pointer hover:opacity-80 transition-opacity"
                >
                  <img
                    src={photo.thumbnailUrl || photo.url}
                    alt={photo.caption || 'Event photo'}
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}
          {report.reportPhotosUrl && (
            <a
              href={report.reportPhotosUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 rounded-lg hover:bg-white/20 transition-colors text-white text-sm"
            >
              <Eye size={16} />
              Raw Photos / Video
              <ExternalLink size={14} className="text-white/40" />
            </a>
          )}
        </div>
      )}

      {/* Photo Lightbox */}
      {lightboxIndex !== null && report.featuredPhotos.length > 0 && (
        <PhotoLightbox
          photos={report.featuredPhotos}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}

      {/* Stats */}
      {hasKPIs && (
        <div className="bg-white/5 rounded-xl p-6 border border-white/10">
          <h2 className="text-lg font-semibold text-white mb-4">Stats</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {visibleStats.map((stat) => (
              <KPICard
                key={stat.key}
                label={stat.label}
                value={stat.value!}
                icon={stat.icon}
                color={stat.color}
                url={stat.url}
                onAction={stat.onAction}
                actionIcon={stat.actionIcon}
              />
            ))}
          </div>
        </div>
      )}

      {/* Industry RSVPs */}
      {report.notableAttendees.length > 0 && (
        <div className="bg-white/5 rounded-xl p-6 border border-white/10">
          <h2 className="text-lg font-semibold text-white mb-3">Industry RSVPs</h2>
          <div className="flex flex-wrap gap-2">
            {groupAttendeesByOrg(report.notableAttendees).map((group) => (
              <ReportOrgCard key={group.domain || '_independent'} group={group} />
            ))}
          </div>
        </div>
      )}

      {/* Role Breakdown */}
      {Object.keys(report.stats.roleBreakdown).length > 0 && (
        <div className="bg-white/5 rounded-xl p-6 border border-white/10">
          <ReportRoleChart roleBreakdown={report.stats.roleBreakdown} totalRsvps={report.stats.totalRsvps} />
        </div>
      )}

      {/* Social Posts */}
      {report.socialPosts.length > 0 && (
        <div className="bg-white/5 rounded-xl p-6 border border-white/10">
          <SocialPostsList
            posts={report.socialPosts}
            onAdd={async () => {}}
            onDelete={async () => {}}
            editable={false}
          />
        </div>
      )}
    </div>
  );
}

// Helper components
interface KPICardProps {
  label: string;
  value: number;
  icon: React.ElementType;
  color: string;
  url?: string | null;
  onAction?: () => void;
  actionIcon?: React.ElementType;
}

function KPICard({ label, value, icon: Icon, color, url, onAction, actionIcon: ActionIcon }: KPICardProps) {
  const content = (
    <div className="bg-white/5 rounded-xl p-4 border border-white/10">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} className={color} />
        <span className="text-xs text-white/60 flex-1">{label}</span>
        {onAction && ActionIcon && (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onAction(); }}
            className="p-1 rounded hover:bg-white/10 transition-colors text-white/40 hover:text-white"
            title={`Download ${label}`}
          >
            <ActionIcon size={14} />
          </button>
        )}
      </div>
      <div className="text-2xl font-bold text-white">
        {value.toLocaleString()}
      </div>
      {url && (
        <span className="text-xs text-white/40 hover:text-white/60 underline mt-1 block truncate">
          View post
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
function groupAttendeesByOrg(attendees: NotableAttendee[]) {
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

  const groups = [...map.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([domain, members]) => ({ domain, attendees: members }));

  if (independent.length > 0) {
    groups.push({ domain: null as string | null, attendees: independent });
  }

  return groups;
}

function ReportOrgFavicon({ domain, size = 20 }: { domain: string; size?: number }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        className="rounded bg-white/10 flex items-center justify-center flex-shrink-0"
        style={{ width: size, height: size }}
      >
        <span className="text-[10px] font-bold text-white/60 uppercase">{domain.charAt(0)}</span>
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

function PhotoLightbox({
  photos,
  index,
  onClose,
  onNavigate,
}: {
  photos: Photo[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}) {
  const photo = photos[index];
  const hasPrev = index > 0;
  const hasNext = index < photos.length - 1;

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowLeft' && hasPrev) onNavigate(index - 1);
    else if (e.key === 'ArrowRight' && hasNext) onNavigate(index + 1);
  }, [index, hasPrev, hasNext, onClose, onNavigate]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Close */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 text-white/60 hover:text-white transition-colors z-10"
      >
        <X size={24} />
      </button>

      {/* Counter */}
      {photos.length > 1 && (
        <div className="absolute top-4 left-4 text-sm text-white/50 z-10">
          {index + 1} / {photos.length}
        </div>
      )}

      {/* Prev */}
      {hasPrev && (
        <button
          onClick={(e) => { e.stopPropagation(); onNavigate(index - 1); }}
          className="absolute left-4 top-1/2 -translate-y-1/2 p-2 text-white/40 hover:text-white transition-colors z-10"
        >
          <ChevronLeft size={32} />
        </button>
      )}

      {/* Image */}
      <img
        src={photo.url}
        alt={photo.caption || 'Event photo'}
        className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg"
        onClick={(e) => e.stopPropagation()}
      />

      {/* Caption */}
      {photo.caption && (
        <div
          className="absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 bg-black/70 rounded-lg text-sm text-white/80 max-w-lg text-center"
          onClick={(e) => e.stopPropagation()}
        >
          {photo.caption}
        </div>
      )}

      {/* Next */}
      {hasNext && (
        <button
          onClick={(e) => { e.stopPropagation(); onNavigate(index + 1); }}
          className="absolute right-4 top-1/2 -translate-y-1/2 p-2 text-white/40 hover:text-white transition-colors z-10"
        >
          <ChevronRight size={32} />
        </button>
      )}
    </div>
  );
}

function ReportOrgCard({ group }: { group: { domain: string | null; attendees: NotableAttendee[] } }) {
  const { domain, attendees } = group;

  return (
    <div className="inline-flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2 border border-white/10">
      {domain ? (
        <>
          <ReportOrgFavicon domain={domain} size={16} />
          <a
            href={`https://${domain}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-white/70 hover:text-white transition-colors"
          >
            {domain}
          </a>
          {attendees.length > 1 && (
            <span className="text-xs text-white/40">({attendees.length})</span>
          )}
        </>
      ) : (
        <>
          <Building2 size={14} className="text-white/40" />
          {attendees.map((a) => (
            <span key={a.id} className="text-sm text-white/70">{a.name}</span>
          ))}
        </>
      )}
    </div>
  );
}
