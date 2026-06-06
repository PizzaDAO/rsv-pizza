/**
 * arancini-58492: Event-edit FIELD CATALOG — the single source of truth for the
 * natural-language Event Assistant.
 *
 * The LLM is shown a tool schema derived from this catalog and proposes a
 * structured patch. The patch is NEVER written to the DB directly: the service
 * validates + clamps it here, diffs it for the host's confirmation, and the
 * accepted subset is applied through the EXISTING `PATCH /api/parties/:id`
 * trusted path (auth, field-level authorization, validation, whitelists,
 * webhooks). This module therefore does TWO jobs:
 *   1. Describe each editable field to gpt-4o (label + description + type).
 *   2. Validate / coerce / clamp whatever the model returns before it ever
 *      reaches a human, dropping unknown keys.
 *
 * KEY INVARIANT (enforced by eventEditSchema.test.ts): every catalog `key` must
 * be a member of the backend PATCH whitelist (the camelCase destructure in
 * `party.routes.ts`, mapped here to its snake_case form). If you add a field to
 * the catalog that the PATCH handler doesn't accept, accepted changes would
 * silently no-op — the drift guard fails the build instead.
 *
 * NOTE on dates: the catalog exposes a single friendly `event_datetime` field
 * (a human-readable start datetime). The SERVICE resolves it to the PATCH-ready
 * `date` (UTC ISO) + recomputed `duration` using the event timezone + today's
 * date. `event_datetime` is therefore NOT itself a PATCH key — it is excluded
 * from the drift guard via `resolvesTo`.
 */

export type CatalogType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'string[]'
  | 'enum'
  | 'datetime'
  | 'object[]';

export type RequesterRole = 'host' | 'admin';

export interface CatalogField {
  /** snake_case key. Must match the updateParty / PATCH whitelist UNLESS `resolvesTo` is set. */
  key: string;
  type: CatalogType;
  label: string;
  description: string;
  /** When true, omitted from the tool schema for non-admin requesters and dropped from their patches. */
  adminOnly?: boolean;
  /** Allowed string values for `enum` fields. */
  enumValues?: readonly string[];
  /**
   * Synthetic catalog fields (e.g. `event_datetime`) that don't map 1:1 to a
   * PATCH key. The drift guard skips keys with `resolvesTo`. The service is
   * responsible for translating the value into the listed PATCH key(s).
   */
  resolvesTo?: readonly string[];
  /** Human-readable rendering of a value for the diff (old → new). */
  format: (value: unknown) => string;
}

/* ----------------------------- format helpers ----------------------------- */

function fmtString(v: unknown): string {
  if (v === null || v === undefined || v === '') return '(empty)';
  return String(v);
}

function fmtNumber(v: unknown): string {
  if (v === null || v === undefined || v === '') return '(none)';
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : '(none)';
}

function fmtBoolean(v: unknown): string {
  return v === true ? 'On' : 'Off';
}

function fmtStringArray(v: unknown): string {
  if (!Array.isArray(v) || v.length === 0) return '(none)';
  return v.map((x) => String(x)).join(', ');
}

function fmtCentsArray(v: unknown): string {
  if (!Array.isArray(v) || v.length === 0) return '(none)';
  return v
    .map((x) => {
      const n = Number(x);
      return Number.isFinite(n) ? `$${(n / 100).toFixed(2)}` : String(x);
    })
    .join(', ');
}

function fmtExternalLinks(v: unknown): string {
  if (!Array.isArray(v) || v.length === 0) return '(none)';
  return v
    .map((l: any) =>
      l && typeof l === 'object' ? `${l.label ?? ''} (${l.url ?? ''})` : String(l),
    )
    .join(', ');
}

function fmtCoHosts(v: unknown): string {
  if (!Array.isArray(v) || v.length === 0) return '(none)';
  return v
    .map((h: any) => (h && typeof h === 'object' ? h.name || h.email || '(host)' : String(h)))
    .join(', ');
}

function fmtDatetime(v: unknown): string {
  if (v === null || v === undefined || v === '') return '(not set)';
  return String(v);
}

/* ------------------------------ the catalog ------------------------------- */

