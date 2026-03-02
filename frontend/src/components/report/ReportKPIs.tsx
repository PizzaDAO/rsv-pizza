import React from 'react';
import { Eye, Users, Mail, Wallet, Award, Video } from 'lucide-react';
import { EventReport } from '../../types';

interface ReportKPIsProps {
  report: EventReport;
  onChange: (field: string, value: string | number | null) => void;
  editable?: boolean;
}

export function ReportKPIs({ report, onChange, editable = true }: ReportKPIsProps) {
  const kpiItems = [
    {
      label: 'X Post Views',
      field: 'xPostViews',
      urlField: 'xPostUrl',
      value: report.xPostViews,
      url: report.xPostUrl,
      icon: Eye,
      color: 'text-blue-400',
    },
    {
      label: 'Farcaster Views',
      field: 'farcasterViews',
      urlField: 'farcasterPostUrl',
      value: report.farcasterViews,
      url: report.farcasterPostUrl,
      icon: Eye,
      color: 'text-purple-400',
    },
    {
      label: 'Luma Views',
      field: 'lumaViews',
      urlField: 'lumaUrl',
      value: report.lumaViews,
      url: report.lumaUrl,
      icon: Eye,
      color: 'text-pink-400',
    },
    {
      label: 'POAP Mints',
      field: 'poapMints',
      urlField: 'poapEventId',
      value: report.poapMints,
      url: report.poapEventId ? `https://poap.gallery/event/${report.poapEventId}` : null,
      icon: Award,
      color: 'text-yellow-400',
    },
    {
      label: 'POAP Moments',
      field: 'poapMoments',
      value: report.poapMoments,
      icon: Video,
      color: 'text-yellow-400',
    },
  ];

  const autoCalculatedItems = [
    {
      label: 'Total RSVPs',
      value: report.stats.totalRsvps,
      icon: Users,
      color: 'text-green-400',
    },
    {
      label: 'Attendees',
      value: report.stats.approvedGuests,
      icon: Users,
      color: 'text-emerald-400',
    },
    {
      label: 'Newsletter Sign-ups',
      value: report.stats.mailingListSignups,
      icon: Mail,
      color: 'text-orange-400',
    },
    {
      label: 'Wallet Addresses',
      value: report.stats.walletAddresses,
      icon: Wallet,
      color: 'text-cyan-400',
    },
  ];

  if (!editable) {
    // Read-only display mode for preview/public view
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-white">KPIs</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {[...kpiItems, ...autoCalculatedItems].map((item) => {
            const Icon = item.icon;
            const value = item.value;
            if (value === null || value === undefined) return null;

            return (
              <div key={item.label} className="bg-white/5 rounded-xl p-4 border border-white/10">
                <div className="flex items-center gap-2 mb-2">
                  <Icon size={16} className={item.color} />
                  <span className="text-xs text-white/60">{item.label}</span>
                </div>
                <div className="text-2xl font-bold text-white">
                  {value.toLocaleString()}
                </div>
                {'url' in item && item.url && (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-white/40 hover:text-white/60 underline mt-1 block truncate"
                  >
                    View post
                  </a>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-white mb-4">Social Media KPIs</h3>
        <div className="space-y-4">
          {/* X/Twitter */}
          <div className="bg-white/5 rounded-xl p-4 border border-white/10">
            <label className="block text-sm font-medium text-white/80 mb-2">X (Twitter) Post</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="url"
                value={report.xPostUrl || ''}
                onChange={(e) => onChange('xPostUrl', e.target.value || null)}
                placeholder="https://x.com/..."
                className="bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a]"
              />
              <input
                type="number"
                value={report.xPostViews || ''}
                onChange={(e) => onChange('xPostViews', e.target.value ? parseInt(e.target.value, 10) : null)}
                placeholder="Views"
                className="bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a]"
              />
            </div>
          </div>

          {/* Farcaster */}
          <div className="bg-white/5 rounded-xl p-4 border border-white/10">
            <label className="block text-sm font-medium text-white/80 mb-2">Farcaster Post</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="url"
                value={report.farcasterPostUrl || ''}
                onChange={(e) => onChange('farcasterPostUrl', e.target.value || null)}
                placeholder="https://warpcast.com/..."
                className="bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a]"
              />
              <input
                type="number"
                value={report.farcasterViews || ''}
                onChange={(e) => onChange('farcasterViews', e.target.value ? parseInt(e.target.value, 10) : null)}
                placeholder="Views"
                className="bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a]"
              />
            </div>
          </div>

          {/* Luma */}
          <div className="bg-white/5 rounded-xl p-4 border border-white/10">
            <label className="block text-sm font-medium text-white/80 mb-2">Luma Event</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="url"
                value={report.lumaUrl || ''}
                onChange={(e) => onChange('lumaUrl', e.target.value || null)}
                placeholder="https://lu.ma/..."
                className="bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a]"
              />
              <input
                type="number"
                value={report.lumaViews || ''}
                onChange={(e) => onChange('lumaViews', e.target.value ? parseInt(e.target.value, 10) : null)}
                placeholder="Views"
                className="bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a]"
              />
            </div>
          </div>

          {/* POAP */}
          <div className="bg-white/5 rounded-xl p-4 border border-white/10">
            <label className="block text-sm font-medium text-white/80 mb-2">POAP</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                type="text"
                value={report.poapEventId || ''}
                onChange={(e) => onChange('poapEventId', e.target.value || null)}
                placeholder="Event ID"
                className="bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a]"
              />
              <input
                type="number"
                value={report.poapMints || ''}
                onChange={(e) => onChange('poapMints', e.target.value ? parseInt(e.target.value, 10) : null)}
                placeholder="Mints"
                className="bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a]"
              />
              <input
                type="number"
                value={report.poapMoments || ''}
                onChange={(e) => onChange('poapMoments', e.target.value ? parseInt(e.target.value, 10) : null)}
                placeholder="Moments"
                className="bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a]"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Auto-calculated stats */}
      <div>
        <h3 className="text-lg font-semibold text-white mb-4">Auto-calculated Stats</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {autoCalculatedItems.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="bg-white/5 rounded-xl p-4 border border-white/10">
                <div className="flex items-center gap-2 mb-2">
                  <Icon size={16} className={item.color} />
                  <span className="text-xs text-white/60">{item.label}</span>
                </div>
                <div className="text-2xl font-bold text-white">
                  {item.value.toLocaleString()}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
