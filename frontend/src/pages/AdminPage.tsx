import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Layout } from '../components/Layout';
import { IconInput } from '../components/IconInput';
import {
  Shield, ShieldCheck, UserPlus, Trash2, Loader2,
  Mail, User, Globe,
} from 'lucide-react';
import {
  fetchAdminMe, fetchAdminList, addAdmin, removeAdmin,
  fetchUnderbossList, createUnderboss, deactivateUnderboss,
} from '../lib/api';
import { GPP_REGIONS } from '../types';
import type { AdminUser, UnderbossAdmin } from '../types';

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
  const [ubRegion, setUbRegion] = useState('');
  const [addingUb, setAddingUb] = useState(false);
  const [ubMessage, setUbMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const isSuperAdmin = currentRole === 'super_admin';

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
    if (!ubName.trim() || !ubEmail.trim() || !ubRegion) return;
    setAddingUb(true);
    setUbMessage(null);
    try {
      const result = await createUnderboss({
        name: ubName.trim(),
        email: ubEmail.trim(),
        region: ubRegion,
      });
      setUnderbosses((prev) => [...prev, result.underboss]);
      setUbName('');
      setUbEmail('');
      setUbRegion('');
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

  if (loading) {
    return (
      <Layout className="gpp-theme gpp-gray">
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 size={32} className="animate-spin text-white/40" />
        </div>
      </Layout>
    );
  }

  if (!isAdminUser || error) {
    return (
      <Layout className="gpp-theme gpp-gray">
        <div className="min-h-screen flex flex-col items-center justify-center px-4">
          <Shield size={48} className="text-red-400/60 mb-4" />
          <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
          <p className="text-white/50 text-center max-w-md">
            {error || 'You do not have admin access. Please log in with an admin account.'}
          </p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout className="gpp-theme gpp-gray">
      <div className="min-h-screen">
        <Helmet>
          <title>Admin | RSV.Pizza</title>
        </Helmet>

        <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center">
              <ShieldCheck size={20} className="text-red-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Admin Panel</h1>
              <p className="text-sm text-white/40">Manage admins and underbosses</p>
            </div>
          </div>

          {/* Admin Management */}
          <section className="mb-10">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Shield size={18} className="text-white/60" />
              Admins ({admins.length})
            </h2>

            {adminMessage && (
              <div
                className={`mb-4 px-4 py-2 rounded-lg text-sm ${
                  adminMessage.type === 'success'
                    ? 'bg-green-500/20 text-green-300 border border-green-500/30'
                    : 'bg-red-500/20 text-red-300 border border-red-500/30'
                }`}
              >
                {adminMessage.text}
              </div>
            )}

            {isSuperAdmin && (
              <form onSubmit={handleAddAdmin} className="bg-white/5 border border-white/10 rounded-xl p-4 mb-4">
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
                    className="flex items-center gap-2 bg-white/10 hover:bg-white/20 disabled:opacity-50 rounded-lg px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap"
                  >
                    {addingAdmin ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
                    Add Admin
                  </button>
                </div>
              </form>
            )}

            <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-white/40 text-left">
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Role</th>
                    <th className="px-4 py-3 font-medium">Added</th>
                    {isSuperAdmin && <th className="px-4 py-3 font-medium w-20"></th>}
                  </tr>
                </thead>
                <tbody>
                  {admins.map((admin) => (
                    <tr key={admin.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="px-4 py-3 text-white/80">{admin.email}</td>
                      <td className="px-4 py-3 text-white/60">{admin.name || '-'}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                            admin.role === 'super_admin'
                              ? 'bg-red-500/20 text-red-500 border border-red-500/30'
                              : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                          }`}
                        >
                          {admin.role === 'super_admin' ? 'Super Admin' : 'Admin'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-white/40">
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
                      <td colSpan={5} className="px-4 py-8 text-center text-white/30">
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
              <Globe size={18} className="text-white/60" />
              Underbosses ({underbosses.length})
            </h2>

            {ubMessage && (
              <div
                className={`mb-4 px-4 py-2 rounded-lg text-sm ${
                  ubMessage.type === 'success'
                    ? 'bg-green-500/20 text-green-300 border border-green-500/30'
                    : 'bg-red-500/20 text-red-300 border border-red-500/30'
                }`}
              >
                {ubMessage.text}
              </div>
            )}

            <form onSubmit={handleAddUnderboss} className="bg-white/5 border border-white/10 rounded-xl p-4 mb-4">
              <div className="flex flex-col sm:flex-row gap-3">
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
                <select
                  value={ubRegion}
                  onChange={(e) => setUbRegion(e.target.value)}
                  required
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm"
                >
                  <option value="" disabled>Region</option>
                  {GPP_REGIONS.map((r) => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={addingUb || !ubName.trim() || !ubEmail.trim() || !ubRegion}
                  className="flex items-center gap-2 bg-white/10 hover:bg-white/20 disabled:opacity-50 rounded-lg px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap"
                >
                  {addingUb ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
                  Add Underboss
                </button>
              </div>
            </form>

            <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-white/40 text-left">
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">Region</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {underbosses.map((ub) => (
                    <tr key={ub.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="px-4 py-3 text-white/80">{ub.name}</td>
                      <td className="px-4 py-3 text-white/60">{ub.email}</td>
                      <td className="px-4 py-3 text-white/60">
                        {GPP_REGIONS.find((r) => r.id === ub.region)?.label || ub.region}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                            ub.isActive
                              ? 'bg-green-500/20 text-green-300 border border-green-500/30'
                              : 'bg-red-500/20 text-red-300 border border-red-500/30'
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
                              className="text-white/40 hover:text-red-400 transition-colors p-1"
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
                      <td colSpan={5} className="px-4 py-8 text-center text-white/30">
                        No underbosses yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      </div>
    </Layout>
  );
}