export const EVENT_EDIT_CATALOG: readonly CatalogField[] = [
  {
    key: 'name',
    type: 'string',
    label: 'Event name',
    description: '',
    format: fmtString,
  },
  {
    key: 'event_datetime',
    type: 'datetime',
    label: 'Start date & time',
    description:
      'Start datetime. Resolve relative phrasing ("next Friday at 6pm") to "YYYY-MM-DD HH:MM" wall-clock in the event timezone — no offset.',
    resolvesTo: ['date', 'duration'],
    format: fmtDatetime,
  },
  {
    key: 'duration',
    type: 'number',
    label: 'Duration (hours)',
    description: 'Length in hours.',
    format: fmtNumber,
  },
  {
    key: 'timezone',
    type: 'string',
    label: 'Timezone',
    description: '',
    format: fmtString,
  },
  {
    key: 'description',
    type: 'string',
    label: 'Description',
    description: '',
    format: fmtString,
  },
  {
    key: 'pizza_style',
    type: 'enum',
    label: 'Pizza style',
    description: 'Default pizza style.',
    enumValues: ['new-york', 'neapolitan', 'chicago', 'detroit', 'sicilian', 'california'] as const,
    format: fmtString,
  },
  {
    key: 'address',
    type: 'string',
    label: 'Address',
    description: '',
    format: fmtString,
  },
  {
    key: 'venue_name',
    type: 'string',
    label: 'Venue name',
    description: '',
    format: fmtString,
  },
  {
    key: 'city',
    type: 'string',
    label: 'City',
    description: '',
    format: fmtString,
  },
  {
    key: 'country',
    type: 'string',
    label: 'Country',
    description: 'Full English name, e.g. "United States".',
    format: fmtString,
  },
  {
    key: 'max_guests',
    type: 'number',
    label: 'Max guests',
    description: 'Hard RSVP capacity cap; null/0 = unlimited.',
    format: fmtNumber,
  },
  {
    key: 'expected_guests',
    type: 'number',
    label: 'Expected guests',
    description: "Host's own headcount estimate (not a cap).",
    format: fmtNumber,
  },
  {
    key: 'estimated_attendance',
    type: 'number',
    label: 'Estimated attendance',
    description: 'Budgeting attendance estimate (drives spend).',
    format: fmtNumber,
  },
  {
    key: 'hide_guests',
    type: 'boolean',
    label: 'Hide guest list',
    description: '',
    format: fmtBoolean,
  },
  {
    key: 'require_approval',
    type: 'boolean',
    label: 'Require RSVP approval',
    description: '',
    format: fmtBoolean,
  },
  {
    key: 'show_toppings_on_rsvp',
    type: 'boolean',
    label: 'Show toppings on RSVP',
    description: 'When on, guests pick toppings during RSVP.',
    format: fmtBoolean,
  },
  {
    key: 'available_beverages',
    type: 'string[]',
    label: 'Available beverages',
    description: 'Beverage options guests can choose.',
    format: fmtStringArray,
  },
  {
    key: 'available_toppings',
    type: 'string[]',
    label: 'Available toppings',
    description: 'Pizza toppings guests can choose.',
    format: fmtStringArray,
  },
  {
    key: 'available_dietary_options',
    type: 'string[]',
    label: 'Dietary options',
    description: 'Dietary options, e.g. vegan, gluten-free.',
    format: fmtStringArray,
  },
  {
    key: 'password',
    type: 'string',
    label: 'Event password',
    description: '',
    format: fmtString,
  },
  {
    key: 'custom_url',
    type: 'string',
    label: 'Custom URL slug',
    description: 'rsv.pizza/<slug> path: lowercase, numbers, hyphens, 3–50 chars.',
    format: fmtString,
  },
  {
    key: 'event_tags',
    type: 'string[]',
    label: 'Event tags',
    description: 'Filtering/grouping tags. Never add or remove the "go" tag.',
    format: fmtStringArray,
  },
  {
    key: 'donation_enabled',
    type: 'boolean',
    label: 'Donations enabled',
    description: '',
    format: fmtBoolean,
  },
  {
    key: 'donation_goal',
    type: 'number',
    label: 'Donation goal',
    description: 'Donation-widget goal, in dollars.',
    format: fmtNumber,
  },
  {
    key: 'donation_message',
    type: 'string',
    label: 'Donation message',
    description: '',
    format: fmtString,
  },
  {
    key: 'donation_recipient',
    type: 'string',
    label: 'Donation recipient',
    description: '',
    format: fmtString,
  },
  {
    key: 'donation_recipient_url',
    type: 'string',
    label: 'Donation recipient URL',
    description: '',
    format: fmtString,
  },
  {
    key: 'donation_eth_address',
    type: 'string',
    label: 'Donation ETH address',
    description: '',
    format: fmtString,
  },
  {
    key: 'donation_amounts_public',
    type: 'boolean',
    label: 'Donation amounts public',
    description: '',
    format: fmtBoolean,
  },
  {
    key: 'suggested_amounts',
    type: 'number[]' as CatalogType, // stored as cents; handled as a numeric array
    label: 'Suggested donation amounts',
    description: 'Preset donation buttons, in CENTS (500 = $5.00).',
    format: fmtCentsArray,
  },
  {
    key: 'share_to_unlock',
    type: 'boolean',
    label: 'Share to unlock',
    description: '',
    format: fmtBoolean,
  },
  {
    key: 'share_tweet_text',
    type: 'string',
    label: 'Share tweet text',
    description: 'Pre-filled share-to-unlock tweet text.',
    format: fmtString,
  },
  {
    key: 'fundraising_goal',
    type: 'number',
    label: 'Fundraising goal',
    description: 'Overall fundraising goal, in dollars (separate from donation goal).',
    format: fmtNumber,
  },
  {
    key: 'music_enabled',
    type: 'boolean',
    label: 'Music enabled',
    description: '',
    format: fmtBoolean,
  },
  {
    key: 'music_notes',
    type: 'string',
    label: 'Music notes',
    description: '',
    format: fmtString,
  },
  {
    key: 'photo_moderation',
    type: 'boolean',
    label: 'Photo moderation',
    description: '',
    format: fmtBoolean,
  },
  {
    key: 'nft_enabled',
    type: 'boolean',
    label: 'NFT enabled',
    description: '',
    format: fmtBoolean,
  },
  {
    key: 'nft_chain',
    type: 'string',
    label: 'NFT chain',
    description: '',
    format: fmtString,
  },
  {
    key: 'luma_url',
    type: 'string',
    label: 'Luma URL',
    description: '',
    format: fmtString,
  },
  {
    key: 'meetup_url',
    type: 'string',
    label: 'Meetup URL',
    description: '',
    format: fmtString,
  },
  {
    key: 'eventbrite_url',
    type: 'string',
    label: 'Eventbrite URL',
    description: '',
    format: fmtString,
  },
  {
    key: 'external_links',
    type: 'object[]',
    label: 'External links',
    description: 'Custom event-page links, { label, url } (max 10).',
    format: fmtExternalLinks,
  },
  {
    key: 'telegram_group',
    type: 'string',
    label: 'Telegram group link',
    description: '',
    format: fmtString,
  },
  {
    key: 'turtle_roles_enabled',
    type: 'boolean',
    label: 'Turtle roles enabled',
    description: '',
    format: fmtBoolean,
  },
  {
    key: 'survey_enabled',
    type: 'boolean',
    label: 'Post-event survey enabled',
    description: '',
    format: fmtBoolean,
  },
  {
    key: 'reminders_enabled',
    type: 'boolean',
    label: 'Reminders enabled',
    description: '',
    format: fmtBoolean,
  },
  {
    key: 'wifi_info',
    type: 'string',
    label: 'WiFi info',
    description: '',
    format: fmtString,
  },
  {
    key: 'parking_notes',
    type: 'string',
    label: 'Parking notes',
    description: '',
    format: fmtString,
  },
  {
    key: 'region',
    type: 'string',
    label: 'Region',
    description: 'GPP region slug.',
    format: fmtString,
  },
  {
    key: 'venue_report_title',
    type: 'string',
    label: 'Venue report title',
    description: '',
    format: fmtString,
  },
  {
    key: 'venue_report_notes',
    type: 'string',
    label: 'Venue report notes',
    description: '',
    format: fmtString,
  },
  {
    key: 'co_hosts',
    type: 'object[]',
    label: 'Co-hosts',
    description: 'Co-host list. ONLY remove or reorder existing co-hosts — NEVER add one.',
    format: fmtCoHosts,
  },
  /* ----------------------------- admin-only ------------------------------ */
  {
    key: 'reimbursement_cap_usd',
    type: 'number',
    label: 'Reimbursement cap (USD)',
    description: 'Per-event reimbursement cap in USD.',
    adminOnly: true,
    format: fmtNumber,
  },
  {
    key: 'tax_form_required',
    type: 'boolean',
    label: 'Tax form required',
    description: 'When on, a tax form is required before payout.',
    adminOnly: true,
    format: fmtBoolean,
  },
] as const;

