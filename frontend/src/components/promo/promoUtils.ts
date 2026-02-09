import { Party } from '../../types';
import { getDateTimeInTimezone } from '../../utils/dateUtils';

/**
 * Get the public RSVP URL for the party.
 */
export function getRsvpUrl(party: Party): string {
  const baseUrl = window.location.origin;
  if (party.customUrl) {
    return `${baseUrl}/${party.customUrl}`;
  }
  return `${baseUrl}/rsvp/${party.inviteCode}`;
}

/**
 * Format the event date for display in generated content.
 * e.g., "Saturday, February 15, 2025 at 7:00 PM MST"
 */
export function formatEventDateLong(party: Party): string {
  if (!party.date) return 'TBD';
  const d = new Date(party.date);
  const tz = party.timezone || 'UTC';

  const { dateStr, timeStr } = getDateTimeInTimezone(d, tz);

  // Format to a readable date
  const dateObj = new Date(dateStr + 'T12:00:00');
  const formattedDate = dateObj.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: tz,
  });

  // Format time
  const [hours, minutes] = timeStr.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const hours12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  const formattedTime = `${hours12}:${minutes.toString().padStart(2, '0')} ${period}`;

  // Short timezone name
  const tzShort = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'short',
  }).formatToParts(d).find(p => p.type === 'timeZoneName')?.value || tz;

  return `${formattedDate} at ${formattedTime} ${tzShort}`;
}

/**
 * Format the event date short for social posts.
 * e.g., "Feb 15 at 7pm"
 */
export function formatEventDateShort(party: Party): string {
  if (!party.date) return 'TBD';
  const d = new Date(party.date);
  const tz = party.timezone || 'UTC';

  const { timeStr } = getDateTimeInTimezone(d, tz);

  const formattedDate = d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: tz,
  });

  const [hours] = timeStr.split(':').map(Number);
  const period = hours >= 12 ? 'pm' : 'am';
  const hours12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;

  return `${formattedDate} at ${hours12}${period}`;
}

/**
 * Get a location string: venue name + city, or address, or "TBD".
 */
export function getLocationString(party: Party): string {
  if (party.venueName && party.address) {
    // Extract city from address
    const parts = party.address.split(',');
    const city = parts.length >= 2 ? parts[parts.length - 2].trim() : party.address;
    return `${party.venueName}, ${city}`;
  }
  if (party.venueName) return party.venueName;
  if (party.address) return party.address;
  return 'TBD';
}

/**
 * Get the city name from the address.
 */
export function getCityFromAddress(party: Party): string {
  if (!party.address) return '';
  const parts = party.address.split(',');
  if (parts.length >= 2) {
    return parts[parts.length - 2].trim().split(' ')[0]; // First word of city part
  }
  return '';
}

// ---------- Content Generators ----------

export type SocialPlatform = 'twitter' | 'instagram' | 'facebook' | 'linkedin';
export type EventPlatform = 'luma' | 'meetup' | 'eventbrite';

export interface PlatformConfig {
  name: string;
  charLimit: number;
  color: string;
  icon: string; // We'll use Lucide icons in the component; this is just for reference
}

export const SOCIAL_PLATFORMS: Record<SocialPlatform, PlatformConfig> = {
  twitter: { name: 'X (Twitter)', charLimit: 280, color: '#000000', icon: 'twitter' },
  instagram: { name: 'Instagram', charLimit: 2200, color: '#E4405F', icon: 'instagram' },
  facebook: { name: 'Facebook', charLimit: 63206, color: '#1877F2', icon: 'facebook' },
  linkedin: { name: 'LinkedIn', charLimit: 3000, color: '#0A66C2', icon: 'linkedin' },
};

export const EVENT_PLATFORMS: Record<EventPlatform, { name: string; color: string; createUrl: string }> = {
  luma: { name: 'Luma', color: '#7C5CFC', createUrl: 'https://lu.ma/create' },
  meetup: { name: 'Meetup', color: '#ED1C40', createUrl: 'https://www.meetup.com/create/' },
  eventbrite: { name: 'Eventbrite', color: '#F05537', createUrl: 'https://www.eventbrite.com/create' },
};

/**
 * Generate a Twitter/X thread (3 posts) for the party.
 * Post 1: Event name, date, location, CTA
 * Post 2: RSVP link only
 * Post 3: Hosts/co-hosts with Twitter handles
 */
