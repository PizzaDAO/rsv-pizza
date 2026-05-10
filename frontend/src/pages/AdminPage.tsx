import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { GPPClouds } from '../components/GPPClouds';
import { IconInput } from '../components/IconInput';
import {
  Shield, ShieldCheck, UserPlus, Trash2, Loader2,
  Mail, User, Globe, Check, X, Pencil, ListChecks, Calendar, Tag, FileText, ChevronDown, ChevronUp, Download,
} from 'lucide-react';
import {
  fetchAdminMe, fetchAdminList, addAdmin, removeAdmin,
  fetchUnderbossList, createUnderboss, updateUnderboss, deactivateUnderboss,
  fetchGppNftSettings, updateGppNftSettings,
  fetchChecklistDefaults, updateChecklistDefaults, addChecklistDefault, deleteChecklistDefault,
  fetchSponsorUsers, createSponsorUser, deleteSponsorUser,
  fetchGppDescription, updateGppDescription,
  fetchUnderbossDashboard,
} from '../lib/api';
import type { ChecklistDefault, GppDescriptionData } from '../lib/api';
import { GPP_REGIONS } from '../types';
import type { AdminUser, UnderbossAdmin, SponsorUser } from '../types';
import { fetchSheetCities } from '../lib/cities';

const themeClass = 'gpp-theme';
const backgroundStyle = { background: 'linear-gradient(180deg, #7EC8E3 0%, #B6E4F7 100%)' } as React.CSSProperties;

function sortByDueDate(items: ChecklistDefault[]): ChecklistDefault[] {
  return [...items].sort((a, b) => {
    if (!a.dueDate && !b.dueDate) return 0;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  });
}