/* --------------------------------- API ------------------------------------ */

export function getCatalog(role: RequesterRole): CatalogField[] {
  return EVENT_EDIT_CATALOG.filter((f) => role === 'admin' || !f.adminOnly);
}

export function getCatalogField(key: string, role: RequesterRole): CatalogField | undefined {
  return getCatalog(role).find((f) => f.key === key);
}

/**
 * The set of camelCase keys accepted by the PATCH `/api/parties/:id` handler.
 * Source of truth: the destructure at the top of the PATCH handler in
 * `backend/src/routes/party.routes.ts`. Kept here in snake_case (the form the
 * frontend `updateParty` whitelist uses, and the form our catalog keys use) so
 * the drift guard can assert membership directly.
 *
 * `event_datetime` (synthetic) is intentionally NOT here — it resolves to
 * `date` + `duration`, both of which ARE here.
 */
export const PATCH_WHITELIST_SNAKE: ReadonlySet<string> = new Set([
  'name',
  'date',
  'end_time',
  'duration',
  'pizza_style', // destructured as `pizzaStyle` in the PATCH handler
  'address',
  'latitude',
  'longitude',
  'country',
  'city',
  'place_id',
  'venue_name',
  'max_guests',
  'available_beverages',
  'available_toppings',
  'available_dietary_options',
  'show_toppings_on_rsvp',
  'password',
  'event_image_url',
  'description',
  'custom_url',
  'timezone',
  'hide_guests',
  'require_approval',
  'co_hosts',
  'selected_pizzerias',
  'expected_guests',
  'estimated_attendance',
  'event_tags',
  'donation_enabled',
  'donation_goal',
  'donation_message',
  'suggested_amounts',
  'donation_recipient',
  'donation_recipient_url',
  'donation_eth_address',
  'donation_amounts_public',
  'share_to_unlock',
  'share_tweet_text',
  'fundraising_goal',
  'music_enabled',
  'music_notes',
  'photo_moderation',
  'nft_enabled',
  'nft_chain',
  'pinned_apps',
  'region',
  'venue_report_title',
  'venue_report_notes',
  'flyer_generated_at',
  'flyer_config',
  'poster_image_url',
  'poster_generated_at',
  'rollup_image_url',
  'rollup_generated_at',
  'hidden_gpp_photos',
  'extra_gpp_photos',
  'luma_url',
  'meetup_url',
  'eventbrite_url',
  'external_links',
  'quiz_enabled',
  'survey_enabled',
  'telegram_group',
  'host_telegram_link_token',
  'turtle_roles_enabled',
  'reminders_enabled',
  'wifi_info',
  'parking_notes',
  'reimbursement_cap_usd',
  'tax_form_required',
  'host_goals',
  'cancellation_reason',
]);

