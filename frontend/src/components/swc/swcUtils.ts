import candidatesData from '../../data/swc-candidates.json';

export interface SWCCandidate {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  nickname: string | null;
  party: string;
  grade: string;
  stanceScore: number | null;
  office: string;
  state: string;
  district: string | null;
  photoUrl: string | null;
  swcProfileUrl: string;
  stanceCount: number;
  donationUrl: string | null;
  officialUrl: string | null;
  twitterHandles: string[];
}

/**
 * Calculate distance in miles between two lat/lng points using the Haversine formula.
 */
export function getDistanceMiles(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 3959; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Full US state name -> abbreviation mapping
const STATE_ABBREVIATIONS: Record<string, string> = {
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
  'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
  'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
  'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
  'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
  'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
  'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
  'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
  'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV',
  'wisconsin': 'WI', 'wyoming': 'WY', 'district of columbia': 'DC',
};

// Reverse mapping: abbreviation -> full name
const ABBREVIATION_TO_STATE: Record<string, string> = {};
for (const [full, abbr] of Object.entries(STATE_ABBREVIATIONS)) {
  ABBREVIATION_TO_STATE[abbr] = full.replace(/\b\w/g, c => c.toUpperCase());
}

// Valid 2-letter state codes
const VALID_STATE_CODES = new Set(Object.values(STATE_ABBREVIATIONS));

/**
 * Extract the US state abbreviation from a Google Places address string.
 * Google Places typically formats addresses like:
 *   "123 Main St, Brooklyn, NY 11201, USA"
 *   "456 Elm Ave, Austin, TX 78701, United States"
 *   "San Francisco, CA, USA"
 */
export function extractStateFromAddress(address: string): string | null {
  if (!address) return null;

  // Strategy 1: Look for 2-letter state code pattern in comma-separated parts
  // Typical: "City, ST ZIP" or "City, ST"
  const parts = address.split(',').map(p => p.trim());

  for (const part of parts) {
    // Match a 2-letter uppercase code (possibly followed by a ZIP)
    const match = part.match(/\b([A-Z]{2})\b/);
    if (match && VALID_STATE_CODES.has(match[1])) {
      return match[1];
    }
  }

  // Strategy 2: Look for full state name in the address
  const lower = address.toLowerCase();
  for (const [stateName, abbr] of Object.entries(STATE_ABBREVIATIONS)) {
    if (lower.includes(stateName)) {
      return abbr;
    }
  }

  return null;
}

/**
 * Check if an address is in the United States.
 */
export function isUSAddress(address: string): boolean {
  if (!address) return false;
  const lower = address.toLowerCase();
  // Check for common US indicators
  return (
    lower.includes('usa') ||
    lower.includes('united states') ||
    lower.includes('u.s.a') ||
    // If we can extract a US state, it's likely US
    extractStateFromAddress(address) !== null
  );
}

/**
 * Get all candidates for a given state abbreviation (e.g., "NY", "CA").
 * Returns candidates sorted by grade (A first, then B) and then by office.
 */
export function getCandidatesByState(stateCode: string): SWCCandidate[] {
  const candidates = (candidatesData as SWCCandidate[]).filter(
    c => c.state?.toUpperCase() === stateCode.toUpperCase()
  );

  const gradeOrder: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, F: 4, '?': 5 };
  const officeOrder: Record<string, number> = { 'President': 0, 'U.S. Senate': 1, 'Governor': 2, 'Attorney General': 3, 'U.S. House': 4 };

  return candidates.sort((a, b) => {
    const gradeDiff = (gradeOrder[a.grade] ?? 5) - (gradeOrder[b.grade] ?? 5);
    if (gradeDiff !== 0) return gradeDiff;
    return (officeOrder[a.office] ?? 9) - (officeOrder[b.office] ?? 9);
  });
}

/**
 * Get all unique states that have candidates in the dataset.
 */
export function getAvailableStates(): string[] {
  const states = new Set((candidatesData as SWCCandidate[]).filter(c => c.state).map(c => c.state));
  return Array.from(states).sort();
}

/**
 * Get state full name from abbreviation.
 */
export function getStateName(abbr: string): string {
  return ABBREVIATION_TO_STATE[abbr.toUpperCase()] || abbr;
}

/**
 * Get the party full name.
 */
