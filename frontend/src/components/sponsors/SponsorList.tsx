import React, { useState, useMemo } from 'react';
import {
  ChevronUp, ChevronDown, Edit2, Trash2, ExternalLink,
  Mail, Phone, User, Building2, Calendar
} from 'lucide-react';
import { Sponsor, SponsorStatus } from '../../types';

interface SponsorListProps {
  sponsors: Sponsor[];
  onEdit: (sponsor: Sponsor) => void;
  onDelete: (sponsorId: string) => void;
  isLoading?: boolean;
}

type SortField = 'name' | 'status' | 'amount' | 'lastContactedAt' | 'createdAt';
type SortOrder = 'asc' | 'desc';

const STATUS_CONFIG: Record<SponsorStatus, { label: string; color: string; bgColor: string }> = {
  todo: { label: 'To Do', color: 'text-gray-300', bgColor: 'bg-gray-500' },
  asked: { label: 'Asked', color: 'text-orange-300', bgColor: 'bg-orange-500' },
  yes: { label: 'Yes', color: 'text-green-300', bgColor: 'bg-green-500' },
  invoiced: { label: 'Invoiced', color: 'text-yellow-300', bgColor: 'bg-yellow-500' },
  paid: { label: 'Paid', color: 'text-blue-300', bgColor: 'bg-blue-500' },
  stuck: { label: 'Stuck', color: 'text-red-300', bgColor: 'bg-red-500' },
  alum: { label: 'Alum', color: 'text-purple-300', bgColor: 'bg-purple-500' },
  skip: { label: 'Skip', color: 'text-gray-400', bgColor: 'bg-gray-700' },
};

const STATUS_ORDER: Record<SponsorStatus, number> = {
  todo: 0,
  asked: 1,
  yes: 2,
  invoiced: 3,
  paid: 4,
  stuck: 5,
  alum: 6,
  skip: 7,
};