/**
 * Build the OpenAI function (tool) JSON schema for `propose_event_changes`.
 * Admin-only fields are omitted for non-admin requesters so they're never
 * proposed in the first place (defense in depth — `validatePatch` also drops
 * them).
 */
export function buildToolSchema(role: RequesterRole): {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
} {
  const changeProps: Record<string, unknown> = {};
  for (const f of getCatalog(role)) {
    changeProps[f.key] = catalogFieldToJsonSchema(f);
  }

  return {
    type: 'function',
    function: {
      name: 'propose_event_changes',
      description:
        'Propose a structured set of changes to the event. Only include fields the host actually asked to change. ' +
        'Leave everything else out. For list fields (beverages, toppings, dietary options, tags, suggested amounts, ' +
        'external links, co-hosts) you MUST return the COMPLETE new array, not a delta. Never add co-hosts. ' +
        'Use `clarifying_question` instead of guessing when the instruction is ambiguous.',
      parameters: {
        type: 'object',
        properties: {
          assistant_message: {
            type: 'string',
            description: 'A short, friendly summary of what you are proposing (1–2 sentences).',
          },
          clarifying_question: {
            type: 'string',
            description:
              'If the instruction is ambiguous and you cannot safely propose changes, ask ONE concise clarifying question here and leave `changes` empty.',
          },
          changes: {
            type: 'object',
            description: 'The proposed field changes. Omit any field that should not change.',
            properties: changeProps,
            additionalProperties: false,
          },
        },
        required: ['assistant_message'],
        additionalProperties: false,
      },
    },
  };
}

