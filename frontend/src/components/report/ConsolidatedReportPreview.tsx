import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Calendar, Users, Mail, Wallet, Award, Video, Eye, MousePointerClick,
  FileText, Download, X, ChevronLeft, ChevronRight, ExternalLink, Play,
} from 'lucide-react';
import { ConsolidatedReport, ConsolidatedReportPhoto, ConsolidatedReportSocialPost } from '../../types';
import { KPICard, groupAttendeesByOrg, ReportOrgCard } from './reportShared';
import { CircleFlag } from '../CircleFlag';
import { PlatformIcon, detectPlatform } from './platformIcon';
import { countryNameToAlpha2 } from '../../utils/countryFlag';
import { gppCityBySlug } from '../../utils/gppCity';

const isVideoMime = (m: string | null | undefined) => !!m && m.startsWith('video/');

// Resolve a flag + "City, Country" label from the per-item party context,
// preferring the GPP city manifest (same treatment as /photos).
function resolvePartyLocation(party?: { slug: string; name: string; city: string | null; country: string | null }) {
  if (!party) return null;
  const gpp = gppCityBySlug(party.slug);
  const city = gpp?.name ?? party.city ?? party.name;
  const country = gpp?.country ?? party.country;
  if (!city && !country) return null;
  const label = city && country ? `${city}, ${country}` : (city || country || '');
  return { city, country, label };
}

