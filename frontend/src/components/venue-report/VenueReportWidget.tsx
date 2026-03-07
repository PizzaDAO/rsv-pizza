import React, { useState, useEffect, useCallback } from 'react';
import { Building2, Loader2, Eye, EyeOff, Link2, Copy, Check, Lock, FileText } from 'lucide-react';
import { VenueReport } from '../../types';
import { getVenueReport, updateVenueReport, publishVenueReport, unpublishVenueReport } from '../../lib/api';
import { IconInput } from '../IconInput';
import { Checkbox } from '../Checkbox';
import { VenueReportPreview } from './VenueReportPreview';

interface VenueReportWidgetProps {
  partyId: string;
}

export const VenueReportWidget: React.FC<VenueReportWidgetProps> = ({ partyId }) => {
  const [report, setReport] = useState<VenueReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [password, setPassword] = useState('');
  const [usePassword, setUsePassword] = useState(false);

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getVenueReport(partyId);
      if (data) {
        setReport(data);
        setUsePassword(data.hasPassword || false);
        setPassword(data.password || '');
      }
    } catch (error) {
      console.error('Error loading venue report:', error);
    } finally {
      setLoading(false);
    }
  }, [partyId]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const handleTitleChange = async (title: string) => {
    if (!report) return;
    setReport({ ...report, title });
    setSaving(true);
    await updateVenueReport(partyId, { title: title || null });
    setSaving(false);
  };

  const handleNotesChange = async (notes: string) => {
    if (!report) return;
    setReport({ ...report, notes });
    setSaving(true);
    await updateVenueReport(partyId, { notes: notes || null });
    setSaving(false);
  };

  const handlePublish = async () => {
    setPublishing(true);
    try {
      const result = await publishVenueReport(partyId, usePassword ? password : undefined);
      if (result) {
        setReport(prev => prev ? {
          ...prev,
          published: true,
          slug: result.venueReportSlug,
          hasPassword: !!password && usePassword,
        } : null);
      }
    } catch (error) {
      console.error('Error publishing venue report:', error);
    } finally {
      setPublishing(false);
    }
  };

  const handleUnpublish = async () => {
    setPublishing(true);
    try {
      const success = await unpublishVenueReport(partyId);
      if (success) {
        setReport(prev => prev ? { ...prev, published: false } : null);
      }
    } catch (error) {
      console.error('Error unpublishing venue report:', error);
    } finally {
      setPublishing(false);
    }
  };

  const copyLink = () => {
    if (!report?.slug) return;
    const url = `${window.location.origin}/venue-report/${report.slug}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin text-white/40" />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="card p-8 text-center">
        <Building2 size={32} className="mx-auto mb-3 text-white/20" />
        <p className="text-white/60">No venues added yet. Add venues first to create a venue report.</p>
      </div>
    );
  }

  if (showPreview) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Building2 size={20} className="text-[#ff393a]" />
            Venue Report Preview
          </h2>
          <button
            type="button"
            onClick={() => setShowPreview(false)}
            className="text-sm text-white/50 hover:text-white"
          >
            Back to Edit
          </button>
        </div>
        <VenueReportPreview report={report} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Building2 size={20} className="text-[#ff393a]" />
          Venue Report
          {saving && <Loader2 size={14} className="animate-spin text-white/40" />}
        </h2>
        <button
          type="button"
          onClick={() => setShowPreview(true)}
          className="flex items-center gap-1.5 text-sm text-white/50 hover:text-white"
        >
          <Eye size={14} />
          Preview
        </button>
      </div>

      {/* Title & Notes */}
      <div className="space-y-3">
        <IconInput
          icon={FileText}
          iconSize={16}
          type="text"
          value={report.title || ''}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder="Report Title (e.g., Venue Comparison for Pizza Party NYC)"
        />
        <IconInput
          icon={FileText}
          iconSize={16}
          multiline
          rows={3}
          value={report.notes || ''}
          onChange={(e) => handleNotesChange(e.target.value)}
          placeholder="Notes for stakeholders (e.g., top picks, timeline, budget considerations...)"
        />
      </div>

      {/* Venue Summary */}
      <div className="space-y-2">
        <p className="text-xs text-white/40">
          {report.venues.length} venue{report.venues.length !== 1 ? 's' : ''} included
          {report.venues.filter(v => v.photos && v.photos.length > 0).length > 0 &&
            ` (${report.venues.reduce((sum, v) => sum + (v.photos?.length || 0), 0)} photos)`
          }
        </p>
        <div className="space-y-1">
          {report.venues.map(venue => (
            <div key={venue.id} className="flex items-center gap-2 text-sm text-white/60">
              <span className={venue.isSelected ? 'text-[#ff393a] font-medium' : ''}>
                {venue.name}
              </span>
              {venue.isSelected && (
                <span className="text-[10px] bg-[#ff393a]/20 text-[#ff393a] px-1.5 py-0.5 rounded">
                  Selected
                </span>
              )}
              {venue.photos && venue.photos.length > 0 && (
                <span className="text-[10px] text-white/30">
                  {venue.photos.length} photo{venue.photos.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Publish Section */}
      <div className="border-t border-white/10 pt-4 space-y-4">
        <h3 className="text-sm font-medium text-white/60">Sharing</h3>

        {/* Password option */}
        <Checkbox
          checked={usePassword}
          onChange={setUsePassword}
          label="Require password to view"
        />
        {usePassword && (
          <IconInput
            icon={Lock}
            iconSize={16}
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Set a password"
          />
        )}

        {/* Publish/Unpublish buttons */}
        <div className="flex items-center gap-3">
          {!report.published ? (
            <button
              type="button"
              onClick={handlePublish}
              disabled={publishing || report.venues.length === 0}
              className="flex items-center gap-2 bg-[#ff393a] hover:bg-[#ff5a5b] disabled:opacity-50 text-white font-medium px-4 py-2 rounded-lg transition-colors text-sm"
            >
              {publishing ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Eye size={14} />
              )}
              Publish Venue Report
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handlePublish}
                disabled={publishing}
                className="flex items-center gap-2 bg-[#ff393a] hover:bg-[#ff5a5b] disabled:opacity-50 text-white font-medium px-4 py-2 rounded-lg transition-colors text-sm"
              >
                {publishing ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Eye size={14} />
                )}
                Update & Republish
              </button>
              <button
                type="button"
                onClick={handleUnpublish}
                disabled={publishing}
                className="flex items-center gap-2 bg-white/10 hover:bg-white/20 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-lg transition-colors text-sm"
              >
                <EyeOff size={14} />
                Unpublish
              </button>
            </>
          )}
        </div>

        {/* Published link */}
        {report.published && report.slug && (
          <div className="bg-white/5 border border-white/10 rounded-lg p-3 flex items-center gap-3">
            <Link2 size={14} className="text-white/40 flex-shrink-0" />
            <span className="text-sm text-white/60 truncate flex-1">
              {window.location.origin}/venue-report/{report.slug}
            </span>
            <button
              type="button"
              onClick={copyLink}
              className="flex items-center gap-1 text-xs text-[#ff393a] hover:text-[#ff5a5b] flex-shrink-0"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
