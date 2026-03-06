import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Loader2, FileText, AlertCircle, Save, Eye, EyeOff, Link2, Check, Copy, FileText as FileIcon, Lock } from 'lucide-react';
import { usePizza } from '../../contexts/PizzaContext';
import { EventReport, Guest, PageViewStats as PageViewStatsType } from '../../types';
import { ReportKPIs } from './ReportKPIs';
import { ReportRoleChart } from './ReportRoleChart';
import { SocialPostsList } from './SocialPostsList';
import { NotableAttendeesList } from './NotableAttendeesList';
import { ReportPreview } from './ReportPreview';
import { IconInput } from '../IconInput';
import { PageViewStats } from './PageViewStats';
import {
  getReport,
  updateReport,
  publishReport,
  unpublishReport,
  addSocialPost,
  deleteSocialPost,
  addNotableAttendee,
  deleteNotableAttendee,
  getPageViewStats,
} from '../../lib/api';

interface ReportWidgetProps {
  partyId: string;
}

// Build a fallback report from party + guests context data (used when API is unavailable)
function buildFallbackReport(party: any, guests: Guest[]): EventReport {
  const approvedGuests = guests.filter(g => g.approved !== false).length;
  const mailingListSignups = guests.filter(g => g.mailingListOptIn).length;
  const walletAddresses = guests.filter(g => g.ethereumAddress).length;
  const roleBreakdown: Record<string, number> = {};
  guests.forEach(g => {
    const guestRoles = g.roles && g.roles.length > 0 ? g.roles : ['Other'];
    guestRoles.forEach(role => {
      roleBreakdown[role] = (roleBreakdown[role] || 0) + 1;
    });
  });

  return {
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
    reportRecap: null,
    reportVideoUrl: null,
    reportPhotosUrl: null,
    flyerArtist: null,
    flyerArtistUrl: null,
    xPostUrl: null,
    xPostViews: null,
    farcasterPostUrl: null,
    farcasterViews: null,
    lumaUrl: null,
    lumaViews: null,
    poapEventId: null,
    poapMints: null,
    poapMoments: null,
    reportPublished: false,
    reportPublicSlug: null,
    socialPosts: [],
    notableAttendees: [],
    featuredPhotos: [],
    stats: {
      totalRsvps: guests.length,
      approvedGuests,
      mailingListSignups,
      walletAddresses,
      roleBreakdown,
    },
  };
}

