import { next, rewrite } from '@vercel/edge';

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
];

function isCrawler(userAgent: string | null): boolean {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return CRAWLER_USER_AGENTS.some(crawler => ua.includes(crawler.toLowerCase()));
}

// Known paths that are NOT event pages
const KNOWN_PATHS = [
  '/api/',
  '/assets/',
  '/host/',
  '/rsvp/',
  '/auth/',
  '/parties',
  '/_next/',
];

export default function middleware(request: Request) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const userAgent = request.headers.get('user-agent');

  // Skip home page
  if (pathname === '/') {
    return next();
  }

  // Skip known paths and files with extensions
  if (KNOWN_PATHS.some(p => pathname.startsWith(p)) || pathname.includes('.') || pathname === '/parties') {
    return next();
  }

  // For potential event pages, check if this is a crawler
  if (isCrawler(userAgent)) {
    // Extract slug (remove leading slash)
    const slug = pathname.slice(1);
    // Rewrite to the static OG file generated at build time
    return rewrite(new URL(`/_og/${slug}.html`, request.url));
  }

  return next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - assets (static assets)
     * - favicon.ico, logo.png, etc.
     */
    '/((?!api|_next/static|_next/image|assets|favicon.ico|logo.png|party.svg).*)',
  ],
};
