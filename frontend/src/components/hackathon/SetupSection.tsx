import { useEffect, useState } from 'react';
import { CalendarClock, Clock, Users, Layers, ScrollText, Loader2 } from 'lucide-react';
import { IconInput } from '../IconInput';
import { Checkbox } from '../Checkbox';
import {
  type HostHackathon,
  type HackathonSettingsInput,
  type HackathonEligibility,
  type GalleryVisibility,
  isoToLocalInput,
  localInputToIso,
} from '../../lib/hackathonApi';
import { ChoicePills, Hint, SectionCard, toInt } from './shared';

interface Props {
  hackathon: HostHackathon;
  saving: boolean;
  onSave: (body: HackathonSettingsInput) => Promise<boolean>;
  onDisable: () => void;
}

function formFrom(h: HostHackathon) {
  return {
    submissionsOpenAt: isoToLocalInput(h.submissionsOpenAt),
    submissionDeadline: isoToLocalInput(h.submissionDeadline),
    teamMinSize: String(h.teamMinSize),
    teamMaxSize: String(h.teamMaxSize),
    maxTracksPerSubmission: String(h.maxTracksPerSubmission),
    eligibility: h.eligibility,
    galleryVisibility: h.galleryVisibility,
    blindJudging: h.blindJudging,
    rules: h.rules ?? '',
  };
}

export function SetupSection({ hackathon, saving, onSave, onDisable }: Props) {
  const [form, setForm] = useState(() => formFrom(hackathon));
  useEffect(() => setForm(formFrom(hackathon)), [hackathon]);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const initial = formFrom(hackathon);
  const dirty = (Object.keys(form) as Array<keyof typeof form>).some((k) => form[k] !== initial[k]);
  const min = toInt(form.teamMinSize, 1, 1, 20);
  const max = toInt(form.teamMaxSize, 5, 1, 20);
  const sizeError = max < min ? 'The maximum team size must be at least the minimum.' : null;
  const open = localInputToIso(form.submissionsOpenAt);
  const deadline = localInputToIso(form.submissionDeadline);
  const dateError = open && deadline && deadline <= open ? 'The deadline must be after submissions open.' : null;

  const save = () => {
    if (sizeError || dateError) return;
    void onSave({
      submissionsOpenAt: open,
      submissionDeadline: deadline,
      teamMinSize: min,
      teamMaxSize: max,
      maxTracksPerSubmission: toInt(form.maxTracksPerSubmission, 1, 1, 20),
      eligibility: form.eligibility,
      galleryVisibility: form.galleryVisibility,
      blindJudging: form.blindJudging,
      rules: form.rules.trim() || null,
    });
  };

  return (
    <div className="space-y-4">
      <SectionCard title="Schedule" subtitle="Times are in your local time zone.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <IconInput
              icon={CalendarClock}
              type="datetime-local"
              aria-label="Submissions open"
              placeholder="Submissions open"
              value={form.submissionsOpenAt}
              onChange={(e) => set('submissionsOpenAt', e.target.value)}
            />
            <Hint>Submissions open (empty = as soon as teams form)</Hint>
          </div>
          <div>
            <IconInput
              icon={Clock}
              type="datetime-local"
              aria-label="Submission deadline"
              placeholder="Submission deadline"
              value={form.submissionDeadline}
              onChange={(e) => set('submissionDeadline', e.target.value)}
            />
            <Hint>Submission deadline (projects lock after this)</Hint>
          </div>
        </div>
        {dateError && <p className="text-xs text-theme-error mt-2">{dateError}</p>}
      </SectionCard>

      <SectionCard title="Teams and projects">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <IconInput icon={Users} type="number" min={1} max={20} aria-label="Minimum team size" placeholder="Min team size"
              value={form.teamMinSize} onChange={(e) => set('teamMinSize', e.target.value)} />
            <Hint>Minimum team size (1 = solo allowed)</Hint>
          </div>
          <div>
            <IconInput icon={Users} type="number" min={1} max={20} aria-label="Maximum team size" placeholder="Max team size"
              value={form.teamMaxSize} onChange={(e) => set('teamMaxSize', e.target.value)} />
            <Hint>Maximum team size (up to 20)</Hint>
          </div>
          <div>
            <IconInput icon={Layers} type="number" min={1} max={20} aria-label="Tracks per project" placeholder="Tracks per project"
              value={form.maxTracksPerSubmission} onChange={(e) => set('maxTracksPerSubmission', e.target.value)} />
            <Hint>Tracks each project can enter</Hint>
          </div>
        </div>
        {sizeError && <p className="text-xs text-theme-error mt-2">{sizeError}</p>}

        <div className="mt-4 space-y-2">
          <p className="text-sm text-theme-text-secondary">Who can submit</p>
          <ChoicePills<HackathonEligibility>
            ariaLabel="Who can submit"
            value={form.eligibility}
            onChange={(v) => set('eligibility', v)}
            options={[
              { value: 'registered', label: 'Approved RSVPs' },
              { value: 'checked_in', label: 'Checked-in guests only' },
            ]}
          />
        </div>

        <div className="mt-4 space-y-2">
          <p className="text-sm text-theme-text-secondary">Project gallery</p>
          <ChoicePills<GalleryVisibility>
            ariaLabel="Project gallery visibility"
            value={form.galleryVisibility}
            onChange={(v) => set('galleryVisibility', v)}
            options={[
              { value: 'after_reveal', label: 'Public after winners are revealed' },
              { value: 'after_deadline', label: 'Public after the deadline' },
              { value: 'hidden', label: 'Hidden' },
            ]}
          />
        </div>
      </SectionCard>

      <SectionCard title="Judging">
        <Checkbox
          checked={form.blindJudging}
          onChange={() => set('blindJudging', !form.blindJudging)}
          label="Blind judging"
        />
        <Hint>
          Judges don't see team names, members or project links until they save a score. This is best-effort: a
          project's name, description, screenshots and links can still identify a team.
        </Hint>
      </SectionCard>

      <SectionCard title="Rules" subtitle="Shown on the event page once you publish. Markdown is supported.">
        <IconInput
          icon={ScrollText}
          multiline
          rows={8}
          aria-label="Rules"
          placeholder="Rules: eligibility, code of conduct, what counts as new work, judging criteria..."
          value={form.rules}
          maxLength={20000}
          onChange={(e) => set('rules', e.target.value)}
        />
      </SectionCard>

      <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
        <button type="button" onClick={onDisable} className="text-sm text-theme-text-muted hover:text-theme-text underline self-start">
          Disable the hackathon
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving || !!sizeError || !!dateError}
          className="btn-primary flex items-center justify-center gap-2"
        >
          {saving && <Loader2 size={16} className="animate-spin" />}
          Save setup
        </button>
      </div>
    </div>
  );
}
