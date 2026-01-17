import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { useAuth } from '../contexts/AuthContext';
import { Loader2, Upload, Instagram, Youtube, Linkedin, Globe, LogOut, Trash2, AlertTriangle, Save, X } from 'lucide-react';

export function AccountPage() {
  const { user, loading: authLoading, signOut, updateProfile } = useAuth();
  const navigate = useNavigate();

  // Form state
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [profilePicture, setProfilePicture] = useState<string | null>(null);
  const [profilePictureFile, setProfilePictureFile] = useState<File | null>(null);

  // Social links
  const [instagram, setInstagram] = useState('');
  const [twitter, setTwitter] = useState('');
  const [youtube, setYoutube] = useState('');
  const [tiktok, setTiktok] = useState('');
  const [linkedin, setLinkedin] = useState('');
  const [website, setWebsite] = useState('');

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Track original values to detect changes
  const [originalValues, setOriginalValues] = useState({
    name: '',
    username: '',
    bio: '',
    instagram: '',
    twitter: '',
    youtube: '',
    tiktok: '',
    linkedin: '',
    website: '',
  });

  // Check if any field has changed
  const hasChanges =
    name !== originalValues.name ||
    username !== originalValues.username ||
    bio !== originalValues.bio ||
    instagram !== originalValues.instagram ||
    twitter !== originalValues.twitter ||
    youtube !== originalValues.youtube ||
    tiktok !== originalValues.tiktok ||
    linkedin !== originalValues.linkedin ||
    website !== originalValues.website ||
    profilePictureFile !== null;

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/login');
    }
  }, [user, authLoading, navigate]);

  // Load user data
  useEffect(() => {
    if (user) {
      const userName = user.name || '';
      setName(userName);
      setOriginalValues(prev => ({ ...prev, name: userName }));
      // TODO: Load other profile data from database when available
    }
  }, [user]);

  const handleProfilePictureChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setProfilePictureFile(file);
    setProfilePicture(objectUrl);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      // Save profile to backend
      await updateProfile({ name: name.trim() || undefined });

      // Update original values to current values
      setOriginalValues({
        name,
        username,
        bio,
        instagram,
        twitter,
        youtube,
        tiktok,
        linkedin,
        website,
      });
      setProfilePictureFile(null);

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      console.error('Failed to save profile:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => {
    signOut();
    navigate('/');
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    // TODO: Call API to delete user account and all associated data
    await new Promise(resolve => setTimeout(resolve, 500));
    signOut();
    navigate('/');
  };

  if (authLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[50vh]">
          <Loader2 size={32} className="animate-spin text-white/60" />
        </div>
      </Layout>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <Layout>
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="card p-8 relative">
          {/* Close button */}
          <button
            type="button"
            onClick={() => navigate('/')}
            className="absolute top-4 right-4 text-white/50 hover:text-white transition-colors"
          >
            <X size={24} />
          </button>

          <div className="mb-8">
            <h1 className="text-2xl font-bold text-white mb-2">Your Profile</h1>
            <p className="text-white/60">Choose how you are displayed as a host or guest.</p>
          </div>

          <form onSubmit={handleSave} className="space-y-6">
            {/* Name and Profile Picture Row */}
            <div className="flex flex-col md:flex-row gap-6">
              <div className="flex-1 space-y-4">
                {/* Name */}
                <div>
                  <label className="block text-sm font-medium text-white/70 mb-2">
                    Name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    className="w-full"
                  />
                </div>

                {/* Username */}
                <div>
                  <label className="block text-sm font-medium text-white/70 mb-2">
                    Username
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 font-medium">@</span>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                      placeholder="username"
                      className="w-full pl-8"
                    />
                  </div>
                </div>
              </div>

              {/* Profile Picture */}
              <div className="flex-shrink-0">
                <label className="block text-sm font-medium text-white/70 mb-2">
                  Profile Picture
                </label>
                <div className="relative">
                  <input
                    type="file"
                    id="profilePicture"
                    accept="image/*"
                    onChange={handleProfilePictureChange}
                    className="hidden"
                  />
                  <label
                    htmlFor="profilePicture"
                    className="block w-24 h-24 rounded-full cursor-pointer overflow-hidden bg-[#ff393a]/20 border-2 border-white/10 hover:border-[#ff393a]/50 transition-colors"
                  >
                    {profilePicture ? (
                      <img
                        src={profilePicture}
                        alt="Profile"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <span className="text-4xl">🍕</span>
                      </div>
                    )}
                  </label>
                  <label
                    htmlFor="profilePicture"
                    className="absolute -bottom-1 -right-1 w-8 h-8 bg-[#1a1a2e] border-2 border-white/20 rounded-full flex items-center justify-center cursor-pointer hover:bg-white/10 transition-colors"
                  >
                    <Upload size={14} className="text-white/70" />
                  </label>
                </div>
              </div>
            </div>

            {/* Bio */}
            <div>
              <label className="block text-sm font-medium text-white/70 mb-2">
                Bio
              </label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Tell us about yourself..."
                className="w-full"
                rows={3}
              />
            </div>

            {/* Social Links */}
            <div>
              <label className="block text-sm font-medium text-white/70 mb-3">
                Social Links
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Instagram */}
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2 flex-shrink-0">
                    <Instagram size={16} className="text-white/50" />
                    <span className="text-white/50 text-sm">instagram.com/</span>
                  </div>
                  <input
                    type="text"
                    value={instagram}
                    onChange={(e) => setInstagram(e.target.value)}
                    placeholder="username"
                    className="flex-1 min-w-0"
                  />
                </div>

                {/* X (Twitter) */}
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2 flex-shrink-0">
                    <svg viewBox="0 0 24 24" className="w-4 h-4 text-white/50 fill-current">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                    </svg>
                    <span className="text-white/50 text-sm">x.com/</span>
                  </div>
                  <input
                    type="text"
                    value={twitter}
                    onChange={(e) => setTwitter(e.target.value)}
                    placeholder="username"
                    className="flex-1 min-w-0"
                  />
                </div>

                {/* YouTube */}
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2 flex-shrink-0">
                    <Youtube size={16} className="text-white/50" />
                    <span className="text-white/50 text-sm">youtube.com/@</span>
                  </div>
                  <input
                    type="text"
                    value={youtube}
                    onChange={(e) => setYoutube(e.target.value)}
                    placeholder="channel"
                    className="flex-1 min-w-0"
                  />
                </div>

                {/* TikTok */}
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2 flex-shrink-0">
                    <svg viewBox="0 0 24 24" className="w-4 h-4 text-white/50 fill-current">
                      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
                    </svg>
                    <span className="text-white/50 text-sm">tiktok.com/@</span>
                  </div>
                  <input
                    type="text"
                    value={tiktok}
                    onChange={(e) => setTiktok(e.target.value)}
                    placeholder="username"
                    className="flex-1 min-w-0"
                  />
                </div>

                {/* LinkedIn */}
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2 flex-shrink-0">
                    <Linkedin size={16} className="text-white/50" />
                    <span className="text-white/50 text-sm">linkedin.com</span>
                  </div>
                  <input
                    type="text"
                    value={linkedin}
                    onChange={(e) => setLinkedin(e.target.value)}
                    placeholder="/in/handle"
                    className="flex-1 min-w-0"
                  />
                </div>

                {/* Website */}
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2 flex-shrink-0">
                    <Globe size={16} className="text-white/50" />
                  </div>
                  <input
                    type="url"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    placeholder="https://yourwebsite.com"
                    className="flex-1 min-w-0"
                  />
                </div>
              </div>
            </div>

            {/* Save Button - only show when there are changes */}
            {(hasChanges || saving || saved) && (
              <div className="flex items-center gap-4">
                <button
                  type="submit"
                  disabled={saving || !hasChanges}
                  className="btn-primary flex items-center gap-2"
                >
                  {saving ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Saving...
                    </>
                  ) : saved ? (
                    'Saved!'
                  ) : (
                    <>
                      <Save size={18} />
                      Save
                    </>
                  )}
                </button>
              </div>
            )}
          </form>

          {/* Logout Section */}
          <div className="mt-12 pt-6 border-t border-white/10 flex items-center justify-between">
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 text-white/60 hover:text-white transition-colors"
            >
              <LogOut size={18} />
              Log Out
            </button>

            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="flex items-center gap-2 text-[#ff393a]/60 hover:text-[#ff393a] transition-colors"
            >
              <Trash2 size={18} />
              Delete Account
            </button>
          </div>
        </div>

        {/* Delete Account Confirmation Modal */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
            <div className="card p-6 max-w-md w-full">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 bg-[#ff393a]/20 rounded-full flex items-center justify-center">
                  <AlertTriangle size={24} className="text-[#ff393a]" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">Delete Account</h2>
                  <p className="text-white/60 text-sm">This action cannot be undone</p>
                </div>
              </div>

              <p className="text-white/70 mb-6">
                Are you sure you want to delete your account? All your data, including hosted parties and RSVP history, will be permanently removed.
              </p>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 btn-secondary"
                  disabled={deleting}
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteAccount}
                  disabled={deleting}
                  className="flex-1 bg-[#ff393a] hover:bg-[#ff393a]/80 text-white font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {deleting ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    <>
                      <Trash2 size={18} />
                      Delete Account
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
