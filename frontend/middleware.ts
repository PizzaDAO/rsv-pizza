import { next } from '@vercel/edge';

// ---- Bot detection ----
const CRAWLER_USER_AGENTS = [
  'twitterbot',
  'facebookexternalhit',
  'facebot',
  'linkedinbot',
  'slackbot',
  'telegrambot',
  'discordbot',
  'whatsapp',
  'googlebot',
  'bingbot',
  'yandex',
  'embedly',
  'quora link preview',
  'showyoubot',
  'outbrain',
  'pinterest',
  'applebot',
  'webpage bot',
];

function isCrawler(userAgent: string | null): boolean {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return CRAWLER_USER_AGENTS.some((crawler) => ua.includes(crawler));
}

// ---- Paths that are NOT event slugs ----
const SKIP_PREFIXES = [
  '/api/',
  '/assets/',
  '/host/',
  '/rsvp/',
  '/auth/',
  '/create',
  '/login',
  '/parties',
  '/_next/',
  '/favicon',
  '/logo',
  '/og-static/',
];

// ---- Minimal markdown stripper (duplicated from frontend/src/lib/utils.ts) ----
function stripMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links
    .replace(/\*\*(.+?)\*\*/g, '$1') // bold **
    .replace(/__(.+?)__/g, '$1') // bold __
    .replace(/\*(.+?)\*/g, '$1') // italic *
    .replace(/_(.+?)_/g, '$1') // italic _
    .replace(/~~(.+?)~~/g, '$1') // strikethrough
    .replace(/^#{1,6}\s+/gm, '') // headers
    .replace(/^>\s+/gm, '') // blockquotes
    .replace(/^[\s]*[-*+]\s+/gm, '') // unordered lists
    .replace(/^[\s]*\d+\.\s+/gm, '') // ordered lists
    .replace(/`([^`]*)`/g, '$1') // inline code
    .replace(/^[-*_]{3,}\s*$/gm, '') // horizontal rules
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ---- Main middleware ----
export default async function middleware(request: Request) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Skip home page
  if (pathname === '/') return next();

  // Skip known non-event paths and files with extensions (e.g. .js, .css, .png)
  if (
    SKIP_PREFIXES.some((p) => pathname.startsWith(p)) ||
    pathname.includes('.')
  ) {
    return next();
  }

  // Skip the OG rewriter's own internal fetch to prevent infinite loop
  const userAgent = request.headers.get('user-agent');
  if (userAgent === 'RSVPizza-OG-Rewriter') return next();

  // Extract slug (remove leading slash and trailing slash)
  const slug = pathname.replace(/^\//, '').replace(/\/$/, '');
  if (!slug || slug.includes('/')) return next(); // multi-segment paths are not event slugs

  try {
    // Fetch event data from the backend API
    const apiUrl =
      process.env.VITE_API_URL || 'https://backend-pizza-dao.vercel.app';
    const apiResponse = await fetch(
      `${apiUrl}/api/events/${encodeURIComponent(slug)}`,
      { headers: { Accept: 'application/json' } }
    );

    if (!apiResponse.ok) {
      // Event not found or API error -- fall through to normal SPA
      return next();
    }

    const data = await apiResponse.json();
    const event = data?.event;
    if (!event) return next();

    // ---- Build meta tag values (mirrors EventPage.tsx logic) ----
    const baseUrl = 'https://www.rsv.pizza';
    const pageUrl = `${baseUrl}/${slug}`;

    const ogImageUrl = (() => {
      if (!event.eventImageUrl) return `${baseUrl}/logo.png`;
      if (event.eventImageUrl.startsWith('http')) return event.eventImageUrl;
      if (event.eventImageUrl.startsWith('/'))
        return `${baseUrl}${event.eventImageUrl}`;
      return `${baseUrl}/${event.eventImageUrl}`;
    })();

    const hasCustomImage = !!event.eventImageUrl;

    const eventDate = event.date ? new Date(event.date) : null;
    const formattedDate = eventDate
      ? eventDate.toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          timeZone: event.timezone || undefined,
        })
      : null;
    const formattedTime = eventDate
      ? eventDate.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          timeZone: event.timezone || undefined,
        })
      : null;

    const metaTitle = event.name || 'Pizza Party';

    // Build description: "Hosted by X * Date @ Time * Address. description..."
    const detailsParts: string[] = [];
    if (event.hostName) detailsParts.push(`Hosted by ${event.hostName}`);
    if (formattedDate)
      detailsParts.push(
        `${formattedDate}${formattedTime ? ` @ ${formattedTime}` : ''}`
      );
    if (event.address) detailsParts.push(event.address);

    const details = detailsParts.join(' \u2022 '); // bullet separator
    let metaDescription = details;

    if (event.description) {
      const cleanDescription = stripMarkdown(event.description);
      const remainingChars = 300 - details.length;
      if (remainingChars > 10) {
        metaDescription += `. ${cleanDescription.substring(0, remainingChars)}${cleanDescription.length > remainingChars ? '...' : ''}`;
      }
    } else if (!metaDescription) {
      metaDescription = `Join us for ${metaTitle}! RSVP now.`;
    }

    const twitterCard = hasCustomImage ? 'summary_large_image' : 'summary';

    // ---- Fetch original SPA HTML and rewrite meta tags ----
    const originalResponse = await fetch(request.url, {
      headers: {
        // Override user-agent so this request doesn't re-trigger the middleware
        'User-Agent': 'RSVPizza-OG-Rewriter',
        Accept: 'text/html',
      },
    });

    let html = await originalResponse.text();

    // Replace <title>
    html = html.replace(
      /<title>[^<]*<\/title>/,
      `<title>${escapeHtml(metaTitle)} | RSV.Pizza</title>`
    );

    // Replace meta name="title"
    html = html.replace(
      /<meta\s+name="title"\s+content="[^"]*"\s*\/?>/,
      `<meta name="title" content="${escapeHtml(metaTitle)}" />`
    );

    // Replace meta name="description"
    html = html.replace(
      /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/,
      `<meta name="description" content="${escapeHtml(metaDescription)}" />`
    );

    // Replace OG tags
    html = html.replace(
      /<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/,
      `<meta property="og:url" content="${pageUrl}" />`
    );
    html = html.replace(
      /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/,
      `<meta property="og:title" content="${escapeHtml(metaTitle)}" />`
    );
    html = html.replace(
      /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/,
      `<meta property="og:description" content="${escapeHtml(metaDescription)}" />`
    );
    html = html.replace(
      /<meta\s+property="og:image"\s+content="[^"]*"\s*\/?>/,
      `<meta property="og:image" content="${ogImageUrl}" />`
    );

    // Replace Twitter tags
    html = html.replace(
      /<meta\s+name="twitter:card"\s+content="[^"]*"\s*\/?>/,
      `<meta name="twitter:card" content="${twitterCard}" />`
    );
    html = html.replace(
      /<meta\s+name="twitter:url"\s+content="[^"]*"\s*\/?>/,
      `<meta name="twitter:url" content="${pageUrl}" />`
    );
    html = html.replace(
      /<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/,
      `<meta name="twitter:title" content="${escapeHtml(metaTitle)}" />`
    );
    html = html.replace(
      /<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?>/,
      `<meta name="twitter:description" content="${escapeHtml(metaDescription)}" />`
    );
    html = html.replace(
      /<meta\s+name="twitter:image"\s+content="[^"]*"\s*\/?>/,
      `<meta name="twitter:image" content="${ogImageUrl}" />`
    );

    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    // On any error, fall through to normal SPA behavior
    console.error('OG middleware error:', error);
    return next();
  }
}

export const config = {
  matcher: [
    /*
     * Match all paths except static assets and internal routes.
     * The middleware itself further filters by bot user-agent.
     */
    '/((?!api|_next/static|_next/image|assets|favicon.ico|logo.png|party.svg).*)',
  ],
};
