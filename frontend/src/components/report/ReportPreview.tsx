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
  const socialPostViews = report.socialPosts.reduce((sum, p) => sum + (p.views || 0), 0);
  const socialPostCount = report.socialPosts.length;
  const hasKPIs = socialPostViews > 0 || socialPostCount > 0 ||
    report.poapMints || report.poapMoments || report.stats.totalRsvps > 0 ||
    (pageViewStats && pageViewStats.totalViews > 0);

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
              <p className="text-white/40 text-xs mt-2">Flyer by {report.flyerArtist}</p>
            )}

            {report.host && report.host.name && (
              <p className="text-white/40 text-xs mt-1">Hosted by {report.host.name}</p>
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

      {/* Media links */}
      {(report.reportVideoUrl || report.reportPhotosUrl) && (
        <div className="bg-white/5 rounded-xl p-6 border border-white/10">
          <h2 className="text-lg font-semibold text-white mb-3">Media</h2>
          <div className="flex flex-wrap gap-3">
            {report.reportVideoUrl && (
              <a
                href={report.reportVideoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2 bg-white/10 rounded-lg hover:bg-white/20 transition-colors text-white text-sm"
              >
                <Video size={16} />
                Party Video
                <ExternalLink size={14} className="text-white/40" />
              </a>
            )}
            {report.reportPhotosUrl && (
              <a
                href={report.reportPhotosUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2 bg-white/10 rounded-lg hover:bg-white/20 transition-colors text-white text-sm"
              >
                <Eye size={16} />
                Raw Photos / Video
                <ExternalLink size={14} className="text-white/40" />
              </a>
            )}
          </div>
        </div>
      )}

      {/* KPIs */}
      {hasKPIs && (
        <div className="bg-white/5 rounded-xl p-6 border border-white/10">
          <h2 className="text-lg font-semibold text-white mb-4">Key Metrics</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {pageViewStats && pageViewStats.totalViews > 0 && (
              <KPICard
                label="Page Views"
                value={pageViewStats.totalViews}
                icon={MousePointerClick}
                color="text-[#ff393a]"
              />
            )}
            {pageViewStats && pageViewStats.uniqueViews > 0 && (
              <KPICard
                label="Unique Visitors"
                value={pageViewStats.uniqueViews}
                icon={Eye}
                color="text-[#ff393a]"
              />
            )}
            {socialPostViews > 0 && (
              <KPICard
                label="Social Post Views"
                value={socialPostViews}
                icon={Eye}
                color="text-blue-400"
              />
            )}
            {socialPostCount > 0 && (
              <KPICard
                label="Social Posts"
                value={socialPostCount}
                icon={FileText}
                color="text-blue-400"
              />
            )}
            {report.poapMints != null && (
              <KPICard
                label="POAP Mints"
                value={report.poapMints}
                icon={Award}
                color="text-yellow-400"
                url={report.poapEventId ? `https://poap.gallery/event/${report.poapEventId}` : undefined}
              />
            )}
            {report.poapMoments != null && (
              <KPICard
                label="POAP Moments"
                value={report.poapMoments}
                icon={Video}
                color="text-yellow-400"
              />
            )}
            <KPICard
              label="Total RSVPs"
              value={report.stats.totalRsvps}
              icon={Users}
              color="text-green-400"
            />
            <KPICard
              label="Attendees"
              value={report.stats.approvedGuests}
              icon={Users}
              color="text-emerald-400"
            />
            <KPICard
              label="Newsletter Sign-ups"
              value={report.stats.mailingListSignups}
              icon={Mail}
              color="text-orange-400"
            />
            <KPICard
              label="Wallet Addresses"
              value={report.stats.walletAddresses}
              icon={Wallet}
              color="text-cyan-400"
            />
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

      {/* Featured Photos */}
      {report.featuredPhotos.length > 0 && (
        <div className="bg-white/5 rounded-xl p-6 border border-white/10">
          <h2 className="text-lg font-semibold text-white mb-4">Event Photos</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
            {report.featuredPhotos.map((photo) => (
              <img
                key={photo.id}
                src={photo.thumbnailUrl || photo.url}
                alt={photo.caption || 'Event photo'}
                className="w-full aspect-square object-cover rounded-lg"
              />
            ))}
          </div>
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