export function ReportWidget({ partyId }: ReportWidgetProps) {
  const { party, guests } = usePizza();
  const [report, setReport] = useState<EventReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [publishingState, setPublishingState] = useState<'idle' | 'publishing' | 'unpublishing'>('idle');
  const [copiedLink, setCopiedLink] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [reportPassword, setReportPassword] = useState('');
  const [viewStats, setViewStats] = useState<PageViewStatsType | null>(null);

  // Track pending changes for debounced save
  const pendingChanges = useRef<Record<string, any>>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Prevent context-triggered re-fetches from overwriting local edits
  const initialLoadDone = useRef(false);
  // Keep latest party/guests in refs so loadReport does not depend on context objects
  const partyRef = useRef(party);
  const guestsRef = useRef(guests);
  partyRef.current = party;
  guestsRef.current = guests;

  // Load report data from API - only depends on partyId (stable)
  const loadReport = useCallback(async () => {
    try {
      const result = await getReport(partyId);
      if (result?.report) {
        setReport(result.report);
        setReportPassword(result.report.reportPassword || '');
      } else if (partyRef.current) {
        // Fallback: Build report from party data if API returns nothing
        setReport(buildFallbackReport(partyRef.current, guestsRef.current));
      }
      setError(null);
    } catch (err) {
      // On initial load error, use fallback from context data
      if (!initialLoadDone.current && partyRef.current) {
        setReport(buildFallbackReport(partyRef.current, guestsRef.current));
        setError(null);
      } else {
        setError('Failed to load report data');
      }
      console.error('Error loading report:', err);
    } finally {
      setLoading(false);
      initialLoadDone.current = true;
    }
  }, [partyId]);

  // Only load once on mount (or if partyId changes)
  useEffect(() => {
    loadReport();
    // Load page view stats in parallel (non-blocking)
    getPageViewStats(partyId).then(stats => {
      if (stats) setViewStats(stats);
    });
  }, [loadReport, partyId]);

  // Debounced save: accumulates changes and saves after 1.5s of inactivity
  const debouncedSave = useCallback(async () => {
    if (Object.keys(pendingChanges.current).length === 0) return;

    const changes = { ...pendingChanges.current };
    pendingChanges.current = {};

    setSaving(true);
    try {
      const success = await updateReport(partyId, changes);
      if (success) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2000);
      } else {
        setError('Failed to save changes');
        // Revert optimistic update by reloading
        loadReport();
      }
    } catch (err) {
      setError('Failed to save changes');
      console.error('Error saving report:', err);
      loadReport();
    } finally {
      setSaving(false);
    }
  }, [partyId, loadReport]);

  // Handle field changes with debounced auto-save
  const handleChange = useCallback((field: string, value: string | number | null) => {
    // Update local state immediately (optimistic)
    setReport(prev => prev ? { ...prev, [field]: value } : null);

    // Accumulate changes
    pendingChanges.current[field] = value;

    // Reset debounce timer
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
    }
    saveTimer.current = setTimeout(debouncedSave, 1500);
  }, [debouncedSave]);

  // Manual save (flush pending changes)
  const handleSaveNow = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    await debouncedSave();
  }, [debouncedSave]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
    };
  }, []);

  // Handle adding social posts (authorHandle extracted by backend from URL)
  const handleAddSocialPost = async (post: { platform: string; url: string; title?: string; views?: number | null }) => {
    const result = await addSocialPost(partyId, post);
    if (result?.socialPost) {
      setReport(prev => prev ? {
        ...prev,
        socialPosts: [...prev.socialPosts, result.socialPost],
      } : null);
    } else {
      throw new Error('Failed to add social post');
    }
  };

  // Handle deleting social posts
  const handleDeleteSocialPost = async (id: string) => {
    const success = await deleteSocialPost(partyId, id);
    if (success) {
      setReport(prev => prev ? {
        ...prev,
        socialPosts: prev.socialPosts.filter(p => p.id !== id),
      } : null);
    } else {
      throw new Error('Failed to delete social post');
    }
  };

  // Handle adding notable attendees
  const handleAddNotableAttendee = async (data: { name: string; link?: string; guestId?: string }) => {
    const result = await addNotableAttendee(partyId, data);
    if (result?.notableAttendee) {
      setReport(prev => prev ? {
        ...prev,
        notableAttendees: [...prev.notableAttendees, result.notableAttendee],
      } : null);
    } else {
      throw new Error('Failed to add notable attendee');
    }
  };

  // Refresh notable attendees from API (used when Browse All modal makes changes)
  const refreshNotableAttendees = useCallback(async () => {
    try {
      const result = await getReport(partyId);
      if (result?.report) {
        setReport(prev => prev ? {
          ...prev,
          notableAttendees: result.report.notableAttendees,
        } : null);
      }
    } catch (err) {
      console.error('Error refreshing notable attendees:', err);
    }
  }, [partyId]);

  // Handle deleting notable attendees
  const handleDeleteNotableAttendee = async (id: string) => {
    const success = await deleteNotableAttendee(partyId, id);
    if (success) {
      setReport(prev => prev ? {
        ...prev,
        notableAttendees: prev.notableAttendees.filter(a => a.id !== id),
      } : null);
    } else {
      throw new Error('Failed to delete notable attendee');
    }
  };

  // Handle publish - flush pending changes first
  const handlePublish = async () => {
    if (!report) return;

    // Flush any pending changes before publishing
    await handleSaveNow();

    setPublishingState('publishing');
    try {
      const result = await publishReport(partyId, reportPassword || undefined);
      if (result) {
        setReport(prev => prev ? {
          ...prev,
          reportPublished: true,
          reportPublicSlug: result.reportPublicSlug,
          reportPassword: reportPassword || null,
        } : null);
      } else {
        setError('Failed to publish report');
      }
    } catch (err) {
      console.error('Error publishing report:', err);
      setError('Failed to publish report');
    } finally {
      setPublishingState('idle');
    }
  };

  const handleUnpublish = async () => {
    if (!report) return;

    setPublishingState('unpublishing');
    try {
      const success = await unpublishReport(partyId);
      if (success) {
        setReport(prev => prev ? {
          ...prev,
          reportPublished: false,
        } : null);
      }
    } catch (err) {
      console.error('Error unpublishing report:', err);
    } finally {
      setPublishingState('idle');
    }
  };

  const handleCopyLink = () => {
    if (report?.reportPublicSlug) {
      const url = `${window.location.origin}/report/${report.reportPublicSlug}`;
      navigator.clipboard.writeText(url);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  if (loading) {
    return (
      <div className="card p-8 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#ff393a]" />
      </div>
    );
  }

  if (error && !report) {
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

  // Show preview mode
  if (showPreview) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">Report Preview</h2>
          <button
            onClick={() => setShowPreview(false)}
            className="btn-secondary text-sm py-2 px-4"
          >
            Back to Editor
          </button>
        </div>
        <ReportPreview report={report} pageViewStats={viewStats} />
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
          <div className="flex items-center gap-2">
            {saving && (
              <div className="flex items-center gap-2 text-white/60 text-sm">
                <Loader2 size={14} className="animate-spin" />
                Saving...
              </div>
            )}
            {saveSuccess && !saving && (
              <div className="flex items-center gap-2 text-green-400 text-sm">
                <Check size={14} />
                Saved
              </div>
            )}
            {error && (
              <div className="flex items-center gap-2 text-red-400 text-sm">
                <AlertCircle size={14} />
                {error}
              </div>
            )}
            <button
              onClick={handleSaveNow}
              disabled={saving || Object.keys(pendingChanges.current).length === 0}
              className="btn-secondary text-sm py-2 px-3 flex items-center gap-1.5"
              title="Save changes now"
            >
              <Save size={14} />
              Save
            </button>
            <button
              onClick={() => setShowPreview(true)}
              className="btn-primary text-sm py-2 px-3 flex items-center gap-1.5"
            >
              <FileIcon size={14} />
              Preview Report
            </button>
          </div>
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

      {/* Event Details Section */}
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Event Details</h3>
        <div className="space-y-4">
          {/* Recap */}
          <div>
            <textarea
              value={report.reportRecap || ''}
              onChange={(e) => handleChange('reportRecap', e.target.value || null)}
              placeholder="Write a recap of your event..."
              rows={4}
              className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] resize-none"
            />
            <p className="text-xs text-white/30 mt-1">A summary of the event for the report</p>
          </div>

          {/* Flyer Artist & URLs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <input
                type="text"
                value={report.flyerArtist || ''}
                onChange={(e) => handleChange('flyerArtist', e.target.value || null)}
                placeholder="Flyer artist credit"
                className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a]"
              />
            </div>
            <div>
              <input
                type="url"
                value={report.flyerArtistUrl || ''}
                onChange={(e) => handleChange('flyerArtistUrl', e.target.value || null)}
                placeholder="Flyer artist link"
                className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a]"
              />
            </div>
          </div>

          <div>
            <input
              type="url"
              value={report.reportPhotosUrl || ''}
              onChange={(e) => handleChange('reportPhotosUrl', e.target.value || null)}
              placeholder="Raw photos / video drive link"
              className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a]"
            />
          </div>
        </div>
      </div>

      {/* Social Posts (moved here from below) */}
      <div className="card p-6">
        <SocialPostsList
          posts={report.socialPosts}
          onAdd={handleAddSocialPost}
          onDelete={handleDeleteSocialPost}
          editable={true}
        />
      </div>

      {/* KPIs (auto-calculated stats only) */}
      <div className="card p-6">
        <ReportKPIs
          report={report}
          onChange={handleChange}
          editable={true}
          pageViewStats={viewStats}
          socialPostViews={report.socialPosts.reduce((sum, p) => sum + (p.views || 0), 0)}
          socialPostCount={report.socialPosts.length}
        />
      </div>

      {/* Page View Stats */}
      {viewStats && (
        <div className="card p-6">
          <PageViewStats stats={viewStats} />
        </div>
      )}

      {/* Industry RSVPs */}
      <div className="card p-6">
        <NotableAttendeesList
          attendees={report.notableAttendees}
          guests={guests}
          partyId={partyId}
          onAdd={handleAddNotableAttendee}
          onDelete={handleDeleteNotableAttendee}
          onRefresh={refreshNotableAttendees}
          editable={true}
        />
      </div>

      {/* Role Chart */}
      {Object.keys(report.stats.roleBreakdown).length > 0 && (
        <div className="card p-6">
          <ReportRoleChart roleBreakdown={report.stats.roleBreakdown} totalRsvps={report.stats.totalRsvps} />
        </div>
      )}

      {/* Featured Photos */}
      {report.featuredPhotos.length > 0 && (
        <div className="card p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Featured Photos</h3>
          <p className="text-white/40 text-xs mb-3">Starred photos from the Photos tab appear here</p>
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

      {/* Publish Section */}
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Publish Report</h3>
        <div className="bg-white/5 rounded-xl p-4 border border-white/10">
          {report.reportPublished ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-green-400">
                <Eye size={16} />
                <span className="text-sm font-medium">Report is published</span>
                {report.reportPassword && (
                  <span className="flex items-center gap-1 text-xs text-white/40 bg-white/5 px-2 py-0.5 rounded">
                    <Lock size={10} />
                    Password protected
                  </span>
                )}
              </div>
              {report.reportPublicSlug && (
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-white/10 rounded-lg px-3 py-2 text-white/80 text-sm truncate">
                    {window.location.origin}/report/{report.reportPublicSlug}
                  </div>
                  <button
                    onClick={handleCopyLink}
                    className="btn-secondary text-sm py-2 px-3 flex items-center gap-1.5"
                  >
                    {copiedLink ? (
                      <>
                        <Check size={14} />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy size={14} />
                        Copy
                      </>
                    )}
                  </button>
                </div>
              )}
              <div className="flex items-center gap-2">
                <IconInput
                  icon={Lock}
                  type="text"
                  value={reportPassword}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReportPassword(e.target.value)}
                  placeholder="Password (optional)"
                />
                <button
                  onClick={async () => {
                    await publishReport(partyId, reportPassword || undefined);
                    setReport(prev => prev ? { ...prev, reportPassword: reportPassword || null } : null);
                  }}
                  className="btn-secondary text-sm py-2 px-3 whitespace-nowrap"
                >
                  Update
                </button>
              </div>
              <button
                onClick={handleUnpublish}
                disabled={publishingState === 'unpublishing'}
                className="flex items-center gap-1.5 text-sm text-red-400 hover:text-red-300 transition-colors"
              >
                {publishingState === 'unpublishing' ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <EyeOff size={14} />
                )}
                Unpublish Report
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-white/60 text-sm">
                Publish your report to share it with a public link.
              </p>
              <IconInput
                icon={Lock}
                type="text"
                value={reportPassword}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReportPassword(e.target.value)}
                placeholder="Password (optional — leave empty for public access)"
              />
              <button
                onClick={handlePublish}
                disabled={publishingState === 'publishing'}
                className="btn-primary text-sm py-2 px-4 flex items-center gap-1.5"
              >
                {publishingState === 'publishing' ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Link2 size={14} />
                )}
                Publish Report
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
