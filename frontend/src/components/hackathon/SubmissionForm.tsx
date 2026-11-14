import { useRef, useState } from 'react';
import { Type, Quote, AlignLeft, Github, Video, Presentation, Globe, ImagePlus, X, Loader2, Check } from 'lucide-react';
import { IconInput } from '../IconInput';
import { Hint } from './shared';
import {
  HACKATHON_IMAGE_TYPES,
  HACKATHON_MAX_IMAGE_BYTES,
  HACKATHON_MAX_SCREENSHOTS,
  type HackathonImage,
  type HackathonSubmission,
  type HackathonTrack,
  type SubmissionInput,
} from '../../lib/hackathonApi';

interface Props {
  submission: HackathonSubmission | null;
  tracks: HackathonTrack[];
  maxTracks: number;
  busy: boolean;
  onSave: (body: SubmissionInput) => Promise<boolean>;
  onUpload: (file: File, kind: 'cover' | 'screenshot') => Promise<boolean>;
  onRemoveImage: (path: string) => Promise<boolean>;
  onCancel: () => void;
}

function formFrom(s: HackathonSubmission | null) {
  return {
    name: s?.name ?? '',
    tagline: s?.tagline ?? '',
    description: s?.description ?? '',
    repoUrl: s?.repoUrl ?? '',
    demoVideoUrl: s?.demoVideoUrl ?? '',
    deckUrl: s?.deckUrl ?? '',
    liveUrl: s?.liveUrl ?? '',
    trackIds: s?.trackIds ?? [],
  };
}

/** Client-side check before asking for an upload URL (the server checks again). */
export function imageProblem(file: File): string | null {
  if (!HACKATHON_IMAGE_TYPES.includes(file.type)) return 'Use a JPEG, PNG, WebP, GIF or AVIF image.';
  if (file.size > HACKATHON_MAX_IMAGE_BYTES) return 'That image is too big (10 MB max).';
  return null;
}

