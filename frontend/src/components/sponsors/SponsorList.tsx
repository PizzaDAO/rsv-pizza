import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronUp, ChevronDown, Edit2, Trash2, ExternalLink,
  Mail, Phone, User, Building2, Calendar, Globe, Lock, X
} from 'lucide-react';
import { Sponsor, SponsorStatus, SPONSOR_CATEGORIES } from '../../types';
import { PartnerIntakeButton } from './PartnerIntakeButton';
import { cdnUrl } from '../../lib/supabase';

interface SponsorListProps {
  sponsors: Sponsor[];
  partyId: string;
  onEdit: (sponsor: Sponsor) => void;
  onDelete: (sponsorId: string) => void;
  onSponsorUpdate: (sponsor: Sponsor) => void;
  onStatusChange: (sponsor: Sponsor, newStatus: SponsorStatus) => void;
  isLoading?: boolean;
  avatarUrls?: Record<string, string>;
  isPrivileged?: boolean;
}

type SortField = 'name' | 'status' | 'amount' | 'lastContactedAt' | 'createdAt';
type SortOrder = 'asc' | 'desc';

const STATUS_CONFIG: Record<SponsorStatus, { labelKey: string; color: string; bgColor: string }> = {
  todo: { labelKey: 'sponsors.toDo', color: 'text-gray-300', bgColor: 'bg-gray-500' },
  asked: { labelKey: 'sponsors.asked', color: 'text-orange-300', bgColor: 'bg-orange-500' },
  yes: { labelKey: 'sponsors.yes', color: 'text-green-300', bgColor: 'bg-green-500' },
  billed: { labelKey: 'sponsors.billed', color: 'text-yellow-300', bgColor: 'bg-yellow-500' },
  paid: { labelKey: 'sponsors.paid', color: 'text-blue-300', bgColor: 'bg-blue-500' },
  stuck: { labelKey: 'sponsors.stuck', color: 'text-black', bgColor: 'bg-red-500' },
  alum: { labelKey: 'sponsors.alum', color: 'text-purple-300', bgColor: 'bg-purple-500' },
  skip: { labelKey: 'sponsors.skip', color: 'text-gray-400', bgColor: 'bg-gray-700' },
};

const STATUS_ORDER: Record<SponsorStatus, number> = {
  todo: 0,
  asked: 1,
  yes: 2,
  billed: 3,
  paid: 4,
  stuck: 5,
  alum: 6,
  skip: 7,
};

