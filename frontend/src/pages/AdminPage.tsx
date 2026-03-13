import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { GPPClouds } from '../components/GPPClouds';
import { IconInput } from '../components/IconInput';
import {
  Shield, ShieldCheck, UserPlus, Trash2, Loader2,
  Mail, User, Globe, Check, X, Pencil,
} from 'lucide-react';
import {
  fetchAdminMe, fetchAdminList, addAdmin, removeAdmin,
  fetchUnderbossList, createUnderboss, updateUnderboss, deactivateUnderboss,
} from '../lib/api';
import { GPP_REGIONS } from '../types';
import type { AdminUser, UnderbossAdmin } from '../types';

const themeClass = 'gpp-theme';
const backgroundStyle = { background: 'linear-gradient(180deg, #7EC8E3 0%, #B6E4F7 100%)' } as React.CSSProperties;

export function AdminPage() {
  const [loading, setLoading] = useState(true);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [currentRole, setCurrentRole] = useState('');
  const [currentEmail, setCurrentEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

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

        const [adminList, ubList] = await Promise.all([
          fetchAdminList(),
          fetchUnderbossList(),
        ]);
        setAdmins(adminList);
        setUnderbosses(ubList);
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
        </div>
      </main>

      <Footer />
    </div>
  );
}