export function getPartyName(party: string): string {
  switch (party) {
    case 'D': return 'Democrat';
    case 'R': return 'Republican';
    case 'I': return 'Independent';
    case 'L': return 'Libertarian';
    default: return party;
  }
}

/**
 * Get the grade badge color classes.
 */
export function getGradeColor(grade: string): { bg: string; text: string } {
  switch (grade) {
    case 'A': return { bg: 'bg-[#39d98a]/20', text: 'text-[#39d98a]' };
    case 'B': return { bg: 'bg-[#5c7cfa]/20', text: 'text-[#5c7cfa]' };
    case 'C': return { bg: 'bg-yellow-500/20', text: 'text-yellow-400' };
    case 'D': return { bg: 'bg-orange-500/20', text: 'text-orange-400' };
    case 'F': return { bg: 'bg-red-500/20', text: 'text-red-400' };
    case '?': return { bg: 'bg-gray-500/20', text: 'text-gray-400' };
    default: return { bg: 'bg-theme-surface', text: 'text-theme-text-muted' };
  }
}

// ---- Outreach Email Templates ----

interface OutreachEventData {
  eventName: string;
  eventDate: string;
  eventLocation: string;
  rsvpUrl: string;
  hostName: string;
}

export type OutreachTemplate = 'invitation' | 'partnership' | 'followup';

interface OutreachTemplateConfig {
  label: string;
  subject: (candidate: SWCCandidate, event: OutreachEventData) => string;
  body: (candidate: SWCCandidate, event: OutreachEventData) => string;
}

export function getOutreachTemplates(
  candidate: SWCCandidate,
  event: OutreachEventData
): Record<OutreachTemplate, OutreachTemplateConfig> {
  return {
    invitation: {
      label: 'Event Invitation',
      subject: () => `Invitation: ${event.eventName} - Pizza Party for Crypto Advocates`,
      body: () =>
        `Dear ${candidate.name},\n\n` +
        `We are hosting ${event.eventName}, a community gathering to celebrate and educate people about cryptocurrency and blockchain technology.\n\n` +
        `Event Details:\n` +
        `${event.eventDate ? `Date: ${event.eventDate}\n` : ''}` +
        `${event.eventLocation ? `Location: ${event.eventLocation}\n` : ''}` +
        `RSVP: ${event.rsvpUrl}\n\n` +
        `As a crypto-friendly representative with an "${candidate.grade}" grade from Stand With Crypto, we believe your participation would resonate strongly with our community. We would be honored to have you join us, whether for remarks, a Q&A, or simply as a guest.\n\n` +
        `We look forward to hearing from you.\n\n` +
        `Best regards,\n${event.hostName}`,
    },
    partnership: {
      label: 'Partnership Ask',
      subject: () => `Partnership Opportunity: ${event.eventName}`,
      body: () =>
        `Dear ${candidate.name}'s Office,\n\n` +
        `We are organizing ${event.eventName}, bringing together crypto and blockchain enthusiasts in ${candidate.state}.\n\n` +
        `${event.eventDate ? `Date: ${event.eventDate}\n` : ''}` +
        `${event.eventLocation ? `Location: ${event.eventLocation}\n` : ''}` +
        `\nWe are reaching out because ${candidate.name} has been a strong advocate for sensible crypto policy. We would love to explore any of the following:\n\n` +
        `- A brief appearance or video message at the event\n` +
        `- Sharing the event with your network\n` +
        `- A co-branded social media post\n\n` +
        `This is a non-partisan community event focused on education and advocacy. More info: ${event.rsvpUrl}\n\n` +
        `Thank you for your time.\n\n` +
        `Best,\n${event.hostName}`,
    },
    followup: {
      label: 'Follow-Up',
      subject: () => `Follow-Up: ${event.eventName} Invitation`,
      body: () =>
        `Dear ${candidate.name}'s Office,\n\n` +
        `I wanted to follow up on our earlier invitation to ${event.eventName}.\n\n` +
        `${event.eventDate ? `The event is scheduled for ${event.eventDate}` : 'The event details are being finalized'}${event.eventLocation ? ` at ${event.eventLocation}` : ''}.\n\n` +
        `We have a growing list of RSVPs and believe ${candidate.name}'s presence would be a highlight for attendees who care about crypto-friendly policy.\n\n` +
        `Please let us know if there is any way we can make this work.\n\n` +
        `RSVP page: ${event.rsvpUrl}\n\n` +
        `Best regards,\n${event.hostName}`,
    },
  };
}
