import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Loader2, AlertCircle, Music, Calendar, MapPin, Mic2, Disc3, ListMusic, ExternalLink, Clock, Instagram } from 'lucide-react';
import { getEventBySlug, PublicEvent, getPerformers } from '../lib/api';
import { Performer, Song, Playlist, MusicPlatform, PerformerType } from '../types';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { CornerLinks } from '../components/CornerLinks';
// GPP theme applied directly — DJPage is always GPP
import { PlatformIcon } from '../components/music/SongCard';

// Type icons
const typeIcons: Record<PerformerType, string> = {
  dj: '\uD83C\uDFA7',
  live_band: '\uD83C\uDFB8',
  solo: '\uD83C\uDFA4',
  playlist: '\uD83C\uDFB5',
};

const typeLabels: Record<PerformerType, string> = {
  dj: 'DJ',
  live_band: 'Live Band',
  solo: 'Solo Artist',
  playlist: 'Playlist',
};

const platformLabels: Record<MusicPlatform, string> = {
  spotify: 'Spotify',
  apple_music: 'Apple Music',
  youtube: 'YouTube',
  soundcloud: 'SoundCloud',
  other: 'Link',
};

// Format time for display
function formatTime(time: string | null): string {
  if (!time) return '';
  const [hours, minutes] = time.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const hours12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return `${hours12}:${minutes.toString().padStart(2, '0')} ${period}`;
}

// Format duration
function formatDuration(minutes: number | null): string {
  if (!minutes) return '';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) return `${hours} hr${hours > 1 ? 's' : ''}`;
  return `${hours}h ${mins}m`;
}

