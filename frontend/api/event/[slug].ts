import type { VercelRequest, VercelResponse } from '@vercel/node';

const SUPABASE_URL = 'https://znpiwdvvsqaxuskpfleo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpucGl3ZHZ2c3FheHVza3BmbGVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgwMjA0ODQsImV4cCI6MjA4MzU5NjQ4NH0.yAb2_JOtyYD0uqvqoPufzc5kG2pNjyqd1pC97UViXuw';
const SITE_URL = 'https://www.rsv.pizza';

// User agents for social media crawlers
const CRAWLER_USER_AGENTS = [
  'facebookexternalhit',
  'Facebot',
  'Twitterbot',
  'LinkedInBot',
  'Pinterest',
  'Slackbot',
  'TelegramBot',
  'WhatsApp',
  'Discordbot',
  'Googlebot',
  'bingbot',
];

function isCrawler(userAgent: string | undefined): boolean {
  if (!userAgent) return false;
  return CRAWLER_USER_AGENTS.some(crawler =>
    userAgent.toLowerCase().includes(crawler.toLowerCase())
  );
}

async function getPartyBySlug(slug: string) {
  // Try custom URL first
  let response = await fetch(
    `${SUPABASE_URL}/rest/v1/parties?custom_url=eq.${encodeURIComponent(slug)}&select=*`,
    {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
    }
  );

  if (response.ok) {
    const data = await response.json();
    if (data && data.length > 0) {
      return data[0];
    }
  }

  // Try invite_code
  response = await fetch(
    `${SUPABASE_URL}/rest/v1/parties?invite_code=eq.${encodeURIComponent(slug)}&select=*`,
    {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
    }
  );

  if (response.ok) {
    const data = await response.json();
    if (data && data.length > 0) {
      return data[0];
    }
  }

  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { slug } = req.query;
  const userAgent = req.headers['user-agent'];

  // If not a crawler, redirect to the SPA event page
  if (!isCrawler(userAgent)) {
    return res.redirect(302, `/${slug}`);
  }

  try {
    const party = await getPartyBySlug(slug as string);

    if (!party) {
      return res.status(200).setHeader('Content-Type', 'text/html').send(generateHTML({
        title: 'Event Not Found | RSV.Pizza',
        description: 'This event could not be found.',
        image: `${SITE_URL}/logo.png`,
        url: `${SITE_URL}/${slug}`,
      }));
    }

    // Build meta tag content
    const title = party.name || 'Pizza Party';
    const hostName = party.host_name;

    // Format date if available
    let dateStr = '';
    if (party.date) {
      const eventDate = new Date(party.date);
      dateStr = eventDate.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    }

    // Build description
    let description = party.description ? stripMarkdown(party.description) : '';
    if (!description) {
      const parts = [];
      if (hostName) parts.push(`Join ${hostName} for ${title}`);
      else parts.push(`Join us for ${title}`);
      if (dateStr) parts.push(`on ${dateStr}`);
      if (party.address) parts.push(`at ${party.address}`);
      parts.push('RSVP now!');
      description = parts.join(' ');
    }
    if (description.length > 200) {
      description = description.substring(0, 197) + '...';
    }

    // Get image URL (ensure absolute)
    let imageUrl = party.event_image_url;
    if (imageUrl) {
      if (imageUrl.startsWith('/')) {
        imageUrl = `${SITE_URL}${imageUrl}`;
      } else if (!imageUrl.startsWith('http')) {
        imageUrl = `${SITE_URL}/${imageUrl}`;
      }
    } else {
      imageUrl = `${SITE_URL}/logo.png`;
    }

    const pageUrl = party.custom_url
      ? `${SITE_URL}/${party.custom_url}`
      : `${SITE_URL}/${party.invite_code}`;

    return res.status(200).setHeader('Content-Type', 'text/html').send(generateHTML({
      title: `${title} | RSV.Pizza`,
      description,
      image: imageUrl,
      url: pageUrl,
      eventDate: party.date,
      eventLocation: party.address,
      eventDuration: party.duration,
    }));

  } catch (error) {
    console.error('Error fetching party for OG tags:', error);
    return res.status(200).setHeader('Content-Type', 'text/html').send(generateHTML({
      title: 'RSV.Pizza - Pizza Party Planning',
      description: 'Plan the perfect pizza order for your party guests.',
      image: `${SITE_URL}/logo.png`,
      url: `${SITE_URL}/${slug}`,
    }));
  }
}

interface MetaTagsOptions {
  title: string;
  description: string;
  image: string;
  url: string;
  eventDate?: string;
  eventLocation?: string;
  eventDuration?: number;
}

function generateHTML(options: MetaTagsOptions): string {
  const { title, description, image, url, eventDate, eventLocation, eventDuration } = options;

  let endTime = '';
  if (eventDate && eventDuration) {
    const start = new Date(eventDate);
    const end = new Date(start.getTime() + eventDuration * 3600000);
    endTime = end.toISOString();
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <!-- Primary Meta Tags -->
  <title>${escapeHtml(title)}</title>
  <meta name="title" content="${escapeHtml(title)}">
  <meta name="description" content="${escapeHtml(description)}">

  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="website">
  <meta property="og:url" content="${escapeHtml(url)}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:image" content="${escapeHtml(image)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:site_name" content="RSV.Pizza">

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:url" content="${escapeHtml(url)}">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(image)}">

  ${eventDate ? `<!-- Event Meta -->
  <meta property="event:start_time" content="${new Date(eventDate).toISOString()}">
  ${endTime ? `<meta property="event:end_time" content="${endTime}">` : ''}
  ${eventLocation ? `<meta property="event:location" content="${escapeHtml(eventLocation)}">` : ''}` : ''}

  <!-- Redirect to actual page -->
  <meta http-equiv="refresh" content="0;url=${escapeHtml(url)}">
  <link rel="canonical" href="${escapeHtml(url)}">
</head>
<body>
  <p>Redirecting to <a href="${escapeHtml(url)}">${escapeHtml(title)}</a>...</p>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

function stripMarkdown(text: string): string {
  return text
    // Remove markdown links [text](url) -> text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove bold **text** or __text__
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    // Remove italic *text* or _text_
    .replace(/(\*|_)(.*?)\1/g, '$2')
    // Remove inline code `text`
    .replace(/`([^`]+)`/g, '$1')
    // Remove headers
    .replace(/^#{1,6}\s+/gm, '')
    // Remove blockquotes
    .replace(/^>\s+/gm, '')
    // Remove horizontal rules
    .replace(/^[-*_]{3,}\s*$/gm, '')
    // Remove list markers
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    // Clean up multiple spaces
    .replace(/\s+/g, ' ')
    .trim();
}
