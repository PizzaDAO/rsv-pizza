import React from 'react';
import { Calendar, MapPin, Users, Mail, Wallet, Award, Video, Eye, ExternalLink, Star, X, MousePointerClick, FileText } from 'lucide-react';
import { EventReport, PageViewStats } from '../../types';
import { ReportRoleChart } from './ReportRoleChart';
import { SocialPostsList } from './SocialPostsList';

interface ReportPreviewProps {
  report: EventReport;
  onClose?: () => void;
  pageViewStats?: PageViewStats | null;
}

export function ReportPreview({ report, onClose, pageViewStats }: ReportPreviewProps) {
  const config = report.reportStatsConfig || {};
  const socialPostViews = report.socialPosts.reduce((sum, p) => sum + (p.views || 0), 0);
  const socialPostCount = report.socialPosts.length;

  // Build stats list with config-aware values
  const statsDefs: { key: string; label: string; autoValue: number | null | undefined; icon: React.ElementType; color: string; url?: string }[] = [
    ...(pageViewStats ? [
      { key: 'pageViews', label: 'Page Views', autoValue: pageViewStats.totalViews, icon: MousePointerClick, color: 'text-[#ff393a]' },
      { key: 'uniqueVisitors', label: 'Unique Visitors', autoValue: pageViewStats.uniqueViews, icon: Eye, color: 'text-[#ff393a]' },
    ] : []),
    { key: 'socialPostViews', label: 'Social Post Views', autoValue: socialPostViews || null, icon: Eye, color: 'text-blue-400' },
    { key: 'socialPosts', label: 'Social Posts', autoValue: socialPostCount || null, icon: FileText, color: 'text-blue-400' },
    { key: 'totalRsvps', label: 'Total RSVPs', autoValue: report.stats.totalRsvps, icon: Users, color: 'text-green-400' },
    { key: 'attendees', label: 'Attendees', autoValue: report.stats.approvedGuests, icon: Users, color: 'text-emerald-400' },
    { key: 'newsletterSignups', label: 'Newsletter Sign-ups', autoValue: report.stats.mailingListSignups, icon: Mail, color: 'text-orange-400' },
    { key: 'walletAddresses', label: 'Wallet Addresses', autoValue: report.stats.walletAddresses, icon: Wallet, color: 'text-cyan-400' },
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
              {report.featuredPhotos.map((photo) => (
                <img
                  key={photo.id}
                  src={photo.thumbnailUrl || photo.url}
                  alt={photo.caption || 'Event photo'}
                  className="w-full aspect-square object-cover rounded-lg"
                />
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
              />
            ))}
          </div>
        </div>
      )}

      {/* Notable Attendees */}
      {report.notableAttendees.length > 0 && (
        <div className="bg-white/5 rounded-xl p-6 border border-white/10">
          <h2 className="text-lg font-semibold text-white mb-3">Notable Attendees</h2>
          <div className="flex flex-wrap gap-2">
            {report.notableAttendees.map((attendee) => (
              <div key={attendee.id} className="inline-flex items-center gap-2 px-3 py-1.5 bg-white/10 rounded-lg">
                <Star size={14} className="text-yellow-400" />
                {attendee.link ? (
                  <a
                    href={attendee.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-white hover:text-[#ff393a] transition-colors"
                  >
                    {attendee.name}
                  </a>
                ) : (
                  <span className="text-sm text-white">{attendee.name}</span>
                )}
              </div>
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
}

function KPICard({ label, value, icon: Icon, color, url }: KPICardProps) {
  const content = (
    <div className="bg-white/5 rounded-xl p-4 border border-white/10">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} className={color} />
        <span className="text-xs text-white/60">{label}</span>
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