export function DJPage() {
  const { inviteCode } = useParams<{ inviteCode: string }>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [performers, setPerformers] = useState<Performer[]>([]);
  const [songs, setSongs] = useState<Song[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);

  useEffect(() => {
    async function loadData() {
      if (!inviteCode) {
        setError('Invalid DJ page link');
        setLoading(false);
        return;
      }

      try {
        // Load event details
        const foundEvent = await getEventBySlug(inviteCode);
        if (!foundEvent) {
          setError('Event not found. The link may be invalid or expired.');
          setLoading(false);
          return;
        }
        setEvent(foundEvent);

        // Load performers from API
        const performerResponse = await getPerformers(foundEvent.id);
        if (performerResponse) {
          setPerformers(performerResponse.performers.filter(p => p.status !== 'cancelled'));
        }

        // Load songs and playlists from localStorage (if available on same browser)
        try {
          const storedSongs = localStorage.getItem(`music_songs_${foundEvent.id}`);
          if (storedSongs) setSongs(JSON.parse(storedSongs));
        } catch (e) { /* ignore parse errors */ }

        try {
          const storedPlaylists = localStorage.getItem(`music_playlists_${foundEvent.id}`);
          if (storedPlaylists) setPlaylists(JSON.parse(storedPlaylists));
        } catch (e) { /* ignore parse errors */ }

      } catch (err) {
        console.error('Error loading DJ page data:', err);
        setError('Failed to load event data');
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [inviteCode]);

  const themeClass = 'gpp-theme';
  const backgroundStyle = { background: 'linear-gradient(180deg, #7EC8E3 0%, #B6E4F7 100%)' } as React.CSSProperties;

  // Set body class for elements outside React tree
  useEffect(() => {
    document.body.classList.add('gpp-theme-active');
    return () => { document.body.classList.remove('gpp-theme-active'); };
  }, []);

  if (loading) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${themeClass}`} style={backgroundStyle}>
        <Loader2 className="w-8 h-8 animate-spin text-[#ff393a]" />
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className={`min-h-screen flex items-center justify-center p-4 ${themeClass}`} style={backgroundStyle}>
        <div className="card p-8 max-w-md text-center">
          <AlertCircle className="w-16 h-16 text-[#ff393a] mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-theme-text mb-2">Page Not Found</h1>
          <p className="text-theme-text-secondary mb-6">{error}</p>
          <Link to="/" className="btn-primary inline-block">
            Go to Home
          </Link>
        </div>
      </div>
    );
  }

  const eventDate = event.date ? new Date(event.date) : null;
  const formattedDate = eventDate?.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: event.timezone || undefined,
  });
  const formattedTime = eventDate?.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: event.timezone || undefined,
  });

  const endDate = eventDate && event.duration
    ? new Date(eventDate.getTime() + event.duration * 3600000)
    : null;
  const formattedEndTime = endDate?.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: event.timezone || undefined,
  });

  // Sort performers by set time
  const sortedPerformers = [...performers].sort((a, b) => {
    if (!a.setTime && !b.setTime) return a.sortOrder - b.sortOrder;
    if (!a.setTime) return 1;
    if (!b.setTime) return -1;
    return a.setTime.localeCompare(b.setTime);
  });

  const hasContent = sortedPerformers.length > 0 || songs.length > 0 || playlists.length > 0;

  return (
    <div className={`min-h-screen ${themeClass}`} style={backgroundStyle}>
      <Helmet>
        <title>DJ Info - {event.name} | RSV.Pizza</title>
        <meta name="robots" content="noindex" />
      </Helmet>

      <Header variant="transparent" />

      <div className="max-w-2xl mx-auto py-8 px-4">
        {/* Event Header */}
        <div className="card p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <Music size={24} className="text-[#ff393a]" />
            <div>
              <p className="text-sm text-theme-text-muted uppercase tracking-wider font-medium">DJ / Music Info</p>
              <h1 className="text-2xl font-bold text-theme-text" style={{ fontFamily: "'Rubik', sans-serif" }}>{event.name}</h1>
            </div>
          </div>

          {/* Date & Time */}
          {event.date && (
            <div className="flex items-start gap-3 mb-3">
              <Calendar className="w-5 h-5 text-[#ff393a] flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-theme-text font-medium">{formattedDate}</p>
                <p className="text-theme-text-secondary text-sm">
                  {formattedTime}
                  {formattedEndTime && ` - ${formattedEndTime}`}
                </p>
              </div>
            </div>
          )}

          {/* Location */}
          {event.address && (
            <div className="flex items-start gap-3">
              <MapPin className="w-5 h-5 text-[#ff393a] flex-shrink-0 mt-0.5" />
              <div>
                {event.venueName && (
                  <p className="text-theme-text font-medium">{event.venueName}</p>
                )}
                <p className={event.venueName ? 'text-theme-text-secondary text-sm' : 'text-theme-text font-medium'}>{event.address}</p>
              </div>
            </div>
          )}
        </div>

        {!hasContent && (
          <div className="card p-8 text-center">
            <Music size={48} className="mx-auto mb-4 text-theme-text-faint" />
            <p className="text-theme-text-muted text-lg">No music information available yet</p>
            <p className="text-theme-text-faint text-sm mt-2">The host hasn't added any performers, songs, or playlists</p>
          </div>
        )}

        {/* Performers / Lineup */}
        {sortedPerformers.length > 0 && (
          <div className="card p-6 mb-6">
            <div className="flex items-center gap-2 mb-4">
              <Mic2 size={20} className="text-[#ff393a]" />
              <h2 className="text-lg font-semibold text-theme-text">Lineup</h2>
            </div>

            <div className="space-y-3">
              {sortedPerformers.map((performer) => (
                <div
                  key={performer.id}
                  className="bg-theme-surface border border-theme-stroke rounded-xl p-4"
                >
                  <div className="flex items-start gap-3">
                    {/* Type Icon */}
                    <div className="text-2xl flex-shrink-0 pt-0.5">{typeIcons[performer.type]}</div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <h3 className="text-theme-text font-medium text-lg">{performer.name}</h3>

                      <div className="flex items-center gap-2 text-sm text-theme-text-secondary mt-1">
                        <span>{typeLabels[performer.type]}</span>
                        {performer.genre && (
                          <>
                            <span className="text-theme-text-faint">|</span>
                            <span>{performer.genre}</span>
                          </>
                        )}
                      </div>

                      {/* Time Info */}
                      {(performer.setTime || performer.setDuration) && (
                        <div className="flex items-center gap-2 text-sm text-theme-text-secondary mt-2">
                          <Clock size={14} className="text-theme-text-muted" />
                          {performer.setTime && <span>{formatTime(performer.setTime)}</span>}
                          {performer.setTime && performer.setDuration && <span className="text-theme-text-faint">-</span>}
                          {performer.setDuration && <span>{formatDuration(performer.setDuration)} set</span>}
                        </div>
                      )}

                      {/* Equipment */}
                      {performer.equipmentNotes && (
                        <div className="mt-2 text-sm text-yellow-400/80 bg-yellow-400/10 border border-yellow-400/20 rounded-lg px-3 py-2">
                          Equipment: {performer.equipmentNotes}
                        </div>
                      )}
                      {performer.equipmentProvided && !performer.equipmentNotes && (
                        <div className="mt-2 text-sm text-green-400/80">
                          Bringing own equipment
                        </div>
                      )}

                      {/* Social Links */}
                      <div className="flex items-center gap-3 mt-3">
                        {performer.instagram && (
                          <a
                            href={`https://instagram.com/${performer.instagram.replace('@', '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 text-sm text-theme-text-secondary hover:text-theme-text transition-colors"
                          >
                            <Instagram size={14} />
                            <span>{performer.instagram.startsWith('@') ? performer.instagram : `@${performer.instagram}`}</span>
                          </a>
                        )}
                        {performer.soundcloud && (
                          <a
                            href={
                              performer.soundcloud.startsWith('http')
                                ? performer.soundcloud
                                : `https://soundcloud.com/${performer.soundcloud}`
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 text-sm text-theme-text-secondary hover:text-theme-text transition-colors"
                          >
                            <ExternalLink size={14} />
                            <span>SoundCloud</span>
                          </a>
                        )}
                      </div>

                      {/* Notes */}
                      {performer.notes && (
                        <p className="text-sm text-theme-text-muted mt-2 italic">{performer.notes}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Songs */}
        {songs.length > 0 && (
          <div className="card p-6 mb-6">
            <div className="flex items-center gap-2 mb-4">
              <Disc3 size={20} className="text-[#ff393a]" />
              <h2 className="text-lg font-semibold text-theme-text">Requested Songs</h2>
            </div>

            <div className="space-y-2">
              {songs.map((song) => (
                <div
                  key={song.id}
                  className="bg-theme-surface border border-theme-stroke rounded-xl p-3 flex items-center gap-3"
                >
                  <div className="flex-shrink-0">
                    <PlatformIcon platform={song.platform} size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-theme-text font-medium text-sm truncate">{song.title}</p>
                    <p className="text-theme-text-secondary text-xs truncate">{song.artist}</p>
                  </div>
                  {song.url && (
                    <a
                      href={song.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-theme-surface-hover hover:bg-theme-surface-hover rounded-lg text-sm text-theme-text-secondary hover:text-theme-text transition-colors flex-shrink-0"
                    >
                      <ExternalLink size={14} />
                      <span className="hidden sm:inline">{platformLabels[song.platform]}</span>
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Playlists */}
        {playlists.length > 0 && (
          <div className="card p-6 mb-6">
            <div className="flex items-center gap-2 mb-4">
              <ListMusic size={20} className="text-[#ff393a]" />
              <h2 className="text-lg font-semibold text-theme-text">Playlists</h2>
            </div>

            <div className="space-y-2">
              {playlists.map((playlist) => (
                <a
                  key={playlist.id}
                  href={playlist.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block bg-theme-surface border border-theme-stroke rounded-xl p-4 hover:bg-theme-surface-hover transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex-shrink-0">
                      <PlatformIcon platform={playlist.platform} size={22} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-theme-text font-medium truncate">{playlist.name}</p>
                      <p className="text-theme-text-muted text-sm">{platformLabels[playlist.platform]}</p>
                      {playlist.description && (
                        <p className="text-theme-text-muted text-sm mt-1 line-clamp-2">{playlist.description}</p>
                      )}
                    </div>
                    <ExternalLink size={18} className="text-theme-text-muted flex-shrink-0" />
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* RSVP Link */}
        <div className="text-center py-4">
          <Link
            to={`/${event.customUrl || event.inviteCode}`}
            className="text-theme-text-muted hover:text-theme-text-secondary text-sm transition-colors"
          >
            View Event Page
          </Link>
        </div>

        <Footer className="mt-4 pb-2" />
      </div>
      <CornerLinks />
    </div>
  );
}