export function generateTwitterThread(party: Party): string[] {
  const rsvpUrl = getRsvpUrl(party);
  const dateStr = formatEventDateShort(party);
  const location = getLocationString(party);

  // Post 1: Main tweet
  const post1Lines: string[] = [];
  post1Lines.push(party.name);
  if (party.date && location !== 'TBD') {
    post1Lines.push(`${dateStr} at ${location}`);
  } else if (party.date) {
    post1Lines.push(dateStr);
  } else if (location !== 'TBD') {
    post1Lines.push(location);
  }
  post1Lines.push('');
  post1Lines.push('RSVP Below \u{1F447}');
  const post1 = post1Lines.join('\n');

  // Post 2: Just the link
  const post2 = rsvpUrl;

  // Post 3: Hosts
  const hostLines: string[] = ['At the event, connect w/:'];

  // Primary host
  if (party.hostProfile?.twitter) {
    const handle = party.hostProfile.twitter.replace(/^@/, '');
    hostLines.push(`@${handle}`);
  } else if (party.hostName) {
    hostLines.push(party.hostName);
  }

  // Co-hosts (only those shown on event)
  if (party.coHosts) {
    for (const coHost of party.coHosts) {
      if (coHost.showOnEvent === false) continue;
      if (coHost.twitter) {
        const handle = coHost.twitter.replace(/^@/, '');
        hostLines.push(`@${handle}`);
      } else {
        hostLines.push(coHost.name);
      }
    }
  }

  const post3 = hostLines.join('\n');

  return [post1, post2, post3];
}

/**
 * Generate a social media post for the given platform.
 */
export function generateSocialPost(party: Party, platform: SocialPlatform): string {
  const rsvpUrl = getRsvpUrl(party);
  const dateStr = formatEventDateShort(party);
  const location = getLocationString(party);
  const city = getCityFromAddress(party);
  const hashtags = generateHashtags(party, city);

  switch (platform) {
    case 'twitter': {
      // Twitter now uses thread mode - return post 1 as fallback
      const thread = generateTwitterThread(party);
      return thread[0];
    }

    case 'instagram': {
      const lines = [];
      lines.push(`${party.name}`);
      lines.push('');
      if (party.description) {
        lines.push(party.description.slice(0, 300));
        lines.push('');
      }
      if (party.date) lines.push(`When: ${dateStr}`);
      if (location !== 'TBD') lines.push(`Where: ${location}`);
      lines.push('');
      lines.push(`RSVP link in bio or visit ${rsvpUrl}`);
      lines.push('');
      lines.push(hashtags.join(' '));
      return lines.join('\n');
    }

    case 'facebook': {
      const lines = [];
      lines.push(`${party.name}`);
      lines.push('');
      if (party.description) {
        lines.push(party.description);
        lines.push('');
      }
      if (party.date) lines.push(`When: ${formatEventDateLong(party)}`);
      if (location !== 'TBD') lines.push(`Where: ${location}`);
      lines.push('');
      lines.push(`RSVP here: ${rsvpUrl}`);
      lines.push('');
      lines.push(hashtags.slice(0, 6).join(' '));
      return lines.join('\n');
    }

    case 'linkedin': {
      const lines = [];
      lines.push(`${party.name}`);
      lines.push('');
      if (party.description) {
        lines.push(party.description.slice(0, 500));
        lines.push('');
      }
      if (party.date) lines.push(`Date: ${formatEventDateLong(party)}`);
      if (location !== 'TBD') lines.push(`Location: ${location}`);
      lines.push('');
      lines.push(`RSVP: ${rsvpUrl}`);
      lines.push('');
      lines.push(hashtags.slice(0, 5).join(' '));
      return lines.join('\n');
    }
  }
}

/**
 * Generate hashtags for the party.
 */
function generateHashtags(party: Party, city: string): string[] {
  const tags = ['#pizza', '#pizzaparty'];
  if (city) tags.push(`#${city.toLowerCase().replace(/[^a-z0-9]/g, '')}`);
  if (party.eventType === 'gpp') tags.push('#globalpizzaparty', '#GPP');
  tags.push('#rsvpizza');
  return tags;
}

/**
 * Generate event listing description for cross-platform publishing.
 */
export function generateEventDescription(party: Party): string {
  const rsvpUrl = getRsvpUrl(party);
  const lines = [];

  if (party.description) {
    lines.push(party.description);
    lines.push('');
  }

  lines.push('--- Event Details ---');
  if (party.date) lines.push(`Date: ${formatEventDateLong(party)}`);
  if (party.venueName) lines.push(`Venue: ${party.venueName}`);
  if (party.address) lines.push(`Address: ${party.address}`);
  lines.push('');
  lines.push(`RSVP: ${rsvpUrl}`);
  lines.push('');
  lines.push('Powered by RSV.Pizza');

  return lines.join('\n');
}

/**
 * Get the share URL for a given social platform.
 */
export function getShareUrl(platform: SocialPlatform, text: string, party: Party): string | null {
  const rsvpUrl = getRsvpUrl(party);

  switch (platform) {
    case 'twitter':
      return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
    case 'facebook':
      return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(rsvpUrl)}&quote=${encodeURIComponent(text)}`;
    case 'linkedin':
      return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(rsvpUrl)}`;
    case 'instagram':
      // Instagram doesn't support share links, copy to clipboard instead
      return null;
  }
}
