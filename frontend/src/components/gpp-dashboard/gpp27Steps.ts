import {
  PartyPopper,
  Users,
  MapPin,
  Handshake,
  Pizza,
  DollarSign,
  ShieldCheck,
  Megaphone,
  Rocket,
  type LucideIcon,
} from 'lucide-react';
import type { Party, Guest } from '../../types';

/**
 * diavola-49271: GPP27 host dashboard — slice 3.
 *
 * Frontend-defined guided setup sequence for the GPP27 dashboard. This is
 * intentionally NOT backed by the DB-driven `checklist_defaults` / checklist
 * system the 2026 dashboard uses — GPP27 owns its own ordered, dependency-aware
 * step config so the flow can evolve independently of the live dashboard.
 *
 * Completion is derived from real party/guest state where a clean signal
 * exists; otherwise it's a host-toggled manual step persisted in localStorage
 * (see GPP27DashboardTab). Coach copy is stubbed here and expanded in slice 4.
 */

export interface Gpp27StepCtx {
  party: Party;
  guests: Guest[];
  /** Per-party manual completion flags, keyed by step id. */
  manualDone: Record<string, boolean>;
}

export interface Gpp27Step {
  /** Stable key, e.g. 'target', 'venue'. */
  id: string;
  /** i18n key under gpp27.steps.* */
  labelKey: string;
  icon: LucideIcon;
  /** Whether this step is complete, derived from ctx. */
  isDone: (ctx: Gpp27StepCtx) => boolean;
  /** true => completion is host-toggled (localStorage); no derivable signal. */
  manual?: boolean;
  /** Step ids that must be done before this one unlocks. */
  prereqs?: string[];
  /** i18n key for a one-line why/how (slice 4 expands the copy). */
  coachKey?: string;
}

/**
 * Helper for manual steps: a step is "done" purely from the localStorage map.
 */
const manualIsDone = (id: string) => (ctx: Gpp27StepCtx) => !!ctx.manualDone[id];

export const GPP27_STEPS: Gpp27Step[] = [
  {
    id: 'createEvent',
    labelKey: 'gpp27.steps.createEvent',
    icon: PartyPopper,
    // The party exists by definition if this dashboard is rendering.
    isDone: () => true,
    coachKey: 'gpp27.coach.createEvent',
  },
  {
    id: 'target',
    labelKey: 'gpp27.steps.target',
    icon: Users,
    isDone: ({ party }) => party.targetAttendance != null,
    coachKey: 'gpp27.coach.target',
  },
  {
    id: 'venue',
    labelKey: 'gpp27.steps.venue',
    icon: MapPin,
    isDone: ({ party }) => !!(party.address || party.venueName),
    prereqs: ['target'],
    coachKey: 'gpp27.coach.venue',
  },
  {
    id: 'team',
    labelKey: 'gpp27.steps.team',
    icon: Users,
    isDone: ({ party }) => (party.coHosts?.length ?? 0) > 0,
    coachKey: 'gpp27.coach.team',
  },
  {
    id: 'partners',
    labelKey: 'gpp27.steps.partners',
    icon: Handshake,
    // No clean signal — host marks it done; the action navigates to Partners.
    manual: true,
    isDone: manualIsDone('partners'),
    coachKey: 'gpp27.coach.partners',
  },
  {
    id: 'pizzeria',
    labelKey: 'gpp27.steps.pizzeria',
    icon: Pizza,
    isDone: ({ party }) => (party.selectedPizzerias?.length ?? 0) > 0,
    coachKey: 'gpp27.coach.pizzeria',
  },
  {
    id: 'budget',
    labelKey: 'gpp27.steps.budget',
    icon: DollarSign,
    manual: true,
    isDone: manualIsDone('budget'),
    coachKey: 'gpp27.coach.budget',
  },
  {
    id: 'funding',
    labelKey: 'gpp27.steps.funding',
    icon: ShieldCheck,
    isDone: ({ party }) => party.underbossStatus === 'approved',
    coachKey: 'gpp27.coach.funding',
  },
  {
    id: 'socials',
    labelKey: 'gpp27.steps.socials',
    icon: Megaphone,
    manual: true,
    isDone: manualIsDone('socials'),
    coachKey: 'gpp27.coach.socials',
  },
  {
    id: 'throwParty',
    labelKey: 'gpp27.steps.throwParty',
    icon: Rocket,
    manual: true,
    isDone: manualIsDone('throwParty'),
    prereqs: ['venue'],
    coachKey: 'gpp27.coach.throwParty',
  },
];

/** A step is unlocked iff every prereq id is itself done. */
export const stepUnlocked = (step: Gpp27Step, ctx: Gpp27StepCtx): boolean => {
  if (!step.prereqs?.length) return true;
  const byId = new Map(GPP27_STEPS.map((s) => [s.id, s]));
  return step.prereqs.every((pid) => {
    const prereq = byId.get(pid);
    return prereq ? prereq.isDone(ctx) : true;
  });
};

/** localStorage key for a manual step's completion flag. */
export const manualDoneKey = (partyId: string, stepId: string) =>
  `gpp27:done:${partyId}:${stepId}`;