/** Project editor (plans/hackathon-platform.md §8). Saving keeps it a draft; Submit is separate. */
export function SubmissionForm({ submission, tracks, maxTracks, busy, onSave, onUpload, onRemoveImage, onCancel }: Props) {
  const [form, setForm] = useState(() => formFrom(submission));
  const [imgError, setImgError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<'cover' | 'screenshot' | null>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const shotInput = useRef<HTMLInputElement>(null);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const toggleTrack = (id: string) => {
    setForm((f) => {
      if (f.trackIds.includes(id)) return { ...f, trackIds: f.trackIds.filter((t) => t !== id) };
      if (maxTracks === 1) return { ...f, trackIds: [id] };
      if (f.trackIds.length >= maxTracks) return f;
      return { ...f, trackIds: [...f.trackIds, id] };
    });
  };

  const save = async () => {
    const body: SubmissionInput = {
      name: form.name,
      tagline: form.tagline || null,
      description: form.description || null,
      repoUrl: form.repoUrl || null,
      demoVideoUrl: form.demoVideoUrl || null,
      deckUrl: form.deckUrl || null,
      liveUrl: form.liveUrl || null,
      trackIds: form.trackIds,
    };
    await onSave(body);
  };

  const pick = async (kind: 'cover' | 'screenshot', files: FileList | null) => {
    setImgError(null);
    const list = Array.from(files ?? []);
    if (!list.length) return;
    const room = kind === 'cover' ? 1 : HACKATHON_MAX_SCREENSHOTS - (submission?.screenshots.length ?? 0);
    if (list.length > room) setImgError(`Only ${room} more screenshot${room === 1 ? '' : 's'} fit.`);
    setUploading(kind);
    for (const file of list.slice(0, room)) {
      const problem = imageProblem(file);
      if (problem) {
        setImgError(problem);
        continue;
      }
      if (!(await onUpload(file, kind))) break;
    }
    setUploading(null);
  };

  const nameOk = form.name.trim().length > 0;
  const shots = submission?.screenshots ?? [];

  const Thumb = ({ img, label }: { img: HackathonImage; label: string }) => (
    <div className="relative w-24 h-16 sm:w-28 sm:h-20 rounded-lg overflow-hidden border border-theme-stroke bg-theme-surface shrink-0">
      {img.url ? <img src={img.url} alt={label} className="w-full h-full object-cover" /> : <span className="text-xs text-theme-text-muted p-1">{label}</span>}
      <button
        type="button"
        aria-label={`Remove ${label}`}
        disabled={busy}
        onClick={() => void onRemoveImage(img.path)}
        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center"
      >
        <X size={14} />
      </button>
    </div>
  );

  return (
    <div className="space-y-3" data-testid="hackathon-submission-form">
      <IconInput icon={Type} value={form.name} maxLength={80} placeholder="Project name" onChange={(e) => set('name', e.target.value)} required />
      <IconInput icon={Quote} value={form.tagline} maxLength={140} placeholder="One-line tagline" onChange={(e) => set('tagline', e.target.value)} />
      <IconInput
        icon={AlignLeft}
        multiline
        rows={6}
        value={form.description}
        maxLength={10000}
        placeholder="What did you build, how does it work, and what's next? (Markdown works)"
        onChange={(e) => set('description', e.target.value)}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <IconInput icon={Github} value={form.repoUrl} maxLength={500} inputMode="url" placeholder="Code repo link (https://)" onChange={(e) => set('repoUrl', e.target.value)} />
        <IconInput icon={Video} value={form.demoVideoUrl} maxLength={500} inputMode="url" placeholder="Demo video link (YouTube, Loom...)" onChange={(e) => set('demoVideoUrl', e.target.value)} />
        <IconInput icon={Presentation} value={form.deckUrl} maxLength={500} inputMode="url" placeholder="Slides / deck link" onChange={(e) => set('deckUrl', e.target.value)} />
        <IconInput icon={Globe} value={form.liveUrl} maxLength={500} inputMode="url" placeholder="Live app link" onChange={(e) => set('liveUrl', e.target.value)} />
      </div>

      {tracks.length > 0 && (
        <div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Tracks">
            {tracks.map((t) => {
              const on = form.trackIds.includes(t.id);
              const full = !on && maxTracks > 1 && form.trackIds.length >= maxTracks;
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={on}
                  disabled={full}
                  onClick={() => toggleTrack(t.id)}
                  className={`px-3 py-1.5 rounded-full text-sm border transition-colors min-h-[36px] inline-flex items-center gap-1.5 disabled:opacity-40 ${
                    on ? 'border-theme-accent text-theme-accent font-medium bg-theme-surface' : 'border-theme-stroke text-theme-text-secondary hover:text-theme-text'
                  }`}
                >
                  {on && <Check size={14} />}
                  {t.name}
                </button>
              );
            })}
          </div>
          <Hint>{maxTracks === 1 ? 'Pick the track you are entering.' : `Pick up to ${maxTracks} tracks.`}</Hint>
        </div>
      )}

      {submission ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {submission.cover && <Thumb img={submission.cover} label="Cover image" />}
            {shots.map((s, i) => <Thumb key={s.path} img={s} label={`Screenshot ${i + 1}`} />)}
          </div>
          <div className="flex flex-wrap gap-2">
            <input ref={coverInput} type="file" accept={HACKATHON_IMAGE_TYPES.join(',')} className="hidden" onChange={(e) => { void pick('cover', e.target.files); e.target.value = ''; }} />
            <input ref={shotInput} type="file" multiple accept={HACKATHON_IMAGE_TYPES.join(',')} className="hidden" onChange={(e) => { void pick('screenshot', e.target.files); e.target.value = ''; }} />
            <button type="button" className="btn-secondary text-sm inline-flex items-center gap-2" disabled={busy || !!uploading} onClick={() => coverInput.current?.click()}>
              {uploading === 'cover' ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />}
              {submission.cover ? 'Replace cover' : 'Add cover image'}
            </button>
            <button
              type="button"
              className="btn-secondary text-sm inline-flex items-center gap-2"
              disabled={busy || !!uploading || shots.length >= HACKATHON_MAX_SCREENSHOTS}
              onClick={() => shotInput.current?.click()}
            >
              {uploading === 'screenshot' ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />}
              Add screenshots ({shots.length}/{HACKATHON_MAX_SCREENSHOTS})
            </button>
          </div>
          {imgError && <p className="text-xs text-theme-error" role="alert">{imgError}</p>}
        </div>
      ) : (
        <Hint>Save your project once to add a cover image and screenshots.</Hint>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" className="btn-primary inline-flex items-center gap-2" disabled={busy || !nameOk} onClick={() => void save()}>
          {busy && <Loader2 size={16} className="animate-spin" />}
          {submission ? 'Save changes' : 'Save draft'}
        </button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={onCancel}>Close</button>
      </div>
    </div>
  );
}
