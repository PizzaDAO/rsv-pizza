/**
 * arancini-58492: Natural-language Event Assistant service.
 *
 * Loads the current party, summarizes it for gpt-4o, and asks the model (via a
 * FORCED `propose_event_changes` tool call — mirrors the OCR JSON pattern) to
 * propose a structured patch of editable fields. The patch is validated +
 * clamped by `eventEditSchema`, diffed against the current values, and returned
 * for HOST CONFIRMATION. This service NEVER writes to the DB — accepted changes
 * are applied by the frontend through the existing PATCH /api/parties/:id path.
 *
 * Date handling: the catalog exposes a friendly `event_datetime`; here we
 * resolve it to a PATCH-ready `date` (UTC ISO) + recomputed `duration` using
 * the event timezone + today's date, so relative phrases ("next Friday at 6pm")
 * become absolute, tz-correct values the host can confirm.
 */

import { prisma } from '../config/database.js';
import { getOpenAI } from '../lib/openai.js';
import {
  buildToolSchema,
  validatePatch,
  diffPatch,
  getCatalog,
  type RequesterRole,
  type ProposedChange,
} from '../lib/eventEditSchema.js';

const MAX_INSTRUCTION_LEN = 2000;
const MAX_HISTORY_TURNS = 8; // host+assistant messages retained for follow-ups

export interface AssistantHistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface EventAssistantResult {
  assistantMessage: string;
  clarifyingQuestion?: string;
  proposedChanges: Array<ProposedChange & { reason?: string }>;
}

/* --------------------------- current snapshot ----------------------------- */

/**
 * Build a snake_case snapshot of the current party limited to catalog keys, so
 * `diffPatch` can compare apples to apples. Decimal columns are coerced to
 * numbers; the synthetic `event_datetime` mirrors the stored `date`.
 */
function buildCurrentSnapshot(party: any, role: RequesterRole): Record<string, unknown> {
  const num = (v: any): number | null =>
    v === null || v === undefined ? null : typeof v === 'object' && 'toNumber' in v ? v.toNumber() : Number(v);

  const snap: Record<string, unknown> = {
    name: party.name ?? null,
    event_datetime: party.date ? new Date(party.date).toISOString() : null,
    duration: party.duration ?? null,
    timezone: party.timezone ?? null,
    description: party.description ?? null,
    pizza_style: party.pizzaStyle ?? null,
    address: party.address ?? null,
    venue_name: party.venueName ?? null,
    city: party.city ?? null,
    country: party.country ?? null,
    max_guests: party.maxGuests ?? null,
    expected_guests: party.expectedGuests ?? null,
    estimated_attendance: party.estimatedAttendance ?? null,
    hide_guests: party.hideGuests ?? false,
    require_approval: party.requireApproval ?? false,
    show_toppings_on_rsvp: party.showToppingsOnRsvp ?? false,
    available_beverages: party.availableBeverages ?? [],
    available_toppings: party.availableToppings ?? [],
    available_dietary_options: party.availableDietaryOptions ?? [],
    password: party.password ?? null,
    custom_url: party.customUrl ?? null,
    event_tags: party.eventTags ?? [],
    donation_enabled: party.donationEnabled ?? false,
    donation_goal: num(party.donationGoal),
    donation_message: party.donationMessage ?? null,
    donation_recipient: party.donationRecipient ?? null,
    donation_recipient_url: party.donationRecipientUrl ?? null,
    donation_eth_address: party.donationEthAddress ?? null,
    donation_amounts_public: party.donationAmountsPublic ?? true,
    suggested_amounts: Array.isArray(party.suggestedAmounts) ? party.suggestedAmounts : [],
    share_to_unlock: party.shareToUnlock ?? false,
    share_tweet_text: party.shareTweetText ?? null,
    fundraising_goal: num(party.fundraisingGoal),
    music_enabled: party.musicEnabled ?? false,
    music_notes: party.musicNotes ?? null,
    photo_moderation: party.photoModeration ?? true,
    nft_enabled: party.nftEnabled ?? false,
    nft_chain: party.nftChain ?? null,
    luma_url: party.lumaUrl ?? null,
    meetup_url: party.meetupUrl ?? null,
    eventbrite_url: party.eventbriteUrl ?? null,
    external_links: Array.isArray(party.externalLinks) ? party.externalLinks : [],
    telegram_group: party.telegramGroup ?? null,
    turtle_roles_enabled: party.turtleRolesEnabled ?? false,
    survey_enabled: party.surveyEnabled ?? true,
    reminders_enabled: party.remindersEnabled ?? true,
    wifi_info: party.wifiInfo ?? null,
    parking_notes: party.parkingNotes ?? null,
    region: party.region ?? null,
    venue_report_title: party.venueReportTitle ?? null,
    venue_report_notes: party.venueReportNotes ?? null,
    co_hosts: Array.isArray(party.coHosts) ? party.coHosts : [],
    reimbursement_cap_usd: num(party.reimbursementCapUsd),
    tax_form_required: party.taxFormRequired ?? false,
  };

  // Keep only the keys visible to this role's catalog so admin-only snapshot
  // values can't leak into a non-admin diff.
  const allowed = new Set(getCatalog(role).map((f) => f.key));
  const filtered: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(snap)) {
    if (allowed.has(k)) filtered[k] = v;
  }
  return filtered;
}