function catalogFieldToJsonSchema(f: CatalogField): Record<string, unknown> {
  // Only emit a `description` when the field actually carries one. Self-evident
  // fields use an empty description (their key + label already say enough), and
  // omitting the key entirely trims the dominant tool-schema token cost.
  const base: Record<string, unknown> = f.description ? { description: f.description } : {};
  switch (f.type) {
    case 'string':
      return { ...base, type: 'string' };
    case 'number':
      return { ...base, type: 'number' };
    case 'boolean':
      return { ...base, type: 'boolean' };
    case 'enum':
      return { ...base, type: 'string', enum: f.enumValues ?? [] };
    case 'datetime':
      return { ...base, type: 'string' };
    case 'string[]':
      return { ...base, type: 'array', items: { type: 'string' } };
    case ('number[]' as CatalogType):
      return { ...base, type: 'array', items: { type: 'number' } };
    case 'object[]':
      if (f.key === 'external_links') {
        return {
          ...base,
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              url: { type: 'string' },
            },
            required: ['label', 'url'],
            additionalProperties: false,
          },
        };
      }
      if (f.key === 'co_hosts') {
        // We don't let the model invent co-host objects; it returns the
        // remaining/reordered list as opaque objects (validated server-side
        // against the existing co_hosts). Permit object items generically.
        return {
          ...base,
          type: 'array',
          items: { type: 'object', additionalProperties: true },
        };
      }
      return { ...base, type: 'array', items: { type: 'object', additionalProperties: true } };
    default:
      return { ...base, type: 'string' };
  }
}

/**
 * Validate + coerce + clamp a raw `changes` object from the model into a typed
 * patch keyed by catalog `key`. Unknown keys and admin-only keys (for
 * non-admins) are dropped. Values that fail coercion are dropped (never thrown)
 * so one bad field doesn't sink the whole proposal.
 *
 * NOTE: `event_datetime` stays as a friendly string here — the SERVICE resolves
 * it into `date` + `duration` before diffing/applying.
 */
export function validatePatch(
  raw: unknown,
  role: RequesterRole,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const obj = raw as Record<string, unknown>;

  for (const f of getCatalog(role)) {
    if (!(f.key in obj)) continue;
    const v = obj[f.key];
    const coerced = coerceValue(f, v);
    if (coerced !== undefined) {
      out[f.key] = coerced;
    }
  }
  return out;
}

function coerceValue(f: CatalogField, v: unknown): unknown {
  switch (f.type) {
    case 'string':
    case 'datetime':
      if (v === null) return null;
      if (typeof v === 'string') return v;
      if (typeof v === 'number' || typeof v === 'boolean') return String(v);
      return undefined;
    case 'number': {
      if (v === null || v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    }
    case 'boolean':
      if (typeof v === 'boolean') return v;
      if (v === 'true') return true;
      if (v === 'false') return false;
      return undefined;
    case 'enum':
      if (typeof v === 'string' && (f.enumValues ?? []).includes(v)) return v;
      return undefined;
    case 'string[]':
      if (!Array.isArray(v)) return undefined;
      return v.filter((x) => typeof x === 'string').map((x) => (x as string).trim()).filter(Boolean);
    case ('number[]' as CatalogType): {
      if (!Array.isArray(v)) return undefined;
      const nums = v
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x) && x >= 0)
        .map((x) => Math.round(x));
      return nums;
    }
    case 'object[]':
      if (!Array.isArray(v)) return undefined;
      if (f.key === 'external_links') {
        const links = v
          .filter((l: any) => l && typeof l === 'object' && typeof l.label === 'string' && typeof l.url === 'string')
          .map((l: any) => ({ label: String(l.label), url: String(l.url) }))
          .slice(0, 10);
        return links;
      }
      // co_hosts handled by the service against existing data; pass objects through.
      return v.filter((x: any) => x && typeof x === 'object');
    default:
      return undefined;
  }
}

export interface ProposedChange {
  key: string;
  value: unknown;
  label: string;
  currentDisplay: string;
  proposedDisplay: string;
}

/**
 * Diff a validated proposed patch against the current (snake_case keyed) party
 * snapshot. Returns only fields that actually changed, with formatted
 * old/new display strings. Keys not in the catalog for `role` are skipped.
 */
export function diffPatch(
  current: Record<string, unknown>,
  proposed: Record<string, unknown>,
  role: RequesterRole,
): ProposedChange[] {
  const changes: ProposedChange[] = [];
  for (const [key, value] of Object.entries(proposed)) {
    const field = getCatalogField(key, role);
    if (!field) continue;
    const curr = current[key];
    if (valuesEqual(curr, value)) continue;
    changes.push({
      key,
      value,
      label: field.label,
      currentDisplay: field.format(curr),
      proposedDisplay: field.format(value),
    });
  }
  return changes;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // Normalize null/undefined/'' as equal-ish for change detection.
  const aEmpty = a === null || a === undefined || a === '';
  const bEmpty = b === null || b === undefined || b === '';
  if (aEmpty && bEmpty) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return JSON.stringify(a) === JSON.stringify(b);
  }
  if (
    a && b && typeof a === 'object' && typeof b === 'object'
  ) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}
