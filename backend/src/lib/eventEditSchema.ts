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
    description: 'The public title of the event.',
    format: fmtString,
  },
  {
    key: 'event_datetime',
    type: 'datetime',
    label: 'Start date & time',
    description:
      'When the event starts, as a human-readable local datetime in the event timezone, e.g. "2026-07-04 18:00" or "next Friday at 6pm". The end time / duration is preserved.',
    resolvesTo: ['date', 'duration'],
    format: fmtDatetime,
  },
  {
    key: 'duration',
    type: 'number',
    label: 'Duration (hours)',
    description: 'How long the event lasts, in hours. Use for "make it 3 hours long".',
    format: fmtNumber,
  },
  {
    key: 'timezone',
    type: 'string',
    label: 'Timezone',
    description: 'IANA timezone identifier, e.g. "America/New_York". Only change if explicitly asked.',
    format: fmtString,
  },
  {
    key: 'description',
    type: 'string',
    label: 'Description',
    description: 'The event description / body text shown on the public page.',
    format: fmtString,
  },
  {
    key: 'pizza_style',
    type: 'enum',
    label: 'Pizza style',
    description: 'The default pizza style for the event.',
    enumValues: ['new-york', 'neapolitan', 'chicago', 'detroit', 'sicilian', 'california'] as const,
    format: fmtString,
  },
  {
    key: 'address',
    type: 'string',
    label: 'Address',
    description:
      'The venue street address. Note: changing this does NOT move the map pin (lat/long are set separately).',
    format: fmtString,
  },
  {
    key: 'venue_name',
    type: 'string',
    label: 'Venue name',
    description: 'The name of the venue (e.g. "The Pizza Loft").',
    format: fmtString,
  },
  {
    key: 'city',
    type: 'string',
    label: 'City',
    description: 'The city the event is in.',
    format: fmtString,
  },
  {
    key: 'country',
    type: 'string',
    label: 'Country',
    description: 'The country (full English name, e.g. "United States").',
    format: fmtString,
  },
  {
    key: 'max_guests',
    type: 'number',
    label: 'Max guests',
    description: 'The guest capacity cap. Null/0 means unlimited.',
    format: fmtNumber,
  },
  {
    key: 'expected_guests',
    type: 'number',
    label: 'Expected guests',
    description: "The host's estimate of how many people will attend.",
    format: fmtNumber,
  },
  {
    key: 'estimated_attendance',
    type: 'number',
    label: 'Estimated attendance',
    description: 'Planning estimate of attendance used for budgeting.',
    format: fmtNumber,
  },
  {
    key: 'hide_guests',
    type: 'boolean',
    label: 'Hide guest list',
    description: 'When on, the public guest list is hidden.',
    format: fmtBoolean,
  },
  {
    key: 'require_approval',
    type: 'boolean',
    label: 'Require RSVP approval',
    description: 'When on, RSVPs must be approved by the host before counting.',
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
    description: 'The full list of beverage options guests can choose. Propose the COMPLETE new list.',
    format: fmtStringArray,
  },
  {
    key: 'available_toppings',
    type: 'string[]',
    label: 'Available toppings',
    description: 'The full list of pizza toppings guests can choose. Propose the COMPLETE new list.',
    format: fmtStringArray,
  },
  {
    key: 'available_dietary_options',
    type: 'string[]',
    label: 'Dietary options',
    description: 'The full list of dietary options (e.g. vegan, gluten-free). Propose the COMPLETE new list.',
    format: fmtStringArray,
  },
  {
    key: 'password',
    type: 'string',
    label: 'Event password',
    description: 'Optional password to gate the event page. Empty string removes it.',
    format: fmtString,
  },
  {
    key: 'custom_url',
    type: 'string',
    label: 'Custom URL slug',
    description:
      'The rsv.pizza/<slug> custom path. Lowercase letters, numbers, hyphens only, 3–50 chars. Uniqueness is validated when applied.',
    format: fmtString,
  },
  {
    key: 'event_tags',
    type: 'string[]',
    label: 'Event tags',
    description:
      'Tags used for filtering/grouping. Propose the COMPLETE new list. Never add or remove the "go" tag.',
    format: fmtStringArray,
  },
  {
    key: 'donation_enabled',
    type: 'boolean',
    label: 'Donations enabled',
    description: 'When on, the donation/fundraising widget is shown.',
    format: fmtBoolean,
  },
  {
    key: 'donation_goal',
    type: 'number',
    label: 'Donation goal',
    description: 'The fundraising goal amount (dollars).',
    format: fmtNumber,
  },
  {
    key: 'donation_message',
    type: 'string',
    label: 'Donation message',
    description: 'The call-to-action shown above the donation widget.',
    format: fmtString,
  },
  {
    key: 'donation_recipient',
    type: 'string',
    label: 'Donation recipient',
    description: 'Name of the organization receiving donations.',
    format: fmtString,
  },
  {
    key: 'donation_recipient_url',
    type: 'string',
    label: 'Donation recipient URL',
    description: "Link to the donation recipient's site.",
    format: fmtString,
  },
  {
    key: 'donation_eth_address',
    type: 'string',
    label: 'Donation ETH address',
    description: 'Ethereum address that receives crypto donations.',
    format: fmtString,
  },
  {
    key: 'donation_amounts_public',
    type: 'boolean',
    label: 'Donation amounts public',
    description: 'When on, individual donation amounts are shown publicly.',
    format: fmtBoolean,
  },
  {
    key: 'suggested_amounts',
    type: 'number[]' as CatalogType, // stored as cents; handled as a numeric array
    label: 'Suggested donation amounts',
    description:
      'Preset donation buttons, in CENTS (e.g. 500 = $5.00). Propose the COMPLETE new list of cent values.',
    format: fmtCentsArray,
  },
  {
    key: 'share_to_unlock',
    type: 'boolean',
    label: 'Share to unlock',
    description: 'When on, guests must share before unlocking RSVP.',
    format: fmtBoolean,
  },
  {
    key: 'share_tweet_text',
    type: 'string',
    label: 'Share tweet text',
    description: 'Pre-filled text for the share-to-unlock tweet.',
    format: fmtString,
  },
  {
    key: 'fundraising_goal',
    type: 'number',
    label: 'Fundraising goal',
    description: 'Overall fundraising goal (dollars).',
    format: fmtNumber,
  },
  {
    key: 'music_enabled',
    type: 'boolean',
    label: 'Music enabled',
    description: 'When on, the music/playlist widget is shown.',
    format: fmtBoolean,
  },
  {
    key: 'music_notes',
    type: 'string',
    label: 'Music notes',
    description: 'Notes about music / playlist for the event.',
    format: fmtString,
  },
  {
    key: 'photo_moderation',
    type: 'boolean',
    label: 'Photo moderation',
    description: 'When on, uploaded photos require approval before showing.',
    format: fmtBoolean,
  },
  {
    key: 'nft_enabled',
    type: 'boolean',
    label: 'NFT enabled',
    description: 'When on, the NFT mint feature is enabled.',
    format: fmtBoolean,
  },
  {
    key: 'nft_chain',
    type: 'string',
    label: 'NFT chain',
    description: 'The blockchain used for NFT minting.',
    format: fmtString,
  },
  {
    key: 'luma_url',
    type: 'string',
    label: 'Luma URL',
    description: 'Link to a Luma event page.',
    format: fmtString,
  },
  {
    key: 'meetup_url',
    type: 'string',
    label: 'Meetup URL',
    description: 'Link to a Meetup event page.',
    format: fmtString,
  },
  {
    key: 'eventbrite_url',
    type: 'string',
    label: 'Eventbrite URL',
    description: 'Link to an Eventbrite event page.',
    format: fmtString,
  },
  {
    key: 'external_links',
    type: 'object[]',
    label: 'External links',
    description:
      'Custom external links shown on the event page. Each item is { label, url }. Propose the COMPLETE new list (max 10).',
    format: fmtExternalLinks,
  },
  {
    key: 'telegram_group',
    type: 'string',
    label: 'Telegram group link',
    description: 'Link to the city Telegram group.',
    format: fmtString,
  },
  {
    key: 'turtle_roles_enabled',
    type: 'boolean',
    label: 'Turtle roles enabled',
    description: 'When on, turtle role assignments are enabled.',
    format: fmtBoolean,
  },
  {
    key: 'survey_enabled',
    type: 'boolean',
    label: 'Post-event survey enabled',
    description: 'When on, attendees get the post-event survey.',
    format: fmtBoolean,
  },
  {
    key: 'reminders_enabled',
    type: 'boolean',
    label: 'Reminders enabled',
    description: 'When on, the T-4h event reminder is sent.',
    format: fmtBoolean,
  },
  {
    key: 'wifi_info',
    type: 'string',
    label: 'WiFi info',
    description: 'WiFi network / password info shown to attendees day-of.',
    format: fmtString,
  },
  {
    key: 'parking_notes',
    type: 'string',
    label: 'Parking notes',
    description: 'Parking instructions shown to attendees.',
    format: fmtString,
  },
  {
    key: 'region',
    type: 'string',
    label: 'Region',
    description: 'The GPP region slug for the event.',
    format: fmtString,
  },
  {
    key: 'venue_report_title',
    type: 'string',
    label: 'Venue report title',
    description: 'Title of the venue report.',
    format: fmtString,
  },
  {
    key: 'venue_report_notes',
    type: 'string',
    label: 'Venue report notes',
    description: 'Notes in the venue report.',
    format: fmtString,
  },
  {
    key: 'co_hosts',
    type: 'object[]',
    label: 'Co-hosts',
    description:
      'The co-host list. You may ONLY remove or reorder existing co-hosts — NEVER add a new co-host (adding requires an email and a separate flow). Propose the COMPLETE remaining list.',
    format: fmtCoHosts,
  },
  /* ----------------------------- admin-only ------------------------------ */
  {
    key: 'reimbursement_cap_usd',
    type: 'number',
    label: 'Reimbursement cap (USD)',
    description: 'Per-event reimbursement cap in USD. Admin-only.',
    adminOnly: true,
    format: fmtNumber,
  },
  {
    key: 'tax_form_required',
    type: 'boolean',
    label: 'Tax form required',
    description: 'When on, a tax form is required before payout. Admin-only.',
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
  const base: Record<string, unknown> = { description: f.description };
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