export function SponsorList({ sponsors, onEdit, onDelete, isLoading }: SponsorListProps) {
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [filterStatus, setFilterStatus] = useState<SponsorStatus | 'all'>('all');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const filteredAndSortedSponsors = useMemo(() => {
    let result = [...sponsors];

    // Filter by status
    if (filterStatus !== 'all') {
      result = result.filter(s => s.status === filterStatus);
    }

    // Sort
    result.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'status':
          comparison = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
          break;
        case 'amount':
          comparison = (a.amount || 0) - (b.amount || 0);
          break;
        case 'lastContactedAt':
          const dateA = a.lastContactedAt ? new Date(a.lastContactedAt).getTime() : 0;
          const dateB = b.lastContactedAt ? new Date(b.lastContactedAt).getTime() : 0;
          comparison = dateA - dateB;
          break;
        case 'createdAt':
          comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [sponsors, filterStatus, sortField, sortOrder]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const handleDeleteClick = (sponsorId: string) => {
    if (deleteConfirm === sponsorId) {
      onDelete(sponsorId);
      setDeleteConfirm(null);
    } else {
      setDeleteConfirm(sponsorId);
      // Auto-cancel after 3 seconds
      setTimeout(() => setDeleteConfirm(null), 3000);
    }
  };

  const formatCurrency = (amount: number | null) => {
    if (amount === null) return '-';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortOrder === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />;
  };

  if (sponsors.length === 0) {
    return (
      <div className="card p-8 bg-[#1a1a2e] border-white/10 text-center">
        <Building2 size={48} className="mx-auto text-white/20 mb-4" />
        <h3 className="text-lg font-medium text-white mb-2">No sponsors yet</h3>
        <p className="text-white/60 text-sm">
          Add your first sponsor to start tracking your fundraising pipeline.
        </p>
      </div>
    );
  }

  return (
    <div className="card bg-[#1a1a2e] border-white/10 overflow-hidden">
      {/* Filter Row */}
      <div className="p-3 border-b border-white/10 flex items-center gap-2">
        <span className="text-sm text-white/60">Filter:</span>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value as SponsorStatus | 'all')}
          className="bg-white/5 border border-white/10 rounded px-2 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#ff393a]"
        >
          <option value="all">All ({sponsors.length})</option>
          {Object.entries(STATUS_CONFIG).map(([status, config]) => {
            const count = sponsors.filter(s => s.status === status).length;
            if (count === 0) return null;
            return (
              <option key={status} value={status}>
                {config.label} ({count})
              </option>
            );
          })}
        </select>
        <span className="text-sm text-white/40 ml-auto">
          {filteredAndSortedSponsors.length} sponsor{filteredAndSortedSponsors.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/10">
              <th className="text-left p-3">
                <button
                  onClick={() => handleSort('status')}
                  className="flex items-center gap-1 text-xs text-white/60 hover:text-white font-medium uppercase tracking-wider"
                >
                  Status <SortIcon field="status" />
                </button>
              </th>
              <th className="text-left p-3">
                <button
                  onClick={() => handleSort('name')}
                  className="flex items-center gap-1 text-xs text-white/60 hover:text-white font-medium uppercase tracking-wider"
                >
                  Sponsor <SortIcon field="name" />
                </button>
              </th>
              <th className="text-left p-3 hidden md:table-cell">
                <span className="text-xs text-white/60 font-medium uppercase tracking-wider">
                  Contact
                </span>
              </th>
              <th className="text-left p-3">
                <button
                  onClick={() => handleSort('amount')}
                  className="flex items-center gap-1 text-xs text-white/60 hover:text-white font-medium uppercase tracking-wider"
                >
                  Amount <SortIcon field="amount" />
                </button>
              </th>
              <th className="text-left p-3 hidden lg:table-cell">
                <span className="text-xs text-white/60 font-medium uppercase tracking-wider">
                  Type
                </span>
              </th>
              <th className="text-left p-3 hidden lg:table-cell">
                <button
                  onClick={() => handleSort('lastContactedAt')}
                  className="flex items-center gap-1 text-xs text-white/60 hover:text-white font-medium uppercase tracking-wider"
                >
                  Last Contact <SortIcon field="lastContactedAt" />
                </button>
              </th>
              <th className="text-right p-3">
                <span className="text-xs text-white/60 font-medium uppercase tracking-wider">
                  Actions
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredAndSortedSponsors.map(sponsor => {
              const statusConfig = STATUS_CONFIG[sponsor.status];
              return (
                <tr
                  key={sponsor.id}
                  className="border-b border-white/5 hover:bg-white/5 transition-colors"
                >
                  {/* Status */}
                  <td className="p-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusConfig.bgColor} ${statusConfig.color}`}
                    >
                      {statusConfig.label}
                    </span>
                  </td>

                  {/* Sponsor Name & Organization */}
                  <td className="p-3">
                    <div className="flex items-start gap-2">
                      {sponsor.logoUrl && (
                        <img
                          src={sponsor.logoUrl}
                          alt=""
                          className="w-8 h-8 rounded object-cover flex-shrink-0"
                        />
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1">
                          <span className="text-white font-medium truncate">{sponsor.name}</span>
                          {sponsor.website && (
                            <a
                              href={sponsor.website}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-white/40 hover:text-white/60"
                            >
                              <ExternalLink size={12} />
                            </a>
                          )}
                        </div>
                        {sponsor.organization && (
                          <div className="text-xs text-white/50 truncate">{sponsor.organization}</div>
                        )}
                        {sponsor.pointPerson && (
                          <div className="flex items-center gap-1 text-xs text-white/40 mt-0.5">
                            <User size={10} />
                            {sponsor.pointPerson}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Contact */}
                  <td className="p-3 hidden md:table-cell">
                    <div className="space-y-1">
                      {sponsor.contactName && (
                        <div className="text-sm text-white/80">{sponsor.contactName}</div>
                      )}
                      <div className="flex items-center gap-2">
                        {sponsor.contactEmail && (
                          <a
                            href={`mailto:${sponsor.contactEmail}`}
                            className="text-white/40 hover:text-white/60"
                            title={sponsor.contactEmail}
                          >
                            <Mail size={14} />
                          </a>
                        )}
                        {sponsor.contactPhone && (
                          <a
                            href={`tel:${sponsor.contactPhone}`}
                            className="text-white/40 hover:text-white/60"
                            title={sponsor.contactPhone}
                          >
                            <Phone size={14} />
                          </a>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Amount */}
                  <td className="p-3">
                    <div className="text-white font-medium">
                      {formatCurrency(sponsor.amount)}
                    </div>
                    {sponsor.amountReceived !== null && sponsor.amountReceived > 0 && (
                      <div className="text-xs text-green-400">
                        {formatCurrency(sponsor.amountReceived)} received
                      </div>
                    )}
                  </td>

                  {/* Type */}
                  <td className="p-3 hidden lg:table-cell">
                    <span className="text-sm text-white/60 capitalize">
                      {sponsor.sponsorshipType?.replace('-', ' ') || '-'}
                    </span>
                  </td>

                  {/* Last Contacted */}
                  <td className="p-3 hidden lg:table-cell">
                    <div className="flex items-center gap-1 text-sm text-white/60">
                      <Calendar size={14} />
                      {formatDate(sponsor.lastContactedAt)}
                    </div>
                  </td>

                  {/* Actions */}
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => onEdit(sponsor)}
                        className="p-1.5 text-white/40 hover:text-white hover:bg-white/10 rounded transition-colors"
                        title="Edit"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        onClick={() => handleDeleteClick(sponsor.id)}
                        className={`p-1.5 rounded transition-colors ${
                          deleteConfirm === sponsor.id
                            ? 'bg-red-500/20 text-red-400'
                            : 'text-white/40 hover:text-red-400 hover:bg-red-500/10'
                        }`}
                        title={deleteConfirm === sponsor.id ? 'Click again to confirm' : 'Delete'}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