// Small flag + city/country chip overlaid on media tiles / shown inline on posts.
function LocationChip({ party, overlay = false }: { party?: { slug: string; name: string; city: string | null; country: string | null }; overlay?: boolean }) {
  const loc = resolvePartyLocation(party);
  if (!loc) return null;
  const flag = countryNameToAlpha2(loc.country) ? <CircleFlag country={loc.country} size={14} /> : null;
  if (overlay) {
    return (
      <div className="absolute bottom-0 inset-x-0 px-2 py-1 bg-gradient-to-t from-black/70 to-transparent flex items-center gap-1.5 text-[11px] text-white pointer-events-none">
        {flag}
        <span className="truncate">{loc.label}</span>
      </div>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-theme-text-muted">
      {flag}
      <span className="truncate">{loc.label}</span>
    </span>
  );
}

interface ConsolidatedReportPreviewProps {
  report: ConsolidatedReport;
}

// pecorino-64118: cross-event consolidated report. Mirrors ReportPreview's layout
// (KPI cards, industry RSVPs, role chart, social posts) but with a consolidated
// header (no per-event image hero) and a per-event breakdown table.
export function ConsolidatedReportPreview({ report }: ConsolidatedReportPreviewProps) {
  const { t } = useTranslation('host');
  const { t: tp } = useTranslation('partner');
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const headerTitle = report.partnerName
    ? tp('consolidated.title', { name: report.partnerName })
    : tp('consolidated.titleGeneric');

  const downloadWallets = report.walletAddressList && report.walletAddressList.length > 0 ? () => {
    const csv = 'wallet_address\n' + report.walletAddressList.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const namePart = (report.partnerName || report.tag || 'partner').replace(/[^a-zA-Z0-9]/g, '_');
    a.href = url;
    a.download = `${namePart}_all_events_wallet_addresses.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } : undefined;

  const statsDefs: { key: string; label: string; value: number | null | undefined; icon: React.ElementType; color: string; onAction?: () => void; actionIcon?: React.ElementType }[] = [
    { key: 'pageViews', label: t('report.pageViews'), value: report.impressions.totalViews || null, icon: MousePointerClick, color: 'text-[#ff393a]' },
    { key: 'uniqueVisitors', label: t('report.uniqueVisitors'), value: report.impressions.uniqueVisitors || null, icon: Eye, color: 'text-[#ff393a]' },
    { key: 'linkClicks', label: t('report.linkClicks'), value: report.clickStats.totalClicks || null, icon: MousePointerClick, color: 'text-purple-400' },
    { key: 'socialPostViews', label: t('report.socialPostViews'), value: report.stats.socialPostViews || null, icon: Eye, color: 'text-blue-400' },
    { key: 'socialPosts', label: t('report.socialPosts'), value: report.stats.socialPostCount || null, icon: FileText, color: 'text-blue-400' },
    { key: 'totalRsvps', label: t('report.totalRsvps'), value: report.stats.totalRsvps || null, icon: Users, color: 'text-green-400' },
    { key: 'attendees', label: t('report.attendees'), value: report.stats.approvedGuests || null, icon: Users, color: 'text-emerald-400' },
    { key: 'newsletterSignups', label: t('report.newsletterSignups'), value: report.stats.mailingListSignups || null, icon: Mail, color: 'text-orange-400' },
    { key: 'walletAddresses', label: t('report.walletAddresses'), value: report.stats.walletAddresses || null, icon: Wallet, color: 'text-cyan-400', onAction: downloadWallets, actionIcon: Download },
    { key: 'poapMints', label: t('report.poapMints'), value: report.stats.poapMints || null, icon: Award, color: 'text-yellow-400' },
    { key: 'poapMoments', label: t('report.poapMoments'), value: report.stats.poapMoments || null, icon: Video, color: 'text-yellow-400' },
  ];

  const visibleStats = statsDefs.filter(s => s.value != null);
  const hasKPIs = visibleStats.length > 0;

  const formatDate = (iso: string | null) => iso
    ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    : '—';

  return (
    <div className="space-y-6">
      {/* Consolidated header */}
      <div className="card p-6">
        <h1 className="text-2xl font-bold text-theme-text mb-2">{headerTitle}</h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-theme-text-secondary text-sm">
          <span className="inline-flex items-center gap-2">
            <Calendar size={16} />
            {tp('consolidated.eventCount', { count: report.eventCount })}
          </span>
          {report.dateRange && (
            <span>
              {formatDate(report.dateRange.start)} – {formatDate(report.dateRange.end)}
            </span>
          )}
        </div>
      </div>

      {/* Stats */}
      {hasKPIs && (
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-theme-text mb-4">{t('report.stats')}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {visibleStats.map((stat) => (
              <KPICard
                key={stat.key}
                label={stat.label}
                value={stat.value!}
                icon={stat.icon}
                color={stat.color}
                onAction={stat.onAction}
                actionIcon={stat.actionIcon}
              />
            ))}
          </div>
        </div>
      )}

      {/* Per-event breakdown table */}
      {report.events.length > 0 && (
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-theme-text mb-4">{tp('consolidated.perEventBreakdown')}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-theme-text-muted border-b border-theme-stroke">
                  <th className="py-2 pr-4 font-medium">{tp('consolidated.table.event')}</th>
                  <th className="py-2 pr-4 font-medium">{tp('consolidated.table.date')}</th>
                  <th className="py-2 pr-4 font-medium text-right">{tp('consolidated.table.rsvps')}</th>
                  <th className="py-2 pr-4 font-medium text-right">{tp('consolidated.table.attendees')}</th>
                  <th className="py-2 pr-4 font-medium text-right">{tp('consolidated.table.impressions')}</th>
                  <th className="py-2 font-medium text-right">{tp('consolidated.table.clicks')}</th>
                </tr>
              </thead>
              <tbody>
                {report.events.map((ev) => (
                  <tr key={ev.id} className="border-b border-theme-stroke/50 hover:bg-theme-surface-hover/40 transition-colors">
                    <td className="py-2 pr-4">
                      <a
                        href={`/report/${ev.reportSlug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-theme-text hover:text-theme-text-secondary transition-colors"
                      >
                        {ev.name}
                        <ExternalLink size={12} className="text-theme-text-muted flex-shrink-0" />
                      </a>
                    </td>
                    <td className="py-2 pr-4 text-theme-text-secondary whitespace-nowrap">{formatDate(ev.date)}</td>
                    <td className="py-2 pr-4 text-right text-theme-text">{ev.rsvpCount.toLocaleString()}</td>
                    <td className="py-2 pr-4 text-right text-theme-text">{ev.approvedCount.toLocaleString()}</td>
                    <td className="py-2 pr-4 text-right text-theme-text">{ev.impressions.totalViews.toLocaleString()}</td>
                    <td className="py-2 text-right text-theme-text">{ev.clicks.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Media — combined starred photos */}
      {report.featuredPhotos.length > 0 && (
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-theme-text mb-4">{t('report.media')}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
            {report.featuredPhotos.map((photo, i) => {
              const video = isVideoMime(photo.mimeType);
              return (
                <button
                  key={photo.id}
                  onClick={() => setLightboxIndex(i)}
                  className="relative w-full aspect-square overflow-hidden rounded-lg cursor-pointer hover:opacity-80 transition-opacity"
                >
                  {video ? (
                    <>
                      <video
                        src={photo.url}
                        muted
                        playsInline
                        preload="metadata"
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="bg-black/50 rounded-full p-2">
                          <Play size={20} className="text-white fill-white" />
                        </div>
                      </div>
                    </>
                  ) : (
                    <img
                      src={photo.thumbnailUrl || photo.url}
                      alt={photo.caption || 'Event photo'}
                      className="w-full h-full object-cover"
                    />
                  )}
                  <LocationChip party={photo.party} overlay />
                </button>
              );
            })}
          </div>
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

      {/* Industry RSVPs (combined notable attendees) */}
      {report.notableAttendees.length > 0 && (
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-theme-text mb-3">{t('report.industryRsvps')}</h2>
          <div className="flex flex-wrap gap-2">
            {groupAttendeesByOrg(report.notableAttendees).map((group) => (
              <ReportOrgCard key={group.domain || '_independent'} group={group} />
            ))}
          </div>
        </div>
      )}

      {/* Social Posts (combined) — compact platform-icon cards */}
      {report.socialPosts.length > 0 && (
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-theme-text mb-4">{t('report.socialPosts')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {report.socialPosts.map((post) => (
              <SocialPostCard key={post.id} post={post} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Compact social-post card: platform icon, title/handle/url, views, location chip, link.
function SocialPostCard({ post }: { post: ConsolidatedReportSocialPost }) {
  const { t } = useTranslation('host');
  // Map the stored platform value to the shared PlatformIcon's labels; fall back
  // to URL detection so every post gets a recognizable real-logo icon.
  const platformMap: Record<string, string> = {
    twitter: 'X',
    farcaster: 'Farcaster',
    instagram: 'Instagram',
    facebook: 'Facebook',
    linkedin: 'LinkedIn',
    youtube: 'YouTube',
    tiktok: 'TikTok',
  };
  const platform = platformMap[(post.platform || '').toLowerCase()] || detectPlatform(post.url);
  const label = post.title || post.authorHandle || post.url;

  return (
    <a
      href={post.url}
      target="_blank"
      rel="noopener noreferrer"
      className="bg-theme-surface rounded-xl p-3 border border-theme-stroke flex items-start gap-3 hover:border-theme-text-muted transition-colors group"
    >
      <div className="text-theme-text-secondary mt-0.5 flex-shrink-0">
        <PlatformIcon platform={platform} size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-theme-text truncate flex-1">{label}</span>
          <ExternalLink size={12} className="text-theme-text-muted flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
        <div className="flex items-center gap-x-3 gap-y-1 flex-wrap mt-1">
          {post.views != null && post.views > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-theme-text-muted">
              <Eye size={12} />
              {post.views.toLocaleString()} {t('report.socialPostViews')}
            </span>
          )}
          <LocationChip party={post.party} />
        </div>
      </div>
    </a>
  );
}

function PhotoLightbox({
  photos,
  index,
  onClose,
  onNavigate,
}: {
  photos: ConsolidatedReportPhoto[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}) {
  const photo = photos[index];
  const hasPrev = index > 0;
  const hasNext = index < photos.length - 1;
  const video = isVideoMime(photo.mimeType);

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
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 text-theme-text-secondary hover:text-theme-text transition-colors z-10"
      >
        <X size={24} />
      </button>

      {photos.length > 1 && (
        <div className="absolute top-4 left-4 text-sm text-theme-text-muted z-10">
          {index + 1} / {photos.length}
        </div>
      )}

      {hasPrev && (
        <button
          onClick={(e) => { e.stopPropagation(); onNavigate(index - 1); }}
          className="absolute left-4 top-1/2 -translate-y-1/2 p-2 text-theme-text-muted hover:text-theme-text transition-colors z-10"
        >
          <ChevronLeft size={32} />
        </button>
      )}

      {video ? (
        <video
          src={photo.url}
          controls
          autoPlay
          playsInline
          className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <img
          src={photo.url}
          alt={photo.caption || 'Event photo'}
          className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg"
          onClick={(e) => e.stopPropagation()}
        />
      )}

      {photo.caption && (
        <div
          className="absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 bg-black/70 rounded-lg text-sm text-theme-text max-w-lg text-center"
          onClick={(e) => e.stopPropagation()}
        >
          {photo.caption}
        </div>
      )}

      {hasNext && (
        <button
          onClick={(e) => { e.stopPropagation(); onNavigate(index + 1); }}
          className="absolute right-4 top-1/2 -translate-y-1/2 p-2 text-theme-text-muted hover:text-theme-text transition-colors z-10"
        >
          <ChevronRight size={32} />
        </button>
      )}
    </div>
  );
}