/* ---------------------------- datetime resolve ---------------------------- */

/**
 * Resolve the model's friendly `event_datetime` string into a PATCH-ready UTC
 * ISO `date`, interpreting wall-clock components in the event timezone. We give
 * the model an explicit "YYYY-MM-DD HH:MM" (already-resolved by the model, no
 * relative phrasing expected since we supplied today's date), but we also
 * tolerate a full ISO string. Returns null if we can't parse it (the field is
 * then dropped so we never propose a bad date).
 */
function resolveEventDatetimeToUtcIso(input: string, timezone: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  // If it's already a valid ISO/parseable absolute instant with offset/Z, trust it.
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  // Expect "YYYY-MM-DD HH:MM" or "YYYY-MM-DDTHH:MM" wall-clock in the event tz.
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) {
    const fallback = new Date(raw);
    return Number.isNaN(fallback.getTime()) ? null : fallback.toISOString();
  }
  const [, y, mo, d, h, mi] = m;
  return wallClockInTzToUtcIso(+y, +mo, +d, +h, +mi, timezone);
}

/**
 * Convert wall-clock components (interpreted in `timezone`) to a UTC ISO string.
 * Mirrors the offset-diffing approach used by the frontend
 * `parseDateTimeInTimezone`, implemented with Intl so no extra deps are needed.
 */
function wallClockInTzToUtcIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): string | null {
  try {
    // Treat the components as if they were UTC, then find the tz offset at that
    // instant and subtract it.
    const asUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
    const offsetMs = tzOffsetMsAt(asUtc, timezone);
    const utc = asUtc - offsetMs;
    const d = new Date(utc);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

/** Offset (ms) of `timezone` from UTC at the given instant. Positive = ahead of UTC. */
function tzOffsetMsAt(instantMs: number, timezone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date(instantMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asIfUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') === 24 ? 0 : get('hour'),
    get('minute'),
    get('second'),
  );
  return asIfUtc - instantMs;
}

/* ------------------------------ prompt build ------------------------------ */

function buildSystemPrompt(snapshot: Record<string, unknown>, timezone: string, role: RequesterRole): string {
  const today = new Date();
  const todayInTz = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(today);

  return [
    'You are the RSV.Pizza Event Assistant. A host gives you a plain-English instruction and you propose a structured set of changes to their event by calling the `propose_event_changes` function.',
    '',
    'RULES:',
    '- Only propose fields the host explicitly asked to change. Do NOT touch anything else.',
    '- For list fields you MUST return the COMPLETE new array (the full resulting list), not a delta.',
    '- For co_hosts you may ONLY remove or reorder existing entries — NEVER add a new co-host.',
    '- For dates/times: resolve any relative phrasing ("next Friday", "tomorrow at 6pm") to an absolute local datetime in the event timezone, formatted as "YYYY-MM-DD HH:MM". Do not include a timezone offset; the value is interpreted in the event timezone.',
    '- Suggested donation amounts are in CENTS (500 = $5.00).',
    '- If the instruction is ambiguous and you cannot safely propose changes, set `clarifying_question` and leave `changes` empty.',
    role === 'admin' ? '- You are assisting an ADMIN; admin-only fields are available.' : '- You are assisting a HOST; only host-editable fields are available.',
    '',
    `Event timezone: ${timezone}`,
    `Today (in event timezone): ${todayInTz}`,
    '',
    'Current event values (snake_case keys, same keys you propose):',
    JSON.stringify(snapshot, null, 2),
  ].join('\n');
}

/* -------------------------------- service --------------------------------- */

export async function runEventAssistant(params: {
  partyId: string;
  instruction: string;
  role: RequesterRole;
  conversationHistory?: AssistantHistoryTurn[];
}): Promise<EventAssistantResult> {
  const { partyId, role } = params;
  const instruction = (params.instruction ?? '').trim().slice(0, MAX_INSTRUCTION_LEN);

  if (!instruction) {
    return { assistantMessage: 'Tell me what you would like to change about your event.', proposedChanges: [] };
  }

  const party = await prisma.party.findUnique({ where: { id: partyId } });
  if (!party) {
    return { assistantMessage: 'Event not found.', proposedChanges: [] };
  }

  const timezone = (party as any).timezone || 'UTC';
  const snapshot = buildCurrentSnapshot(party, role);

  const history = (params.conversationHistory ?? [])
    .filter((t) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string')
    .slice(-MAX_HISTORY_TURNS)
    .map((t) => ({ role: t.role, content: t.content.slice(0, MAX_INSTRUCTION_LEN) }));

  const tool = buildToolSchema(role);

  const response = await getOpenAI().chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: buildSystemPrompt(snapshot, timezone, role) },
      ...history,
      { role: 'user', content: instruction },
    ],
    tools: [tool],
    tool_choice: { type: 'function', function: { name: 'propose_event_changes' } },
    max_tokens: 1500,
  });

  const toolCall = response.choices[0]?.message?.tool_calls?.[0];
  // The SDK tool-call type is a union (function | custom); narrow to function.
  if (!toolCall || toolCall.type !== 'function' || toolCall.function.name !== 'propose_event_changes') {
    return {
      assistantMessage:
        "I couldn't turn that into a concrete change. Try rephrasing, e.g. \"change the venue name to The Pizza Loft\".",
      proposedChanges: [],
    };
  }

  let args: any;
  try {
    args = JSON.parse(toolCall.function.arguments || '{}');
  } catch {
    return {
      assistantMessage: 'Sorry — I had trouble formatting that change. Please try again.',
      proposedChanges: [],
    };
  }

  const assistantMessage: string =
    typeof args.assistant_message === 'string' && args.assistant_message.trim()
      ? args.assistant_message.trim()
      : 'Here are the changes I propose.';
  const clarifyingQuestion: string | undefined =
    typeof args.clarifying_question === 'string' && args.clarifying_question.trim()
      ? args.clarifying_question.trim()
      : undefined;

  // Validate + clamp the raw changes, then resolve the synthetic datetime.
  const validated = validatePatch(args.changes, role);

  if ('event_datetime' in validated) {
    const iso = resolveEventDatetimeToUtcIso(String(validated.event_datetime), timezone);
    delete validated.event_datetime;
    if (iso) {
      validated.date = iso;
      // Recompute duration only if there was a prior end implied by current
      // date+duration; otherwise leave duration to whatever the model proposed
      // (or unchanged). We DON'T fabricate a duration here — the host confirms
      // the start; duration changes are a separate, explicit proposal.
    }
  }

  // Build the snapshot used for diffing. For `date` we diff against the current
  // stored ISO; map snapshot's event_datetime → date so the diff is meaningful.
  const diffCurrent: Record<string, unknown> = { ...snapshot };
  if ('event_datetime' in diffCurrent) {
    diffCurrent.date = diffCurrent.event_datetime;
    delete diffCurrent.event_datetime;
  }

  // Diff using the union catalog (host/admin) — but `date`/`duration` aren't
  // catalog keys, so diff/format them inline.
  const catalogDiff = diffPatch(diffCurrent, omitKeys(validated, ['date', 'duration']), role);

  const proposedChanges: Array<ProposedChange & { reason?: string }> = catalogDiff.map((c) => ({ ...c }));

  // Hand-roll the date / duration rows (not catalog keys, need tz-aware display).
  if ('date' in validated && !valuesShallowEqual(diffCurrent.date, validated.date)) {
    proposedChanges.push({
      key: 'date',
      value: validated.date,
      label: 'Start date & time',
      currentDisplay: formatInTz(diffCurrent.date as string | null, timezone),
      proposedDisplay: formatInTz(validated.date as string | null, timezone),
    });
  }
  if ('duration' in validated && !valuesShallowEqual(snapshot.duration, validated.duration)) {
    proposedChanges.push({
      key: 'duration',
      value: validated.duration,
      label: 'Duration (hours)',
      currentDisplay: snapshot.duration == null ? '(none)' : `${snapshot.duration}`,
      proposedDisplay: validated.duration == null ? '(none)' : `${validated.duration}`,
    });
  }

  return { assistantMessage, clarifyingQuestion, proposedChanges };
}

/* -------------------------------- helpers --------------------------------- */

function omitKeys(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!keys.includes(k)) out[k] = v;
  }
  return out;
}

function valuesShallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const aEmpty = a === null || a === undefined || a === '';
  const bEmpty = b === null || b === undefined || b === '';
  return aEmpty && bEmpty;
}

function formatInTz(iso: string | null, timezone: string): string {
  if (!iso) return '(not set)';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '(not set)';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(d);
  } catch {
    return d.toISOString();
  }
}
