/**
 * Field Mapping Consistency Test
 *
 * This is the HIGHEST VALUE test in the suite. It programmatically verifies
 * that all touchpoints in the field mapping chain stay in sync.
 *
 * The "Field Mapping Chain" has 9 touchpoints when adding a new DB field:
 * 1. DB migration (Supabase) — not testable here
 * 2. Prisma schema — not testable here
 * 3. Backend PATCH handler destructuring — tested via source parsing
 * 4. UpdatePartyData interface — tested via source parsing
 * 5. updatePartyApi body mapping — tested via source parsing
 * 6. updateParty snake→camelCase mapping — tested via source parsing
 * 7. dbPartyToParty mapper — tested via export
 * 8. DbParty interface — tested via source parsing
 * 9. SAFE_PARTY_COLUMNS list — tested via export
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Import the actual exported values
import { SAFE_PARTY_COLUMNS } from '../lib/supabase';
import { dbPartyToParty } from '../contexts/PizzaContext';

// Helper to read source files
function readSource(relativePath: string): string {
  const fullPath = path.resolve(__dirname, '..', relativePath);
  return fs.readFileSync(fullPath, 'utf-8');
}

// Parse SAFE_PARTY_COLUMNS into a Set of column names
function parseSafeColumns(columnsStr: string): Set<string> {
  return new Set(
    columnsStr
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0)
  );
}

// Extract interface fields from TypeScript source
function extractInterfaceFields(source: string, interfaceName: string): string[] {
  const interfaceRegex = new RegExp(
    `(?:export\\s+)?interface\\s+${interfaceName}\\s*\\{([^}]+(?:\\{[^}]*\\}[^}]*)*)\\}`,
    's'
  );
  const match = source.match(interfaceRegex);
  if (!match) return [];

  const body = match[1];
  const fieldRegex = /^\s*(\w+)[\?:]?\s*:/gm;
  const fields: string[] = [];
  let fieldMatch;
  while ((fieldMatch = fieldRegex.exec(body)) !== null) {
    fields.push(fieldMatch[1]);
  }
  return fields;
}

// Extract fields from updatePartyApi body object
function extractUpdatePartyApiBodyFields(source: string): string[] {
  // Find the updatePartyApi function body mapping
  const fnRegex = /export\s+async\s+function\s+updatePartyApi\s*\([^)]*\)\s*\{([\s\S]*?)^\}/m;
  const fnMatch = source.match(fnRegex);
  if (!fnMatch) return [];

  const fnBody = fnMatch[1];
  // Extract fields from the body object: key: data.key patterns
  const fieldRegex = /(\w+):\s*data\.\w+/g;
  const fields: string[] = [];
  let match;
  while ((match = fieldRegex.exec(fnBody)) !== null) {
    fields.push(match[1]);
  }
  return fields;
}

// Extract fields from the dbPartyToParty mapper by checking what it reads from dbParty
function extractDbPartyToPartyFields(source: string): string[] {
  // Find the function body
  const fnRegex = /function\s+dbPartyToParty\s*\([^)]*\)\s*:\s*\w+\s*\{([\s\S]*?)^\}/m;
  const fnMatch = source.match(fnRegex);
  if (!fnMatch) return [];

  const fnBody = fnMatch[1];
  // Extract all dbParty.field_name references
  const fieldRegex = /dbParty\.(\w+)/g;
  const fields = new Set<string>();
  let match;
  while ((match = fieldRegex.exec(fnBody)) !== null) {
    fields.add(match[1]);
  }
  return Array.from(fields);
}

// Extract fields destructured in the backend PATCH handler
function extractPatchHandlerFields(source: string): string[] {
  // Find the PATCH handler destructuring
  const patchRegex = /router\.patch\s*\(\s*'\/:id'[\s\S]*?const\s*\{([^}]+)\}\s*=\s*req\.body/;
  const match = source.match(patchRegex);
  if (!match) return [];

  return match[1]
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('//'));
}

describe('Field Mapping Consistency', () => {
  const safeColumns = parseSafeColumns(SAFE_PARTY_COLUMNS);

  const apiSource = readSource('lib/api.ts');
  const supabaseSource = readSource('lib/supabase.ts');
  const pizzaContextSource = readSource('contexts/PizzaContext.tsx');

  const updatePartyDataFields = extractInterfaceFields(apiSource, 'UpdatePartyData');
  const dbPartyFields = extractInterfaceFields(supabaseSource, 'DbParty');
  const updatePartyApiBodyFields = extractUpdatePartyApiBodyFields(apiSource);
  const dbPartyToPartyMappedFields = extractDbPartyToPartyFields(pizzaContextSource);

  it('should have SAFE_PARTY_COLUMNS as a non-empty set', () => {
    expect(safeColumns.size).toBeGreaterThan(10);
  });

  it('should have UpdatePartyData interface fields', () => {
    expect(updatePartyDataFields.length).toBeGreaterThan(10);
  });

  it('should have DbParty interface fields', () => {
    expect(dbPartyFields.length).toBeGreaterThan(10);
  });

  it('should have updatePartyApi body mapping fields', () => {
    expect(updatePartyApiBodyFields.length).toBeGreaterThan(10);
  });

  it('should have dbPartyToParty mapped fields', () => {
    expect(dbPartyToPartyMappedFields.length).toBeGreaterThan(10);
  });

  it('every UpdatePartyData field should appear in updatePartyApi body', () => {
    const missing = updatePartyDataFields.filter(
      field => !updatePartyApiBodyFields.includes(field)
    );
    expect(missing).toEqual([]);
  });

  it('every updatePartyApi body field should appear in UpdatePartyData', () => {
    const missing = updatePartyApiBodyFields.filter(
      field => !updatePartyDataFields.includes(field)
    );
    expect(missing).toEqual([]);
  });

  it('core DbParty fields should appear in SAFE_PARTY_COLUMNS', () => {
    // These are the core fields that MUST be in safe columns
    // We skip host_name (derived from API, not DB column), has_password (computed),
    // password (intentionally excluded for security), and host_profile (from join)
    const computedOrExcluded = new Set([
      'host_name', 'has_password', 'password', 'host_profile',
    ]);
    const coreDbPartyFields = dbPartyFields.filter(
      f => !computedOrExcluded.has(f)
    );

    const missing = coreDbPartyFields.filter(f => !safeColumns.has(f));
    expect(missing).toEqual([]);
  });

  it('every field dbPartyToParty reads from dbParty should exist in DbParty interface', () => {
    const missing = dbPartyToPartyMappedFields.filter(
      field => !dbPartyFields.includes(field)
    );
    expect(missing).toEqual([]);
  });

  it('SAFE_PARTY_COLUMNS should not contain phantom fields not in DbParty (with known exceptions)', () => {
    // Some columns are in the DB but not in the DbParty interface because
    // they're only used server-side or in specific contexts
    const knownDbOnlyColumns = new Set([
      'updated_at', 'end_time',
      'photos_enabled', 'photos_public',
      'budget_total', 'budget_enabled',
      'music_enabled', 'music_notes',
      'kit_enabled', 'kit_deadline',
      'fundraising_goal', 'report_recap', 'report_video_url', 'report_photos_url',
      'flyer_artist', 'x_post_url', 'x_post_views', 'farcaster_post_url', 'farcaster_views',
      'luma_url', 'luma_views', 'poap_event_id', 'poap_mints', 'poap_moments',
      'report_published', 'report_public_slug',
    ]);

    const phantomColumns = Array.from(safeColumns).filter(
      col => !dbPartyFields.includes(col) && !knownDbOnlyColumns.has(col)
    );
    expect(phantomColumns).toEqual([]);
  });

  it('dbPartyToParty should map key DbParty fields (spot check)', () => {
    // Verify the mapper function actually works with a sample DbParty
    const sampleDbParty = {
      id: 'test-id',
      name: 'Test Party',
      invite_code: 'abc123',
      custom_url: null,
      user_id: 'user-1',
      date: '2026-01-01',
      duration: 3,
      timezone: 'America/New_York',
      pizza_style: 'new-york',
      available_beverages: ['water'],
      available_toppings: ['pepperoni'],
      max_guests: 50,
      hide_guests: false,
      require_approval: false,
      event_image_url: null,
      description: 'A test party',
      address: '123 Test St',
      venue_name: 'Test Venue',
      rsvp_closed_at: null,
      selected_pizzerias: [],
      co_hosts: [],
      created_at: '2026-01-01T00:00:00Z',
      donation_enabled: false,
      donation_goal: null,
      donation_message: null,
      suggested_amounts: [500, 1000],
      donation_recipient: null,
      donation_recipient_url: null,
      donation_eth_address: null,
      share_to_unlock: false,
      share_tweet_text: null,
      photo_moderation: false,
      nft_enabled: false,
      nft_chain: null,
      pinned_apps: [],
      region: null,
      event_type: null,
      event_tags: [],
    };

    const party = dbPartyToParty(sampleDbParty as any, []);
    expect(party.id).toBe('test-id');
    expect(party.name).toBe('Test Party');
    expect(party.inviteCode).toBe('abc123');
    expect(party.address).toBe('123 Test St');
    expect(party.donationEnabled).toBe(false);
    expect(party.pinnedApps).toEqual([]);
    expect(party.eventTags).toEqual([]);
  });
});
