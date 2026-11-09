import React, { useEffect, useState } from 'react';
import { Clapperboard, Loader2, Save } from 'lucide-react';
import {
  fetchMusicLibrary,
  fetchReelSettings,
  saveReelSettings,
  type MusicLibrary,
  type ReelSettings,
} from '../../lib/reelsApi';

const NUMBER_FIELDS: Array<{ key: keyof ReelSettings; label: string; min: number; max: number }> = [
  { key: 'targetSeconds', label: 'Target length (s)', min: 10, max: 60 },
  { key: 'maxSeconds', label: 'Max length (s)', min: 15, max: 60 },
  { key: 'maxPhotos', label: 'Photos per reel', min: 3, max: 30 },
  { key: 'minPhotos', label: 'Min photos to make one', min: 1, max: 10 },
  { key: 'perUserDailyLimit', label: 'Reels per person per day', min: 1, max: 50 },
  { key: 'maxActivePerParty', label: 'Reels rendering at once per event', min: 1, max: 5 },
];

/** Admin: reel limits and which music folders/tracks from the PizzaDAO library hosts may use. */
export const ReelSettingsPanel: React.FC = () => {
  const [settings, setSettings] = useState<ReelSettings | null>(null);
  const [library, setLibrary] = useState<MusicLibrary | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const s = await fetchReelSettings();
        setSettings(s.settings);
        setLibrary(await fetchMusicLibrary().catch(() => null));
      } catch (e) {
        setMessage(e instanceof Error ? e.message : 'Could not load reel settings');
      }
    })();
  }, []);

  if (!settings) {
    return <div className="card p-6 text-theme-text-muted">{message ?? 'Loading reel settings'}</div>;
  }

  const toggle = (list: 'musicFolders' | 'blockedTracks', value: string) => {
    const has = settings[list].includes(value);
    setSettings({ ...settings, [list]: has ? settings[list].filter((x) => x !== value) : [...settings[list], value] });
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      setSettings(await saveReelSettings(settings));
      setMessage('Saved');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Clapperboard size={20} className="text-theme-accent" />
        <h2 className="text-lg font-semibold text-theme-text">Sizzle reels</h2>
      </div>

      <label className="flex items-center gap-2 text-theme-text">
        <input type="checkbox" checked={settings.enabled} onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })} />
        Reels enabled
      </label>

      <div className="grid gap-3 sm:grid-cols-3">
        {NUMBER_FIELDS.map((f) => (
          <label key={f.key} className="text-sm text-theme-text-secondary">
            {f.label}
            <input
              type="number"
              min={f.min}
              max={f.max}
              className="mt-1 w-full rounded-lg bg-theme-input border border-theme-stroke px-3 py-2 text-theme-text"
              value={settings[f.key] as number}
              onChange={(e) => setSettings({ ...settings, [f.key]: Number(e.target.value) })}
            />
          </label>
        ))}
      </div>

      <div className="space-y-2">
        <h3 className="font-medium text-theme-text">Music library</h3>
        {!library?.configured && (
          <p className="text-sm text-theme-text-muted">
            The music bucket is not connected (REEL_MUSIC_R2_* env vars on the backend). Folders can still be typed below.
          </p>
        )}
        <p className="text-sm text-theme-text-secondary">Folders hosts can pick songs from. Reels always also get a no-music version.</p>
        <div className="flex flex-wrap gap-3">
          {Array.from(new Set([...(library?.folders ?? []), ...settings.musicFolders])).map((f) => (
            <label key={f} className="flex items-center gap-2 text-sm text-theme-text">
              <input type="checkbox" checked={settings.musicFolders.includes(f)} onChange={() => toggle('musicFolders', f)} />
              {f}
            </label>
          ))}
        </div>
        {library && library.tracks.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-theme-text-secondary">Tracks ({library.tracks.filter((t) => !settings.blockedTracks.includes(t.key)).length} usable)</summary>
            <ul className="mt-2 space-y-1 max-h-60 overflow-auto">
              {library.tracks.map((t) => (
                <li key={t.key}>
                  <label className="flex items-center gap-2 text-theme-text">
                    <input type="checkbox" checked={!settings.blockedTracks.includes(t.key)} onChange={() => toggle('blockedTracks', t.key)} />
                    {t.folder ? `${t.folder} / ` : ''}{t.title}
                  </label>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button className="btn-primary inline-flex items-center gap-2" disabled={saving} onClick={save}>
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save
        </button>
        {message && <span className="text-sm text-theme-text-muted">{message}</span>}
      </div>
    </div>
  );
};
