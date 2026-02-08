import React, { useState, useEffect, useCallback, useContext, useRef } from 'react';
import { Performer, Song, Playlist, MusicPlatform } from '../../types';
import { PizzaContext } from '../../contexts/PizzaContext';
import {
  getPerformers,
  addPerformer,
  updatePerformer,
  deletePerformer,
  reorderPerformers,
  CreatePerformerData,
  UpdatePerformerData,
} from '../../lib/api';
import { PerformerCard } from './PerformerCard';
import { PerformerForm, PerformerFormData } from './PerformerForm';
import { SongCard } from './SongCard';
import { SongForm, SongFormData } from './SongForm';
import { PlaylistCard } from './PlaylistCard';
import { PlaylistForm, PlaylistFormData } from './PlaylistForm';
import { LineupOverview } from './LineupOverview';
import { Music, Plus, Loader2, Mic2, ListMusic, Disc3, Upload, Share2, Check } from 'lucide-react';

interface MusicWidgetProps {
  isHost?: boolean;
  partyId?: string; // Optional - if not provided, will use PizzaContext
}

type MusicSection = 'performers' | 'songs' | 'playlists';

export const MusicWidget: React.FC<MusicWidgetProps> = ({ isHost = false, partyId: propsPartyId }) => {
  // Try to use PizzaContext, but don't require it
  const pizzaContext = useContext(PizzaContext);
  const contextPartyId = pizzaContext?.party?.id;
  const effectivePartyId = propsPartyId || contextPartyId;

  // Performers state
  const [performers, setPerformers] = useState<Performer[]>([]);
  const [musicEnabled, setMusicEnabled] = useState(false);
  const [musicNotes, setMusicNotes] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Songs and Playlists state (stored locally since backend doesn't support them yet)
  const [songs, setSongs] = useState<Song[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);

  // Active section
  const [activeSection, setActiveSection] = useState<MusicSection>('performers');

  // Performer form state
  const [isPerformerFormOpen, setIsPerformerFormOpen] = useState(false);
  const [editingPerformer, setEditingPerformer] = useState<Performer | null>(null);
  const [savingPerformer, setSavingPerformer] = useState(false);

  // Song form state
  const [isSongFormOpen, setIsSongFormOpen] = useState(false);
  const [editingSong, setEditingSong] = useState<Song | null>(null);
  const [savingSong, setSavingSong] = useState(false);

  // Playlist form state
  const [isPlaylistFormOpen, setIsPlaylistFormOpen] = useState(false);
  const [editingPlaylist, setEditingPlaylist] = useState<Playlist | null>(null);
  const [savingPlaylist, setSavingPlaylist] = useState(false);

  // File upload state for songs
  const [isSongDragOver, setIsSongDragOver] = useState(false);
  const songFileInputRef = useRef<HTMLInputElement>(null);

  // Share button state
  const [copied, setCopied] = useState(false);

  // Drag state for performers
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  // Load performers from API
  const loadPerformers = useCallback(async () => {
    if (!effectivePartyId) return;

    setLoading(true);
    setError(null);

    try {
      const response = await getPerformers(effectivePartyId);
      if (response) {
        setPerformers(response.performers);
        setMusicEnabled(response.musicEnabled);
        setMusicNotes(response.musicNotes);
      }
    } catch (err) {
      console.error('Error loading performers:', err);
      setError('Failed to load music lineup');
    } finally {
      setLoading(false);
    }
  }, [effectivePartyId]);

  // Load songs and playlists from localStorage (temporary until backend support)
  const loadLocalMusicData = useCallback(() => {
    if (!effectivePartyId) return;

    const storedSongs = localStorage.getItem(`music_songs_${effectivePartyId}`);
    const storedPlaylists = localStorage.getItem(`music_playlists_${effectivePartyId}`);

    if (storedSongs) {
      try {
        setSongs(JSON.parse(storedSongs));
      } catch (e) {
        console.error('Error parsing stored songs:', e);
      }
    }

    if (storedPlaylists) {
      try {
        setPlaylists(JSON.parse(storedPlaylists));
      } catch (e) {
        console.error('Error parsing stored playlists:', e);
      }
    }
  }, [effectivePartyId]);

  // Save songs to localStorage
  const saveSongsToLocal = useCallback((newSongs: Song[]) => {
    if (!effectivePartyId) return;
    localStorage.setItem(`music_songs_${effectivePartyId}`, JSON.stringify(newSongs));
    setSongs(newSongs);
  }, [effectivePartyId]);

  // Save playlists to localStorage
  const savePlaylistsToLocal = useCallback((newPlaylists: Playlist[]) => {
    if (!effectivePartyId) return;
    localStorage.setItem(`music_playlists_${effectivePartyId}`, JSON.stringify(newPlaylists));
    setPlaylists(newPlaylists);
  }, [effectivePartyId]);

  useEffect(() => {
    loadPerformers();
    loadLocalMusicData();
  }, [loadPerformers, loadLocalMusicData]);

  // ============================================
  // Performer handlers
  // ============================================
  const handleSavePerformer = async (formData: PerformerFormData) => {
    if (!effectivePartyId) return;

    setSavingPerformer(true);
    setError(null);

    try {
      const data: CreatePerformerData | UpdatePerformerData = {
        name: formData.name,
        type: formData.type,
        genre: formData.genre || undefined,
        setTime: formData.setTime || undefined,
        setDuration: formData.setDuration ? parseInt(formData.setDuration, 10) : undefined,
        contactName: formData.contactName || undefined,
        contactEmail: formData.contactEmail || undefined,
        contactPhone: formData.contactPhone || undefined,
        instagram: formData.instagram || undefined,
        soundcloud: formData.soundcloud || undefined,
        status: formData.status,
        equipmentProvided: formData.equipmentProvided,
        equipmentNotes: formData.equipmentNotes || undefined,
        fee: formData.fee ? parseFloat(formData.fee) : undefined,
        feePaid: formData.feePaid,
        notes: formData.notes || undefined,
      };

      if (editingPerformer) {
        await updatePerformer(effectivePartyId, editingPerformer.id, data);
      } else {
        await addPerformer(effectivePartyId, data as CreatePerformerData);
      }

      await loadPerformers();
      setIsPerformerFormOpen(false);
      setEditingPerformer(null);
    } catch (err) {
      console.error('Error saving performer:', err);
      setError(err instanceof Error ? err.message : 'Failed to save performer');
    } finally {
      setSavingPerformer(false);
    }
  };

  const handleDeletePerformer = async (performerId: string) => {
    if (!effectivePartyId) return;
    if (!confirm('Are you sure you want to remove this performer?')) return;

    try {
      await deletePerformer(effectivePartyId, performerId);
      await loadPerformers();
    } catch (err) {
      console.error('Error deleting performer:', err);
      setError('Failed to delete performer');
    }
  };

  const handleEditPerformer = (performer: Performer) => {
    setEditingPerformer(performer);
    setIsPerformerFormOpen(true);
  };

  const handleAddPerformer = () => {
    setEditingPerformer(null);
    setIsPerformerFormOpen(true);
  };

  // Drag handlers for performers
  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newPerformers = [...performers];
    const draggedItem = newPerformers[draggedIndex];
    newPerformers.splice(draggedIndex, 1);
    newPerformers.splice(index, 0, draggedItem);

    setPerformers(newPerformers);
    setDraggedIndex(index);
  };

  const handleDragEnd = async () => {
    if (draggedIndex === null || !effectivePartyId) {
      setDraggedIndex(null);
      return;
    }

    setDraggedIndex(null);

    try {
      const performerIds = performers.map((p) => p.id);
      await reorderPerformers(effectivePartyId, performerIds);
    } catch (err) {
      console.error('Error reordering performers:', err);
      setError('Failed to save order');
      await loadPerformers();
    }
  };

  // ============================================
  // Song handlers
  // ============================================
  const handleSaveSong = async (formData: SongFormData) => {
    if (!effectivePartyId) return;

    setSavingSong(true);

    try {
      if (editingSong) {
        // Update existing song
        const updatedSongs = songs.map(s =>
          s.id === editingSong.id
            ? { ...s, ...formData }
            : s
        );
        saveSongsToLocal(updatedSongs);
      } else {
        // Add new song
        const newSong: Song = {
          id: `song_${Date.now()}`,
          partyId: effectivePartyId,
          title: formData.title,
          artist: formData.artist,
          platform: formData.platform,
          url: formData.url || null,
          addedBy: null,
          sortOrder: songs.length,
          createdAt: new Date().toISOString(),
        };
        saveSongsToLocal([...songs, newSong]);
      }

      setIsSongFormOpen(false);
      setEditingSong(null);
    } catch (err) {
      console.error('Error saving song:', err);
      setError('Failed to save song');
    } finally {
      setSavingSong(false);
    }
  };

  const handleDeleteSong = (songId: string) => {
    if (!confirm('Are you sure you want to remove this song?')) return;
    saveSongsToLocal(songs.filter(s => s.id !== songId));
  };

  const handleEditSong = (song: Song) => {
    setEditingSong(song);
    setIsSongFormOpen(true);
  };

  const handleAddSong = () => {
    setEditingSong(null);
    setIsSongFormOpen(true);
  };

  // ============================================
  // Playlist handlers
  // ============================================
  const handleSavePlaylist = async (formData: PlaylistFormData) => {
    if (!effectivePartyId) return;

    setSavingPlaylist(true);

    try {
      if (editingPlaylist) {
        // Update existing playlist
        const updatedPlaylists = playlists.map(p =>
          p.id === editingPlaylist.id
            ? { ...p, ...formData }
            : p
        );
        savePlaylistsToLocal(updatedPlaylists);
      } else {
        // Add new playlist
        const newPlaylist: Playlist = {
          id: `playlist_${Date.now()}`,
          partyId: effectivePartyId,
          name: formData.name,
          platform: formData.platform,
          url: formData.url,
          description: formData.description || null,
          sortOrder: playlists.length,
          createdAt: new Date().toISOString(),
        };
        savePlaylistsToLocal([...playlists, newPlaylist]);
      }

      setIsPlaylistFormOpen(false);
      setEditingPlaylist(null);
    } catch (err) {
      console.error('Error saving playlist:', err);
      setError('Failed to save playlist');
    } finally {
      setSavingPlaylist(false);
    }
  };

  const handleDeletePlaylist = (playlistId: string) => {
    if (!confirm('Are you sure you want to remove this playlist?')) return;
    savePlaylistsToLocal(playlists.filter(p => p.id !== playlistId));
  };

  const handleEditPlaylist = (playlist: Playlist) => {
    setEditingPlaylist(playlist);
    setIsPlaylistFormOpen(true);
  };

  const handleAddPlaylist = () => {
    setEditingPlaylist(null);
    setIsPlaylistFormOpen(true);
  };

  // Section tabs for host view
  const sections: { id: MusicSection; label: string; icon: React.ReactNode; count: number }[] = [
    { id: 'performers', label: 'Performers', icon: <Mic2 size={16} />, count: performers.length },
    { id: 'songs', label: 'Songs', icon: <Disc3 size={16} />, count: songs.length },
    { id: 'playlists', label: 'Playlists', icon: <ListMusic size={16} />, count: playlists.length },
  ];

  // Don't render if music is not enabled and user is not host
  if (!isHost && !musicEnabled) {
    return null;
  }

  // Don't render if no content and not host
  if (!isHost && performers.length === 0 && songs.length === 0 && playlists.length === 0) {
    return null;
  }

  return (
    <div className="card p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Music size={20} className="text-[#ff393a]" />
          <h2 className="text-lg font-semibold text-white">Music</h2>
        </div>
        {isHost && (
          <button
            onClick={() => {
              const inviteCode = pizzaContext?.party?.inviteCode;
              if (!inviteCode) return;
              const djUrl = `${window.location.origin}/dj/${inviteCode}`;
              navigator.clipboard.writeText(djUrl).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              });
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 border border-white/10 rounded-lg text-sm text-white/70 hover:text-white transition-colors"
            title="Copy DJ share link"
          >
            {copied ? (
              <>
                <Check size={14} className="text-green-400" />
                <span className="text-green-400">Copied!</span>
              </>
            ) : (
              <>
                <Share2 size={14} />
                <span>Share with DJ</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 rounded-xl text-sm bg-red-500/10 border border-red-500/30 text-red-400 mb-4">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 size={24} className="animate-spin text-white/50" />
        </div>
      ) : (
        <>
          {/* Section Tabs (Host Only) */}
          {isHost && (
            <div className="flex gap-2 mb-4 border-b border-white/10 pb-4">
              {sections.map((section) => (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeSection === section.id
                      ? 'bg-[#ff393a] text-white'
                      : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {section.icon}
                  <span>{section.label}</span>
                  {section.count > 0 && (
                    <span className={`px-1.5 py-0.5 rounded-full text-xs ${
                      activeSection === section.id ? 'bg-white/20' : 'bg-white/10'
                    }`}>
                      {section.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Performers Section */}
          {(activeSection === 'performers' || !isHost) && (
            <div className="space-y-4">
              {/* Lineup Overview (show if there are performers and not host) */}
              {performers.length > 0 && !isHost && (
                <LineupOverview performers={performers} />
              )}

              {/* Host View - Editable List */}
              {isHost && activeSection === 'performers' && (
                <>
                  {performers.length > 0 ? (
                    <div className="space-y-2">
                      {performers.map((performer, index) => (
                        <PerformerCard
                          key={performer.id}
                          performer={performer}
                          onEdit={handleEditPerformer}
                          onDelete={handleDeletePerformer}
                          isDragging={draggedIndex === index}
                          dragHandleProps={{
                            onDragStart: () => handleDragStart(index),
                            onDragOver: (e) => handleDragOver(e, index),
                            onDragEnd: handleDragEnd,
                          }}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-white/50">
                      <Mic2 size={32} className="mx-auto mb-2 opacity-50" />
                      <p>No performers added yet</p>
                      <p className="text-sm">Add DJs, bands, or solo artists</p>
                    </div>
                  )}

                  {/* Lineup Overview (show below cards for host) */}
                  {performers.length > 0 && (
                    <LineupOverview performers={performers} />
                  )}

                  {/* Add Performer Button */}
                  <button
                    onClick={handleAddPerformer}
                    className="w-full btn-secondary flex items-center justify-center gap-2"
                  >
                    <Plus size={18} />
                    Add Performer
                  </button>
                </>
              )}
            </div>
          )}

          {/* Songs Section */}
          {isHost && activeSection === 'songs' && (
            <div className="space-y-4">
              {songs.length > 0 ? (
                <div className="space-y-2">
                  {songs.map((song) => (
                    <SongCard
                      key={song.id}
                      song={song}
                      onEdit={handleEditSong}
                      onDelete={handleDeleteSong}
                      isHost={true}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-white/50">
                  <Disc3 size={32} className="mx-auto mb-2 opacity-50" />
                  <p>No songs added yet</p>
                  <p className="text-sm">Add individual songs with links to Spotify, YouTube, etc.</p>
                </div>
              )}


              {isSongDragOver && (
                <div className="border-2 border-dashed border-[#ff393a] bg-[#ff393a]/10 rounded-xl p-4 text-center">
                  <Upload size={20} className="mx-auto mb-1 text-[#ff393a]" />
                  <p className="text-sm text-white/60">Drop audio file here</p>
                </div>
              )}
              {/* Add Song Button */}
              <button
                onClick={handleAddSong}
                className="w-full btn-secondary flex items-center justify-center gap-2"
              >
                <Plus size={18} />
                Add Song
              </button>
            </div>
          )}

          {/* Playlists Section */}
          {isHost && activeSection === 'playlists' && (
            <div className="space-y-4">
              {playlists.length > 0 ? (
                <div className="space-y-2">
                  {playlists.map((playlist) => (
                    <PlaylistCard
                      key={playlist.id}
                      playlist={playlist}
                      onEdit={handleEditPlaylist}
                      onDelete={handleDeletePlaylist}
                      isHost={true}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-white/50">
                  <ListMusic size={32} className="mx-auto mb-2 opacity-50" />
                  <p>No playlists added yet</p>
                  <p className="text-sm">Add Spotify, Apple Music, or YouTube playlists</p>
                </div>
              )}

              {/* Add Playlist Button */}
              <button
                onClick={handleAddPlaylist}
                className="w-full btn-secondary flex items-center justify-center gap-2"
              >
                <Plus size={18} />
                Add Playlist
              </button>
            </div>
          )}

          {/* Guest View - Show Songs and Playlists if they exist */}
          {!isHost && (songs.length > 0 || playlists.length > 0) && (
            <div className="space-y-4 mt-4">
              {/* Songs */}
              {songs.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-white/70 mb-2 flex items-center gap-2">
                    <Disc3 size={14} />
                    Songs
                  </h3>
                  <div className="space-y-2">
                    {songs.map((song) => (
                      <SongCard
                        key={song.id}
                        song={song}
                        onEdit={() => {}}
                        onDelete={() => {}}
                        isHost={false}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Playlists */}
              {playlists.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-white/70 mb-2 flex items-center gap-2">
                    <ListMusic size={14} />
                    Playlists
                  </h3>
                  <div className="space-y-2">
                    {playlists.map((playlist) => (
                      <PlaylistCard
                        key={playlist.id}
                        playlist={playlist}
                        onEdit={() => {}}
                        onDelete={() => {}}
                        isHost={false}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Performer Form Modal */}
      <PerformerForm
        performer={editingPerformer}
        isOpen={isPerformerFormOpen}
        onClose={() => {
          setIsPerformerFormOpen(false);
          setEditingPerformer(null);
        }}
        onSave={handleSavePerformer}
        saving={savingPerformer}
      />

      {/* Song Form Modal */}
      <SongForm
        song={editingSong}
        isOpen={isSongFormOpen}
        onClose={() => {
          setIsSongFormOpen(false);
          setEditingSong(null);
        }}
        onSave={handleSaveSong}
        saving={savingSong}
      />

      {/* Playlist Form Modal */}
      <PlaylistForm
        playlist={editingPlaylist}
        isOpen={isPlaylistFormOpen}
        onClose={() => {
          setIsPlaylistFormOpen(false);
          setEditingPlaylist(null);
        }}
        onSave={handleSavePlaylist}
        saving={savingPlaylist}
      />
    </div>
  );
};
