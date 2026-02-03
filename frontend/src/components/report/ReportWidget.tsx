import React, { useEffect, useState } from 'react';
import { Loader2, FileText, AlertCircle } from 'lucide-react';
import { usePizza } from '../../contexts/PizzaContext';
import { EventReport, ReportStats, SocialPost, NotableAttendee, Photo } from '../../types';
import { ReportKPIs } from './ReportKPIs';
import { ReportRoleChart } from './ReportRoleChart';
import { SocialPostsList } from './SocialPostsList';

interface ReportWidgetProps {
  partyId: string;
}

export function ReportWidget({ partyId }: ReportWidgetProps) {
  const { party, guests } = usePizza();
  const [report, setReport] = useState<EventReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Build report from party and guests data
  useEffect(() => {
    if (!party) {
      setLoading(false);
      return;
    }

    // Calculate stats from guests
    const approvedGuests = guests.filter(g => g.status === 'approved').length;
    const mailingListSignups = guests.filter(g => g.joinMailingList).length;
    const walletAddresses = guests.filter(g => g.walletAddress).length;

    // Calculate role breakdown
    const roleBreakdown: Record<string, number> = {};
    guests.forEach(g => {
      const role = g.role || 'Other';
      roleBreakdown[role] = (roleBreakdown[role] || 0) + 1;
    });

    const stats: ReportStats = {
      totalRsvps: guests.length,
      approvedGuests,
      mailingListSignups,
      walletAddresses,
      roleBreakdown,
    };

    // Build report object from party data
    const eventReport: EventReport = {
      id: party.id,
      name: party.name,
      date: party.date,
      timezone: party.timezone,
      venueName: party.venueName,
      address: party.address,
      eventImageUrl: party.eventImageUrl,
      description: party.description,
      coHosts: party.coHosts || [],
      host: party.hostName ? { name: party.hostName, profilePictureUrl: null } : null,

      // Report-specific fields (these would come from party.report_* fields if they exist)
      reportRecap: (party as any).reportRecap || null,
      reportVideoUrl: (party as any).reportVideoUrl || null,
      reportPhotosUrl: (party as any).reportPhotosUrl || null,
      flyerArtist: (party as any).flyerArtist || null,

      // KPIs
      xPostUrl: (party as any).xPostUrl || null,
      xPostViews: (party as any).xPostViews || null,
      farcasterPostUrl: (party as any).farcasterPostUrl || null,
      farcasterViews: (party as any).farcasterViews || null,
      lumaUrl: (party as any).lumaUrl || null,
      lumaViews: (party as any).lumaViews || null,
      poapEventId: (party as any).poapEventId || null,
      poapMints: (party as any).poapMints || null,
      poapMoments: (party as any).poapMoments || null,

      // Report settings
      reportPublished: (party as any).reportPublished || false,
      reportPublicSlug: (party as any).reportPublicSlug || null,

      // Related data (empty for now - would come from database)
      socialPosts: [],
      notableAttendees: [],
      featuredPhotos: [],

      // Calculated stats
      stats,
    };

    setReport(eventReport);
    setLoading(false);
  }, [party, guests]);

  // Handle field changes
  const handleChange = async (field: string, value: string | number | null) => {
    if (!report) return;

    // Update local state immediately
    setReport(prev => prev ? { ...prev, [field]: value } : null);

    // TODO: Save to database
    // This would call an API to update the party's report fields
    // await updatePartyReport(partyId, { [field]: value });
  };

  // Handle adding social posts
  const handleAddSocialPost = async (post: { platform: string; url: string; authorHandle?: string }) => {
    if (!report) return;

    // Create new post (would normally come from API)
    const newPost: SocialPost = {
      id: crypto.randomUUID(),
      partyId,
      platform: post.platform as 'twitter' | 'farcaster' | 'instagram',
      url: post.url,
      authorHandle: post.authorHandle || null,
      sortOrder: report.socialPosts.length,
      createdAt: new Date().toISOString(),
    };

    setReport(prev => prev ? {
      ...prev,
      socialPosts: [...prev.socialPosts, newPost],
    } : null);

    // TODO: Save to database
  };

  // Handle deleting social posts
  const handleDeleteSocialPost = async (id: string) => {
    if (!report) return;

    setReport(prev => prev ? {
      ...prev,
      socialPosts: prev.socialPosts.filter(p => p.id !== id),
    } : null);

    // TODO: Delete from database
  };

  if (loading) {
    return (
      <div className="card p-8 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#ff393a]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-8">
        <div className="flex items-center gap-3 text-red-400">
          <AlertCircle size={24} />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="card p-8">
        <div className="text-center">
          <FileText className="w-16 h-16 text-white/20 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-white mb-2">Event Report</h2>
          <p className="text-white/60">No event data available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold text-white">Event Report</h2>
            <p className="text-white/60 text-sm mt-1">
              Track engagement metrics and collect attendee social posts
            </p>
          </div>
          {saving && (
            <div className="flex items-center gap-2 text-white/60 text-sm">
              <Loader2 size={14} className="animate-spin" />
              Saving...
            </div>
          )}
        </div>

        {/* Event Summary */}
        <div className="bg-white/5 rounded-xl p-4 border border-white/10">
          <h3 className="text-lg font-semibold text-white">{report.name}</h3>
          {report.date && (
            <p className="text-white/60 text-sm mt-1">
              {new Date(report.date).toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </p>
          )}
          {report.venueName && (
            <p className="text-white/40 text-sm">{report.venueName}</p>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="card p-6">
        <ReportKPIs
          report={report}
          onChange={handleChange}
          editable={true}
        />
      </div>

      {/* Role Chart */}
      {Object.keys(report.stats.roleBreakdown).length > 0 && (
        <div className="card p-6">
          <ReportRoleChart roleBreakdown={report.stats.roleBreakdown} />
        </div>
      )}

      {/* Social Posts */}
      <div className="card p-6">
        <SocialPostsList
          posts={report.socialPosts}
          onAdd={handleAddSocialPost}
          onDelete={handleDeleteSocialPost}
          editable={true}
        />
      </div>
    </div>
  );
}
