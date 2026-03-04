import React from 'react';
import { Eye, Users, Mail, Wallet, Award, Video, MousePointerClick } from 'lucide-react';
import { EventReport, PageViewStats } from '../../types';

interface ReportKPIsProps {
  report: EventReport;
  onChange: (field: string, value: string | number | null) => void;
  editable?: boolean;
  pageViewStats?: PageViewStats | null;
}

export function ReportKPIs({ report, onChange, editable = true, pageViewStats }: ReportKPIsProps) {
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

  const autoCalculatedItems: { label: string; value: number | null | undefined; icon: React.ElementType; color: string }[] = [
    ...(pageViewStats ? [
      {
        label: 'Page Views',
        value: pageViewStats.totalViews,
        icon: MousePointerClick,
        color: 'text-[#ff393a]',
      },
      {
        label: 'Unique Visitors',
        value: pageViewStats.uniqueViews,
        icon: Eye,
        color: 'text-[#ff393a]',
      },
    ] : []),
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
      {/* Auto-calculated stats */}
      <div>
        <h3 className="text-lg font-semibold text-white mb-4">Auto-calculated Stats</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {autoCalculatedItems.map((item) => {
            const Icon = item.icon;
            if (item.value === null || item.value === undefined) return null;
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