export function AdminPage() {
  const [loading, setLoading] = useState(true);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [currentRole, setCurrentRole] = useState('');
  const [currentEmail, setCurrentEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [exportingCsv, setExportingCsv] = useState(false);

  // Admin list state
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [addingAdmin, setAddingAdmin] = useState(false);
  const [adminMessage, setAdminMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Underboss list state
  const [underbosses, setUnderbosses] = useState<UnderbossAdmin[]>([]);
  const [ubName, setUbName] = useState('');
  const [ubEmail, setUbEmail] = useState('');
  const [ubRegions, setUbRegions] = useState<string[]>([]);
  const [addingUb, setAddingUb] = useState(false);
  const [ubMessage, setUbMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Edit regions state
  const [editingUbId, setEditingUbId] = useState<string | null>(null);
  const [editRegions, setEditRegions] = useState<string[]>([]);
  const [savingRegions, setSavingRegions] = useState(false);

  // GPP NFT state
  const [gppNftEnabled, setGppNftEnabled] = useState(false);
  const [gppNftChain, setGppNftChain] = useState('base');
  const [savingNft, setSavingNft] = useState(false);
  const [nftMessage, setNftMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Checklist defaults state
  const [checklistItems, setChecklistItems] = useState<ChecklistDefault[]>([]);
  const [checklistEdits, setChecklistEdits] = useState<Record<string, string>>({});
  const [savingChecklist, setSavingChecklist] = useState(false);
  const [checklistMessage, setChecklistMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [newItemName, setNewItemName] = useState('');
  const [newItemDate, setNewItemDate] = useState('');
  const [addingItem, setAddingItem] = useState(false);

  // Sponsor users state
  const [sponsorUsers, setSponsorUsers] = useState<SponsorUser[]>([]);
  const [spEmail, setSpEmail] = useState('');
  const [spName, setSpName] = useState('');
  const [spTag, setSpTag] = useState('');
  const [addingSponsor, setAddingSponsor] = useState(false);
  const [sponsorMessage, setSponsorMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // GPP Default Description state
  const [gppDescription, setGppDescription] = useState('');
  const [gppDescOriginal, setGppDescOriginal] = useState('');
  const [gppCustomEvents, setGppCustomEvents] = useState<GppDescriptionData['customizedEvents']>([]);
  const [gppTotalEvents, setGppTotalEvents] = useState(0);
  const [gppDefaultCount, setGppDefaultCount] = useState(0);
  const [savingDesc, setSavingDesc] = useState(false);
  const [descMessage, setDescMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showCustomized, setShowCustomized] = useState(false);

  const isSuperAdmin = currentRole === 'super_admin';

  // Set body class for elements outside React tree
  useEffect(() => {
    document.body.classList.add('gpp-theme-active');
    return () => { document.body.classList.remove('gpp-theme-active'); };
  }, []);

  useEffect(() => {
    async function checkAdmin() {
      try {
        const me = await fetchAdminMe();
        if (!me.isAdmin) {
          setIsAdminUser(false);
          setLoading(false);
          return;
        }
        setIsAdminUser(true);
        setCurrentRole(me.role || '');
        setCurrentEmail(me.email || '');

        const isSA = me.role === 'super_admin';
        const [adminList, ubList, nftSettings, clDefaults, spList, gppDescData] = await Promise.all([
          fetchAdminList(),
          fetchUnderbossList(),
          fetchGppNftSettings(),
          fetchChecklistDefaults(),
          fetchSponsorUsers(),
          isSA ? fetchGppDescription().catch(() => null) : Promise.resolve(null),
        ]);
        setAdmins(adminList);
        setUnderbosses(ubList);
        setGppNftEnabled(nftSettings.nftEnabled);
        setGppNftChain(nftSettings.nftChain || 'base');
        setChecklistItems(sortByDueDate(clDefaults.items));
        setSponsorUsers(spList.sponsorUsers);
        if (gppDescData) {
          setGppDescription(gppDescData.defaultDescription);
          setGppDescOriginal(gppDescData.defaultDescription);
          setGppCustomEvents(gppDescData.customizedEvents);
          setGppTotalEvents(gppDescData.totalGppEvents);
          setGppDefaultCount(gppDescData.defaultCount);
        }
      } catch (err: any) {
        setError(err.message || 'Failed to check admin status');
      } finally {
        setLoading(false);
      }
    }
    checkAdmin();
  }, []);

  useEffect(() => {
    if (adminMessage) {
      const t = setTimeout(() => setAdminMessage(null), 4000);
      return () => clearTimeout(t);
    }
  }, [adminMessage]);

  useEffect(() => {
    if (ubMessage) {
      const t = setTimeout(() => setUbMessage(null), 4000);
      return () => clearTimeout(t);
    }
  }, [ubMessage]);

  useEffect(() => {
    if (nftMessage) {
      const t = setTimeout(() => setNftMessage(null), 4000);
      return () => clearTimeout(t);
    }
  }, [nftMessage]);

  useEffect(() => {
    if (checklistMessage) {
      const t = setTimeout(() => setChecklistMessage(null), 4000);
      return () => clearTimeout(t);
    }
  }, [checklistMessage]);

  useEffect(() => {
    if (sponsorMessage) {
      const t = setTimeout(() => setSponsorMessage(null), 4000);
      return () => clearTimeout(t);
    }
  }, [sponsorMessage]);

  useEffect(() => {
    if (descMessage) {
      const t = setTimeout(() => setDescMessage(null), 4000);
      return () => clearTimeout(t);
    }
  }, [descMessage]);

  async function handleExportEventsCsv() {
    setExportingCsv(true);
    try {
      const [data, sheetCities] = await Promise.all([
        fetchUnderbossDashboard('all'),
        fetchSheetCities(),
      ]);
      // Build city→chatUrl map (same pattern as PartnerDashboardPage)
      const cityChats = new Map<string, string>();
      for (const c of sheetCities) {
        if (c.chatUrl) cityChats.set(c.city.toLowerCase().trim(), c.chatUrl);
      }
      const headers = ['City Name', 'Address', 'Event Link', 'Telegram Chat', 'Country'];
      const rows = data.events.map(e => {
        const city = e.name.replace(/^Global Pizza Party\s*/i, '').trim().toLowerCase();
        const telegramLink = e.telegramGroup || cityChats.get(city) || '';
        return [
          e.name,
          e.address || '',
          e.customUrl ? `https://rsv.pizza/${e.customUrl}` : '',
          telegramLink,
          e.country || '',
        ];
      });
      const csvContent = [headers, ...rows]
        .map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','))
        .join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'events.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err.message || 'Failed to export events');
    } finally {
      setExportingCsv(false);
    }
  }

  async function handleSaveGppDescription() {
    setSavingDesc(true);
    setDescMessage(null);
    try {
      const result = await updateGppDescription(gppDescription);
      setGppDescOriginal(result.newDefault);
      setDescMessage({
        type: 'success',
        text: `Updated ${result.updatedCount} events. ${result.skippedCount} skipped (customized).`,
      });
      // Refresh stats
      const fresh = await fetchGppDescription();
      setGppCustomEvents(fresh.customizedEvents);
      setGppTotalEvents(fresh.totalGppEvents);
      setGppDefaultCount(fresh.defaultCount);
    } catch (err: any) {
      setDescMessage({ type: 'error', text: err.message || 'Failed to update' });
    } finally {
      setSavingDesc(false);
    }
  }

  async function handleAddSponsor(e: React.FormEvent) {
    e.preventDefault();
    if (!spEmail.trim() || !spTag.trim()) return;
    setAddingSponsor(true);
    setSponsorMessage(null);
    try {
      const result = await createSponsorUser({
        email: spEmail.trim(),
        tag: spTag.trim(),
        name: spName.trim() || undefined,
      });
      setSponsorUsers((prev) => [result.sponsorUser, ...prev]);
      setSpEmail('');
      setSpName('');
      setSpTag('');
      setSponsorMessage({ type: 'success', text: `Added ${result.sponsorUser.email} as partner with tag "${result.sponsorUser.tag}"` });
    } catch (err: any) {
      setSponsorMessage({ type: 'error', text: err.message || 'Failed to add partner' });
    } finally {
      setAddingSponsor(false);
    }
  }

  async function handleDeactivateSponsor(id: string, email: string) {
    if (!confirm(`Deactivate partner ${email}? They will lose access to the partner dashboard.`)) return;
    try {
      await deleteSponsorUser(id);
      setSponsorUsers((prev) =>
        prev.map((s) => (s.id === id ? { ...s, isActive: false } : s))
      );
      setSponsorMessage({ type: 'success', text: `Deactivated ${email}` });
    } catch (err: any) {
      setSponsorMessage({ type: 'error', text: err.message || 'Failed to deactivate' });
    }
  }

  async function handleSaveChecklist() {
    setSavingChecklist(true);
    setChecklistMessage(null);
    try {
      const updates = checklistItems
        .filter(item => checklistEdits[item.name] !== undefined)
        .map(item => ({
          name: item.name,
          dueDate: checklistEdits[item.name] || null,
        }));
      if (updates.length === 0) {
        setChecklistMessage({ type: 'error', text: 'No changes to save' });
        setSavingChecklist(false);
        return;
      }
      const result = await updateChecklistDefaults(updates);
      setChecklistMessage({ type: 'success', text: `Updated ${result.totalUpdated} checklist items across all GPP events` });
      setChecklistEdits({});
      // Refresh
      const clDefaults = await fetchChecklistDefaults();
      setChecklistItems(sortByDueDate(clDefaults.items));
    } catch (err: any) {
      setChecklistMessage({ type: 'error', text: err.message || 'Failed to update' });
    } finally {
      setSavingChecklist(false);
    }
  }

  async function handleAddChecklistItem(e: React.FormEvent) {
    e.preventDefault();
    if (!newItemName.trim()) return;
    setAddingItem(true);
    setChecklistMessage(null);
    try {
      const result = await addChecklistDefault({ name: newItemName.trim(), dueDate: newItemDate || null });
      setChecklistMessage({ type: 'success', text: `Added "${newItemName.trim()}" to ${result.createdCount} GPP events` });
      setNewItemName('');
      setNewItemDate('');
      const clDefaults = await fetchChecklistDefaults();
      setChecklistItems(sortByDueDate(clDefaults.items));
    } catch (err: any) {
      setChecklistMessage({ type: 'error', text: err.message || 'Failed to add item' });
    } finally {
      setAddingItem(false);
    }
  }

  async function handleDeleteChecklistItem(name: string) {
    if (!confirm(`Remove "${name}" from all GPP events?`)) return;
    const result = await deleteChecklistDefault(name);
    if (result) {
      setChecklistMessage({ type: 'success', text: `Removed "${name}" from ${result.totalDeleted} events` });
      const clDefaults = await fetchChecklistDefaults();
      if (clDefaults) setChecklistItems(sortByDueDate(clDefaults.items));
    } else {
      setChecklistMessage({ type: 'error', text: `Failed to remove "${name}"` });
    }
  }

  async function handleSaveGppNft() {
    setSavingNft(true);
    setNftMessage(null);
    try {
      const result = await updateGppNftSettings({ nftEnabled: gppNftEnabled, nftChain: gppNftChain });
      setNftMessage({ type: 'success', text: `Updated ${result.updatedCount} GPP events` });
    } catch (err: any) {
      setNftMessage({ type: 'error', text: err.message || 'Failed to update' });
    } finally {
      setSavingNft(false);
    }
  }

  async function handleAddAdmin(e: React.FormEvent) {
    e.preventDefault();
    if (!newEmail.trim()) return;
    setAddingAdmin(true);
    setAdminMessage(null);
    try {
      const admin = await addAdmin({ email: newEmail.trim(), name: newName.trim() || undefined });
      setAdmins((prev) => [...prev, admin]);
      setNewEmail('');
      setNewName('');
      setAdminMessage({ type: 'success', text: `Added ${admin.email} as admin` });
    } catch (err: any) {
      setAdminMessage({ type: 'error', text: err.message || 'Failed to add admin' });
    } finally {
      setAddingAdmin(false);
    }
  }

  async function handleRemoveAdmin(id: string, email: string) {
    if (!confirm(`Remove ${email} as admin?`)) return;
    try {
      await removeAdmin(id);
      setAdmins((prev) => prev.filter((a) => a.id !== id));
      setAdminMessage({ type: 'success', text: `Removed ${email}` });
    } catch (err: any) {
      setAdminMessage({ type: 'error', text: err.message || 'Failed to remove admin' });
    }
  }

  async function handleAddUnderboss(e: React.FormEvent) {
    e.preventDefault();
    if (!ubName.trim() || !ubEmail.trim() || ubRegions.length === 0) return;
    setAddingUb(true);
    setUbMessage(null);
    try {
      const result = await createUnderboss({
        name: ubName.trim(),
        email: ubEmail.trim(),
        regions: ubRegions,
      });
      setUnderbosses((prev) => [...prev, result.underboss]);
      setUbName('');
      setUbEmail('');
      setUbRegions([]);
      setUbMessage({ type: 'success', text: `Created underboss ${result.underboss.name}. They can now log in at /underboss.` });
    } catch (err: any) {
      setUbMessage({ type: 'error', text: err.message || 'Failed to create underboss' });
    } finally {
      setAddingUb(false);
    }
  }

  async function handleDeactivate(id: string, name: string) {
    if (!confirm(`Deactivate ${name}? They will lose access to the underboss dashboard.`)) return;
    try {
      await deactivateUnderboss(id);
      setUnderbosses((prev) =>
        prev.map((u) => (u.id === id ? { ...u, isActive: false } : u))
      );
      setUbMessage({ type: 'success', text: `Deactivated ${name}` });
    } catch (err: any) {
      setUbMessage({ type: 'error', text: err.message || 'Failed to deactivate' });
    }
  }

  function startEditRegions(ub: UnderbossAdmin) {
    setEditingUbId(ub.id);
    setEditRegions(ub.regions && ub.regions.length > 0 ? [...ub.regions] : [ub.region]);
  }

  async function saveEditRegions() {
    if (!editingUbId || editRegions.length === 0) return;
    setSavingRegions(true);
    try {
      const updated = await updateUnderboss(editingUbId, { regions: editRegions });
      setUnderbosses((prev) =>
        prev.map((u) => (u.id === editingUbId ? { ...u, regions: updated.regions || editRegions } : u))
      );
      setUbMessage({ type: 'success', text: 'Regions updated' });
      setEditingUbId(null);
    } catch (err: any) {
      setUbMessage({ type: 'error', text: err.message || 'Failed to update regions' });
    } finally {
      setSavingRegions(false);
    }
  }

  if (loading) {
    return (
      <div className={`min-h-screen ${themeClass}`} style={backgroundStyle}>
        <Header />
        <div className="flex items-center justify-center py-32">
          <Loader2 size={32} className="animate-spin text-theme-text-muted" />
        </div>
        <Footer />
      </div>
    );
  }

  if (!isAdminUser || error) {
    return (
      <div className={`min-h-screen ${themeClass}`} style={backgroundStyle}>
        <Header />
        <div className="flex flex-col items-center justify-center px-4 py-32">
          <Shield size={48} className="text-red-400/60 mb-4" />
          <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
          <p className="text-theme-text-muted text-center max-w-md">
            {error || 'You do not have admin access. Please log in with an admin account.'}
          </p>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${themeClass} relative overflow-hidden`} style={backgroundStyle}>
      <GPPClouds />

      <Helmet>
        <title>Admin | RSV.Pizza</title>
      </Helmet>

      <Header />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 relative z-10">
        <div className="rounded-2xl p-6 sm:p-8" style={{ background: 'rgba(240, 240, 240, 0.95)' }}>
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center">
              <ShieldCheck size={20} className="text-red-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Admin Panel</h1>
              <p className="text-sm text-theme-text-muted">Manage admins and underbosses</p>
            </div>
          </div>

          {/* Export Events CSV */}
          <div className="mb-6">
            <button
              onClick={handleExportEventsCsv}
              disabled={exportingCsv}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {exportingCsv ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
              Export All Events CSV
            </button>
          </div>

          {/* Admin Management */}
          <section className="mb-10">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Shield size={18} className="text-theme-text-secondary" />
              Admins ({admins.length})
            </h2>

            {adminMessage && (
              <div
                className={`mb-4 px-4 py-2 rounded-lg text-sm ${
                  adminMessage.type === 'success'
                    ? 'bg-green-100 text-green-700 border border-green-300'
                    : 'bg-red-100 text-red-700 border border-red-300'
                }`}
              >
                {adminMessage.text}
              </div>
            )}

            {isSuperAdmin && (
              <form onSubmit={handleAddAdmin} className="bg-theme-surface border border-theme-stroke rounded-xl p-4 mb-4">
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="flex-1">
                    <IconInput
                      icon={Mail}
                      type="email"
                      placeholder="Email address"
                      value={newEmail}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="flex-1">
                    <IconInput
                      icon={User}
                      type="text"
                      placeholder="Name (optional)"
                      value={newName}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewName(e.target.value)}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={addingAdmin || !newEmail.trim()}
                    className="flex items-center gap-2 bg-theme-surface-hover hover:bg-theme-surface-hover disabled:opacity-50 rounded-lg px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap"
                  >
                    {addingAdmin ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
                    Add Admin
                  </button>
                </div>
              </form>
            )}

            <div className="bg-theme-surface border border-theme-stroke rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-theme-stroke text-theme-text-muted text-left">
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Role</th>
                    <th className="px-4 py-3 font-medium">Added</th>
                    {isSuperAdmin && <th className="px-4 py-3 font-medium w-20"></th>}
                  </tr>
                </thead>
                <tbody>
                  {admins.map((admin) => (
                    <tr key={admin.id} className="border-b border-theme-stroke hover:bg-theme-surface transition-colors">
                      <td className="px-4 py-3 text-theme-text">{admin.email}</td>
                      <td className="px-4 py-3 text-theme-text-secondary">{admin.name || '-'}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                            admin.role === 'super_admin'
                              ? 'bg-red-100 text-red-700 border border-red-300'
                              : 'bg-blue-100 text-blue-700 border border-blue-300'
                          }`}
                        >
                          {admin.role === 'super_admin' ? 'Super Admin' : 'Admin'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-theme-text-muted">
                        {new Date(admin.createdAt).toLocaleDateString()}
                      </td>
                      {isSuperAdmin && (
                        <td className="px-4 py-3">
                          {admin.email !== currentEmail && (
                            <button
                              onClick={() => handleRemoveAdmin(admin.id, admin.email)}
                              className="text-red-400/60 hover:text-red-400 transition-colors p-1"
                              title="Remove admin"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                  {admins.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-theme-text-faint">
                        No admins found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Underboss Management */}
          <section className="mb-10">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Globe size={18} className="text-theme-text-secondary" />
              Underbosses ({underbosses.length})
            </h2>

            {ubMessage && (
              <div
                className={`mb-4 px-4 py-2 rounded-lg text-sm ${
                  ubMessage.type === 'success'
                    ? 'bg-green-100 text-green-700 border border-green-300'
                    : 'bg-red-100 text-red-700 border border-red-300'
                }`}
              >
                {ubMessage.text}
              </div>
            )}

            <form onSubmit={handleAddUnderboss} className="bg-theme-surface border border-theme-stroke rounded-xl p-4 mb-4">
              <div className="flex flex-col sm:flex-row gap-3 mb-3">
                <div className="flex-1">
                  <IconInput
                    icon={User}
                    type="text"
                    placeholder="Name"
                    value={ubName}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUbName(e.target.value)}
                    required
                  />
                </div>
                <div className="flex-1">
                  <IconInput
                    icon={Mail}
                    type="email"
                    placeholder="Email"
                    value={ubEmail}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUbEmail(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="mb-3">
                <p className="text-sm text-theme-text-secondary mb-2">Regions</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {GPP_REGIONS.map(r => (
                    <label key={r.id} className="flex items-center gap-2 text-sm text-theme-text cursor-pointer">
                      <input
                        type="checkbox"
                        checked={ubRegions.includes(r.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setUbRegions(prev => [...prev, r.id]);
                          } else {
                            setUbRegions(prev => prev.filter(id => id !== r.id));
                          }
                        }}
                        className="rounded border-theme-stroke-hover bg-theme-surface"
                      />
                      {r.label}
                    </label>
                  ))}
                </div>
              </div>
              <button
                type="submit"
                disabled={addingUb || !ubName.trim() || !ubEmail.trim() || ubRegions.length === 0}
                className="flex items-center gap-2 bg-theme-surface-hover hover:bg-theme-surface-hover disabled:opacity-50 rounded-lg px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap"
              >
                {addingUb ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
                Add Underboss
              </button>
            </form>

            <div className="bg-theme-surface border border-theme-stroke rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-theme-stroke text-theme-text-muted text-left">
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">Regions</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {underbosses.map((ub) => (
                    <tr key={ub.id} className="border-b border-theme-stroke hover:bg-theme-surface transition-colors">
                      <td className="px-4 py-3 text-theme-text">{ub.name}</td>
                      <td className="px-4 py-3 text-theme-text-secondary">{ub.email}</td>
                      <td className="px-4 py-3 text-theme-text-secondary">
                        {editingUbId === ub.id ? (
                          <div>
                            <div className="flex flex-wrap gap-1.5 mb-2">
                              {GPP_REGIONS.map(r => (
                                <button
                                  key={r.id}
                                  type="button"
                                  onClick={() => {
                                    setEditRegions(prev =>
                                      prev.includes(r.id)
                                        ? prev.length > 1 ? prev.filter(id => id !== r.id) : prev
                                        : [...prev, r.id]
                                    );
                                  }}
                                  className={`px-2 py-0.5 rounded text-xs transition-colors ${
                                    editRegions.includes(r.id)
                                      ? 'bg-red-500/20 text-red-500 border border-red-500/30 font-medium'
                                      : 'bg-theme-surface text-theme-text-muted border border-theme-stroke hover:bg-theme-surface-hover'
                                  }`}
                                >
                                  {r.label}
                                </button>
                              ))}
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={saveEditRegions}
                                disabled={savingRegions || editRegions.length === 0}
                                className="text-green-500 hover:text-green-400 disabled:opacity-50 p-1"
                                title="Save"
                              >
                                {savingRegions ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                              </button>
                              <button
                                onClick={() => setEditingUbId(null)}
                                className="text-theme-text-muted hover:text-theme-text-secondary p-1"
                                title="Cancel"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 group cursor-pointer" onClick={() => startEditRegions(ub)}>
                            <span>{(ub.regions && ub.regions.length > 0 ? ub.regions : [ub.region]).map(r => GPP_REGIONS.find(g => g.id === r)?.label || r).join(', ')}</span>
                            <Pencil size={12} className="text-theme-text-faint group-hover:text-theme-text-muted transition-colors flex-shrink-0" />
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                            ub.isActive
                              ? 'bg-green-100 text-green-700 border border-green-300'
                              : 'bg-red-100 text-red-700 border border-red-300'
                          }`}
                        >
                          {ub.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {ub.isActive && (
                            <button
                              onClick={() => handleDeactivate(ub.id, ub.name)}
                              className="text-theme-text-muted hover:text-red-400 transition-colors p-1"
                              title="Deactivate"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {underbosses.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-theme-text-faint">
                        No underbosses yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Partners Management */}
          <section className="mb-10">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Tag size={18} className="text-theme-text-secondary" />
              Partners ({sponsorUsers.length})
            </h2>

            {sponsorMessage && (
              <div
                className={`mb-4 px-4 py-2 rounded-lg text-sm ${
                  sponsorMessage.type === 'success'
                    ? 'bg-green-100 text-green-700 border border-green-300'
                    : 'bg-red-100 text-red-700 border border-red-300'
                }`}
              >
                {sponsorMessage.text}
              </div>
            )}

            {isSuperAdmin && (
              <form onSubmit={handleAddSponsor} className="bg-theme-surface border border-theme-stroke rounded-xl p-4 mb-4">
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="flex-1">
                    <IconInput
                      icon={Mail}
                      type="email"
                      placeholder="Email address"
                      value={spEmail}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSpEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="flex-1">
                    <IconInput
                      icon={Tag}
                      type="text"
                      placeholder="Partner tag (e.g. swc)"
                      value={spTag}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSpTag(e.target.value)}
                      required
                    />
                  </div>
                  <div className="flex-1">
                    <IconInput
                      icon={User}
                      type="text"
                      placeholder="Name (optional)"
                      value={spName}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSpName(e.target.value)}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={addingSponsor || !spEmail.trim() || !spTag.trim()}
                    className="flex items-center gap-2 bg-theme-surface-hover hover:bg-theme-surface-hover disabled:opacity-50 rounded-lg px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap"
                  >
                    {addingSponsor ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
                    Add Partner
                  </button>
                </div>
              </form>
            )}

            <div className="bg-theme-surface border border-theme-stroke rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-theme-stroke text-theme-text-muted text-left">
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Tag</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Added</th>
                    {isSuperAdmin && <th className="px-4 py-3 font-medium w-20"></th>}
                  </tr>
                </thead>
                <tbody>
                  {sponsorUsers.map((sp) => (
                    <tr key={sp.id} className="border-b border-theme-stroke hover:bg-theme-surface transition-colors">
                      <td className="px-4 py-3 text-theme-text">{sp.email}</td>
                      <td className="px-4 py-3 text-theme-text-secondary">{sp.name || '-'}</td>
                      <td className="px-4 py-3">
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700 border border-purple-300">
                          {sp.tag}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                            sp.isActive
                              ? 'bg-green-100 text-green-700 border border-green-300'
                              : 'bg-red-100 text-red-700 border border-red-300'
                          }`}
                        >
                          {sp.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-theme-text-muted">
                        {new Date(sp.createdAt).toLocaleDateString()}
                      </td>
                      {isSuperAdmin && (
                        <td className="px-4 py-3">
                          {sp.isActive && (
                            <button
                              onClick={() => handleDeactivateSponsor(sp.id, sp.email)}
                              className="text-red-400/60 hover:text-red-400 transition-colors p-1"
                              title="Deactivate partner"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                  {sponsorUsers.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-theme-text-faint">
                        No partners yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Event Setup Checklist — super admin only */}
          {isSuperAdmin && (
            <section className="card p-6 mt-6">
              <div className="flex items-center gap-2 mb-4">
                <ListChecks size={20} className="text-theme-text-secondary" />
                <h2 className="text-lg font-semibold text-theme-text">Event Setup Checklist</h2>
              </div>

              {checklistMessage && (
                <div className={`mb-4 px-4 py-2 rounded-lg text-sm ${
                  checklistMessage.type === 'success' ? 'bg-green-100 text-green-700 border border-green-300' : 'bg-red-100 text-red-700 border border-red-300'
                }`}>
                  {checklistMessage.text}
                </div>
              )}

              <div className="space-y-2">
                {checklistItems.map((item) => (
                  <div key={item.name} className="flex items-center gap-3 py-2 px-3 rounded-lg bg-white/30 border border-theme-stroke">
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-theme-text font-medium">{item.name}</span>
                      {item.isAuto && <span className="ml-2 text-xs text-theme-text-faint">(auto)</span>}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Calendar size={14} className="text-theme-text-muted" />
                      <input
                        type="date"
                        value={checklistEdits[item.name] ?? (item.dueDate ? item.dueDate.split('T')[0] : '')}
                        onChange={(e) => setChecklistEdits(prev => ({ ...prev, [item.name]: e.target.value }))}
                        className="text-sm bg-white/50 border border-theme-stroke rounded-lg px-2 py-1 text-theme-text w-36"
                      />
                    </div>
                    <button
                      onClick={() => handleDeleteChecklistItem(item.name)}
                      className="text-red-400 hover:text-red-600 transition-colors p-1"
                      title={`Remove ${item.name}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                {checklistItems.length === 0 && (
                  <p className="text-sm text-theme-text-faint py-4 text-center">No checklist items found. Items are created when a GPP host first views their checklist.</p>
                )}
              </div>

              {checklistItems.length > 0 && Object.keys(checklistEdits).length > 0 && (
                <button
                  onClick={handleSaveChecklist}
                  disabled={savingChecklist}
                  className="mt-4 px-6 py-2 bg-[#E52828] text-white rounded-xl text-sm font-medium hover:bg-[#CC2020] transition-colors disabled:opacity-50"
                >
                  {savingChecklist ? 'Saving...' : 'Save Checklist Dates'}
                </button>
              )}

              <form onSubmit={handleAddChecklistItem} className="mt-4 pt-4 border-t border-theme-stroke flex items-end gap-2">
                <div className="flex-1">
                  <input
                    type="text"
                    value={newItemName}
                    onChange={(e) => setNewItemName(e.target.value)}
                    placeholder="New checklist item..."
                    className="w-full text-sm bg-white/50 border border-theme-stroke rounded-lg px-3 py-2 text-theme-text"
                  />
                </div>
                <input
                  type="date"
                  value={newItemDate}
                  onChange={(e) => setNewItemDate(e.target.value)}
                  className="text-sm bg-white/50 border border-theme-stroke rounded-lg px-2 py-2 text-theme-text w-36"
                />
                <button
                  type="submit"
                  disabled={addingItem || !newItemName.trim()}
                  className="px-4 py-2 bg-[#E52828] text-white rounded-lg text-sm font-medium hover:bg-[#CC2020] transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  {addingItem ? 'Adding...' : 'Add Item'}
                </button>
              </form>
            </section>
          )}

          {/* GPP Default Description — super admin only */}
          {isSuperAdmin && (
            <section className="card p-6 mt-6">
              <div className="flex items-center gap-2 mb-4">
                <FileText size={20} className="text-theme-text-secondary" />
                <h2 className="text-lg font-semibold text-theme-text">GPP Default Description</h2>
              </div>

              <p className="text-sm text-theme-text-muted mb-4">
                {gppDefaultCount} of {gppTotalEvents} events use the default
              </p>

              {descMessage && (
                <div className={`mb-4 px-4 py-2 rounded-lg text-sm ${
                  descMessage.type === 'success' ? 'bg-green-100 text-green-700 border border-green-300' : 'bg-red-100 text-red-700 border border-red-300'
                }`}>
                  {descMessage.text}
                </div>
              )}

              <IconInput
                icon={FileText}
                multiline
                rows={8}
                placeholder="Default description for new GPP events..."
                value={gppDescription}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setGppDescription(e.target.value)}
              />

              <button
                onClick={handleSaveGppDescription}
                disabled={gppDescription === gppDescOriginal || savingDesc}
                className="mt-4 px-6 py-2 bg-[#E52828] text-white rounded-xl text-sm font-medium hover:bg-[#CC2020] transition-colors disabled:opacity-50"
              >
                {savingDesc ? 'Saving...' : 'Save & Apply to Default Events'}
              </button>

              {gppCustomEvents.length > 0 && (
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={() => setShowCustomized(!showCustomized)}
                    className="flex items-center gap-1.5 text-sm text-theme-text-secondary hover:text-theme-text transition-colors"
                  >
                    {showCustomized ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    {gppCustomEvents.length} event{gppCustomEvents.length !== 1 ? 's' : ''} with custom descriptions
                  </button>

                  {showCustomized && (
                    <div className="mt-2 space-y-2">
                      {gppCustomEvents.map((ev) => (
                        <div key={ev.id} className="flex flex-col gap-0.5 py-2 px-3 rounded-lg bg-white/30 border border-theme-stroke">
                          <a
                            href={`/host/${ev.inviteCode}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-medium text-theme-text hover:underline"
                          >
                            {ev.name}
                          </a>
                          <span className="text-xs text-theme-text-muted truncate">
                            {ev.descriptionPreview}{ev.descriptionPreview.length >= 100 ? '...' : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {/* GPP NFT Settings — super admin only */}
          {isSuperAdmin && (
            <section className="card p-6 mt-6">
              <div className="flex items-center gap-2 mb-4">
                <Shield size={20} className="text-theme-text-secondary" />
                <h2 className="text-lg font-semibold text-theme-text">GPP NFT Settings</h2>
              </div>

              {nftMessage && (
                <div className={`mb-4 px-4 py-2 rounded-lg text-sm ${
                  nftMessage.type === 'success' ? 'bg-green-100 text-green-700 border border-green-300' : 'bg-red-100 text-red-700 border border-red-300'
                }`}>
                  {nftMessage.text}
                </div>
              )}

              <div className="space-y-4">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={gppNftEnabled}
                    onChange={(e) => setGppNftEnabled(e.target.checked)}
                    className="w-4 h-4 rounded accent-[#E52828]"
                  />
                  <span className="text-sm text-theme-text">Enable NFT minting for all GPP events</span>
                </label>

                {gppNftEnabled && (
                  <div className="flex gap-2">
                    {(['base', 'monad'] as const).map((chain) => (
                      <button
                        key={chain}
                        type="button"
                        onClick={() => setGppNftChain(chain)}
                        className={`flex-1 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                          gppNftChain === chain
                            ? 'bg-[#E52828] text-white'
                            : 'bg-white/50 text-theme-text-secondary hover:bg-white/70 border border-theme-stroke'
                        }`}
                      >
                        {chain === 'base' ? 'Base' : 'Monad'}
                      </button>
                    ))}
                  </div>
                )}

                <button
                  onClick={handleSaveGppNft}
                  disabled={savingNft}
                  className="px-6 py-2 bg-[#E52828] text-white rounded-xl text-sm font-medium hover:bg-[#CC2020] transition-colors disabled:opacity-50"
                >
                  {savingNft ? 'Saving...' : 'Save GPP NFT Settings'}
                </button>
              </div>
            </section>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