export function SponsorList({ sponsors, partyId, onEdit, onDelete, onSponsorUpdate, onStatusChange, isLoading, avatarUrls, isPrivileged = false }: SponsorListProps) {
  const { t } = useTranslation('host');
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [filterStatus, setFilterStatus] = useState<SponsorStatus | 'all'>('all');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [readOnlyDetailsSponsor, setReadOnlyDetailsSponsor] = useState<Sponsor | null>(null);

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
      <div className="card p-8 bg-theme-header border-theme-stroke text-center">
        <Building2 size={48} className="mx-auto text-theme-text-faint mb-4" />
        <h3 className="text-lg font-medium text-theme-text mb-2">{t('sponsors.noPartnersYet')}</h3>
        <p className="text-theme-text-secondary text-sm">
          {t('sponsors.noPartnersDesc')}
        </p>
      </div>
    );
  }

  return (
    <div className="card bg-theme-header border-theme-stroke overflow-hidden">
      {/* Filter Row */}
      <div className="p-3 border-b border-theme-stroke flex items-center gap-2">
        <span className="text-sm text-theme-text-secondary">{t('sponsors.filter')}</span>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value as SponsorStatus | 'all')}
          className="bg-theme-surface border border-theme-stroke rounded px-2 py-1 text-sm text-theme-text focus:outline-none focus:ring-1 focus:ring-[#ff393a]"
        >
          <option value="all">All ({sponsors.length})</option>
          {Object.entries(STATUS_CONFIG).map(([status, config]) => {
            const count = sponsors.filter(s => s.status === status).length;
            if (count === 0) return null;
            return (
              <option key={status} value={status}>
                {t(config.labelKey)} ({count})
              </option>
            );
          })}
        </select>
        <span className="text-sm text-theme-text-muted ml-auto">
          {t('sponsors.partner', { count: filteredAndSortedSponsors.length })}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-theme-stroke">
              <th className="text-left p-3">
                <button
                  onClick={() => handleSort('status')}
                  className="flex items-center gap-1 text-xs text-theme-text-secondary hover:text-theme-text font-medium uppercase tracking-wider"
                >
                  {t('sponsors.status')} <SortIcon field="status" />
                </button>
              </th>
              <th className="text-left p-3">
                <button
                  onClick={() => handleSort('name')}
                  className="flex items-center gap-1 text-xs text-theme-text-secondary hover:text-theme-text font-medium uppercase tracking-wider"
                >
                  {t('sponsors.partnerCol')} <SortIcon field="name" />
                </button>
              </th>
              <th className="text-left p-3 hidden md:table-cell">
                <span className="text-xs text-theme-text-secondary font-medium uppercase tracking-wider">
                  {t('sponsors.contact')}
                </span>
              </th>
              <th className="text-left p-3">
                <button
                  onClick={() => handleSort('amount')}
                  className="flex items-center gap-1 text-xs text-theme-text-secondary hover:text-theme-text font-medium uppercase tracking-wider"
                >
                  {t('sponsors.amount')} <SortIcon field="amount" />
                </button>
              </th>
              <th className="text-left p-3 hidden lg:table-cell">
                <span className="text-xs text-theme-text-secondary font-medium uppercase tracking-wider">
                  {t('sponsors.type')}
                </span>
              </th>
              <th className="text-left p-3 hidden lg:table-cell">
                <button
                  onClick={() => handleSort('lastContactedAt')}
                  className="flex items-center gap-1 text-xs text-theme-text-secondary hover:text-theme-text font-medium uppercase tracking-wider"
                >
                  {t('sponsors.lastContact')} <SortIcon field="lastContactedAt" />
                </button>
              </th>
              <th className="text-right p-3">
                <span className="text-xs text-theme-text-secondary font-medium uppercase tracking-wider">
                  {t('sponsors.actions')}
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredAndSortedSponsors.map(sponsor => {
              const statusConfig = STATUS_CONFIG[sponsor.status];
              const isLocked = !!sponsor.addedByUnderboss && !isPrivileged;
              return (
                <tr
                  key={sponsor.id}
                  className="border-b border-theme-stroke hover:bg-theme-surface transition-colors"
                >
                  {/* Status */}
                  <td className="p-3">
                    {isLocked ? (
                      <span
                        className={`inline-flex items-center justify-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusConfig.bgColor} ${statusConfig.color}`}
                        title={t('sponsors.globalPartnerReadOnly')}
                      >
                        {t(statusConfig.labelKey)}
                      </span>
                    ) : (
                      <select
                        value={sponsor.status}
                        onChange={(e) => onStatusChange(sponsor, e.target.value as SponsorStatus)}
                        className={`status-pill rounded-full pl-2.5 pr-6 py-0.5 text-xs font-medium border-0 focus:outline-none focus:ring-1 focus:ring-[#ff393a] cursor-pointer ${statusConfig.bgColor} ${statusConfig.color}`}
                      >
                        {Object.entries(STATUS_CONFIG).map(([status, config]) => (
                          <option key={status} value={status} className="bg-theme-header text-theme-text">
                            {t(config.labelKey)}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>

                  {/* Sponsor Name & Organization */}
                  <td className="p-3">
                    <div className="flex items-start gap-2">
                      {(avatarUrls?.[sponsor.id] || sponsor.logoUrl) && (
                        <img
                          src={cdnUrl(avatarUrls?.[sponsor.id] || sponsor.logoUrl!)}
                          alt=""
                          className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                        />
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1">
                          <span className="text-theme-text font-medium truncate">{sponsor.name}</span>
                          {sponsor.website && (
                            <a
                              href={sponsor.website}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-theme-text-muted hover:text-theme-text-secondary"
                            >
                              <ExternalLink size={12} />
                            </a>
                          )}
                          {sponsor.category && (() => {
                            const cat = SPONSOR_CATEGORIES.find(c => c.id === sponsor.category);
                            return cat ? (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                                {cat.label}
                              </span>
                            ) : null;
                          })()}
                        </div>
                        {sponsor.organization && (
                          <div className="text-xs text-theme-text-muted truncate">{sponsor.organization}</div>
                        )}
                        {sponsor.pointPerson && (
                          <div className="flex items-center gap-1 text-xs text-theme-text-muted mt-0.5">
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
                        <div className="text-sm text-theme-text">{sponsor.contactName}</div>
                      )}
                      <div className="flex items-center gap-2">
                        {sponsor.contactEmail && (
                          <a
                            href={`mailto:${sponsor.contactEmail}`}
                            className="text-theme-text-muted hover:text-theme-text-secondary"
                            title={sponsor.contactEmail}
                          >
                            <Mail size={14} />
                          </a>
                        )}
                        {sponsor.contactPhone && (
                          <a
                            href={`tel:${sponsor.contactPhone}`}
                            className="text-theme-text-muted hover:text-theme-text-secondary"
                            title={sponsor.contactPhone}
                          >
                            <Phone size={14} />
                          </a>
                        )}
                        {!sponsor.contactEmail && !sponsor.contactPhone && sponsor.addedByUnderboss && (
                          <span className="text-xs text-purple-400 flex items-center gap-1">
                            <Globe size={12} /> Global partner
                          </span>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Amount */}
                  <td className="p-3">
                    <div className="text-theme-text font-medium">
                      {formatCurrency(sponsor.amount)}
                    </div>
                  </td>

                  {/* Type */}
                  <td className="p-3 hidden lg:table-cell">
                    <span className="text-sm text-theme-text-secondary capitalize">
                      {sponsor.sponsorshipType === 'cash' ? 'Funds' : (sponsor.sponsorshipType?.replace('-', ' ') || '-')}
                    </span>
                  </td>

                  {/* Last Contacted */}
                  <td className="p-3 hidden lg:table-cell">
                    <div className="flex items-center gap-1 text-sm text-theme-text-secondary">
                      <Calendar size={14} />
                      {formatDate(sponsor.lastContactedAt)}
                    </div>
                  </td>

                  {/* Actions */}
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-1">
                      {!isLocked && (
                        <PartnerIntakeButton
                          sponsor={sponsor}
                          partyId={partyId}
                          onUpdate={onSponsorUpdate}
                        />
                      )}
                      {isLocked ? (
                        <button
                          onClick={() => setReadOnlyDetailsSponsor(sponsor)}
                          className="p-1.5 text-purple-400 hover:text-purple-300 hover:bg-purple-500/10 rounded transition-colors"
                          title={t('sponsors.globalPartnerReadOnly')}
                        >
                          <Lock size={16} />
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => onEdit(sponsor)}
                            className="p-1.5 text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover rounded transition-colors"
                            title="Edit"
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            onClick={() => handleDeleteClick(sponsor.id)}
                            className={`p-1.5 rounded transition-colors ${
                              deleteConfirm === sponsor.id
                                ? 'bg-red-500/20 text-red-400'
                                : 'text-theme-text-muted hover:text-red-400 hover:bg-red-500/10'
                            }`}
                            title={deleteConfirm === sponsor.id ? 'Click again to confirm' : 'Delete'}
                          >
                            <Trash2 size={16} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Read-only details modal for underboss-added partners */}
      {readOnlyDetailsSponsor && (() => {
        const s = readOnlyDetailsSponsor;
        const statusConfig = STATUS_CONFIG[s.status];
        return (
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setReadOnlyDetailsSponsor(null)}
          >
            <div
              className="card bg-theme-header border-theme-stroke max-w-lg w-full max-h-[90vh] overflow-y-auto"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b border-theme-stroke">
                <div className="flex items-center gap-2 min-w-0">
                  <Lock size={16} className="text-purple-400 flex-shrink-0" />
                  <h3 className="text-base font-semibold text-theme-text truncate">{s.name}</h3>
                </div>
                <button
                  onClick={() => setReadOnlyDetailsSponsor(null)}
                  className="p-1.5 text-theme-text-muted hover:text-theme-text rounded transition-colors flex-shrink-0"
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="p-4 space-y-4">
                <p className="text-xs text-purple-400 flex items-center gap-1">
                  <Globe size={12} /> {t('sponsors.globalPartnerReadOnly')}
                </p>

                {s.logoUrl && (
                  <div>
                    <div className="text-xs text-theme-text-muted uppercase tracking-wider mb-1">Logo</div>
                    <img
                      src={cdnUrl(s.logoUrl)}
                      alt=""
                      className="w-20 h-20 rounded-lg object-cover bg-theme-surface border border-theme-stroke"
                    />
                  </div>
                )}

                <div>
                  <div className="text-xs text-theme-text-muted uppercase tracking-wider mb-1">{t('sponsors.status')}</div>
                  <span
                    className={`inline-flex items-center justify-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusConfig.bgColor} ${statusConfig.color}`}
                  >
                    {t(statusConfig.labelKey)}
                  </span>
                </div>

                {s.brandDescription && (
                  <div>
                    <div className="text-xs text-theme-text-muted uppercase tracking-wider mb-1">Brand Description</div>
                    <p className="text-sm text-theme-text whitespace-pre-wrap">{s.brandDescription}</p>
                  </div>
                )}

                {s.website && (
                  <div>
                    <div className="text-xs text-theme-text-muted uppercase tracking-wider mb-1">Website</div>
                    <a
                      href={s.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-theme-text-secondary hover:text-theme-text inline-flex items-center gap-1 break-all"
                    >
                      {s.website}
                      <ExternalLink size={12} className="flex-shrink-0" />
                    </a>
                  </div>
                )}

                {s.amount !== null && s.amount !== undefined && (
                  <div>
                    <div className="text-xs text-theme-text-muted uppercase tracking-wider mb-1">{t('sponsors.amount')}</div>
                    <p className="text-sm text-theme-text font-medium">{formatCurrency(s.amount)}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
