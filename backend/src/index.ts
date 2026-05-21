import express from 'express';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { errorHandler } from './middleware/error.js';
import { prisma } from './config/database.js';

// Serialize BigInt as string in JSON. The only BigInt in the schema today is
// parties.host_telegram_chat_id, which is sensitive enough that we never want
// it leaking to clients via an implicit-select endpoint anyway — but several
// existing endpoints do `res.json({ ...party })` on Prisma results without an
// explicit select, and Express's default res.json throws on a raw BigInt.
// The frontend's dbPartyToParty mapper already calls String() on this field,
// so emitting it as a string here matches what the client expects.
(BigInt.prototype as any).toJSON = function () { return this.toString(); };
import authRoutes from './routes/auth.routes.js';
import partyRoutes from './routes/party.routes.js';
import rsvpRoutes from './routes/rsvp.routes.js';
import userRoutes from './routes/user.routes.js';
import eventRoutes from './routes/event.routes.js';
import nftRoutes from './routes/nft.routes.js';
import photoRoutes from './routes/photo.routes.js';
import kitRoutes from './routes/kit.routes.js';
import gppRoutes from './routes/gpp.routes.js';
import donationRoutes from './routes/donation.routes.js';
import checkinRoutes from './routes/checkin.routes.js';
import displayRoutes from './routes/display.routes.js';
import raffleRoutes from './routes/raffle.routes.js';
import staffRoutes from './routes/staff.routes.js';
import performerRoutes from './routes/performer.routes.js';
import venueRoutes from './routes/venue.routes.js';
import venuePhotoRoutes from './routes/venue-photo.routes.js';
import venueReportRoutes from './routes/venue-report.routes.js';
import sponsorRoutes from './routes/sponsor.routes.js';
import partnerIntakeRoutes from './routes/partner-intake.routes.js';
import budgetRoutes from './routes/budget.routes.js';
import payoutRoutes from './routes/payout.routes.js';
import checklistRoutes from './routes/checklist.routes.js';
import reportRoutes from './routes/report.routes.js';
import leaderboardRoutes from './routes/leaderboard.routes.js';
import publicLeaderboardRoutes from './routes/publicLeaderboard.routes.js';
import pageviewRoutes from './routes/pageview.routes.js';
import linkclickRoutes from './routes/linkclick.routes.js';
import funnelRoutes from './routes/funnel.routes.js';
import v1Routes from './routes/v1/index.js';
import { setupSwagger } from './swagger.js';
import aiPhoneRoutes from './routes/ai-phone.routes.js';
import telegramRoutes from './routes/telegram.routes.js';
import telegramWebhookRoutes from './routes/telegram-webhook.routes.js';
import hostTelegramRoutes from './routes/host-telegram.routes.js';
import underbossRoutes from './routes/underboss.routes.js';
import shippingRoutes from './routes/shipping.routes.js';
import adminRoutes from './routes/admin.routes.js';
import adminPayoutRoutes, { payoutWalletRouter } from './routes/admin-payout.routes.js';
import graphicsAdminRoutes from './routes/graphics-admin.routes.js';
import logoAuditRoutes from './routes/logoAudit.routes.js';
import { sponsorUserAdminRouter, sponsorDashboardRouter } from './routes/sponsor-user.routes.js';
import preferencesRoutes from './routes/preferences.routes.js';
import quizTemplateRoutes from './routes/quiz-template.routes.js';
import { quizHostRouter, quizPublicRouter } from './routes/quiz.routes.js';
import onesheetRoutes from './routes/onesheet.routes.js';
import scorecardRoutes from './routes/scorecard.routes.js';
import citiesRoutes from './routes/cities.routes.js';
import resendWebhookRouter from './routes/webhooks.resend.routes.js';
import ensRoutes from './routes/ens.routes.js';

const app = express();
const PORT = process.env.PORT || 3006;

// Trust proxy for Vercel serverless (trust first proxy)
app.set('trust proxy', 1);

// Allowed origins for CORS
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : [
      'https://rsv.pizza',
      'https://www.rsv.pizza',
      'https://globalpizza.party',
      'https://www.globalpizza.party',
      'http://localhost:5173',  // Vite dev server
      'http://localhost:5176',  // Vite dev server (alt port)
      'http://localhost:3000',
    ];

// Middleware
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);

    // Check against whitelist or Vercel preview URLs
    if (
      ALLOWED_ORIGINS.includes(origin) ||
      /^https:\/\/rsvpizza.*\.vercel\.app$/.test(origin)  // Allow RSVPizza Vercel preview deployments only
    ) {
      return callback(null, true);
    }

    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
// Resend webhook MUST be mounted BEFORE express.json() so its per-route
// express.raw() handler sees the unparsed body bytes that Svix signed.
// bounce-rate-heuristic.
app.use('/api/webhooks/resend', resendWebhookRouter);

// Logo-cleanup upload accepts base64-encoded images up to ~5 MB raw
// (~6.7 MB base64). Must be registered BEFORE the global express.json()
// below, or the global 100 KB default fires first.
app.use('/api/admin/logo-bg-audit', express.json({ limit: '8mb' }));

app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // limit each IP to 500 requests per windowMs
  message: { error: 'You\'ve been rate limited. Please wait a few minutes before trying again.' },
  standardHeaders: true,
  legacyHeaders: false,
  // Skip rate limit validation errors
  validate: false,
});
app.use('/api', limiter);

// Stricter rate limit for RSVP submissions (prevent spam)
const rsvpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50, // 50 RSVPs per hour per IP
  message: { error: 'Too many RSVP submissions, please try again later' },
});
app.use('/api/rsvp', rsvpLimiter);

// Routes
app.use('/api/admin/logo-bg-audit', logoAuditRoutes); // Graphics-admin logo cleanup (before /api/admin catch-all)
app.use('/api/admin/payouts', adminPayoutRoutes); // Host payouts admin dashboard (before /api/admin catch-all)
app.use('/api/admin/payout-wallet', payoutWalletRouter); // coppa-91827: hot wallet address + balances (before /api/admin catch-all)
app.use('/api/admin', adminRoutes);          // Admin management routes
app.use('/api/graphics-admin', graphicsAdminRoutes); // Graphics admin management
app.use('/api/telegram/webhook', telegramWebhookRoutes); // Telegram inbound webhook (no auth — secret-token header gate)
app.use('/api/underboss/telegram', telegramRoutes); // Telegram broadcast (before underboss catch-all)
app.use('/api/underboss', underbossRoutes); // Underboss dashboard (token auth + admin routes)
app.use('/api/sponsor-users', sponsorUserAdminRouter); // Sponsor user admin management
app.use('/api/sponsor-users', quizTemplateRoutes); // Quiz template CRUD (admin)
app.use('/api/sponsor', sponsorDashboardRouter); // Sponsor dashboard (login-based auth)
app.use('/api/shipping', shippingRoutes); // Shipping coordinator dashboard
app.use('/api/auth', authRoutes);
app.use('/api/parties', photoRoutes); // Photo routes first (some are public)
app.use('/api/parties', hostTelegramRoutes); // Host Telegram connect/disconnect routes (host only)
app.use('/api/parties', kitRoutes);   // Kit routes for party kit requests
app.use('/api/parties', donationRoutes); // Donation routes (some are public)
app.use('/api/parties', staffRoutes); // Staff routes (host only)
app.use('/api/parties', raffleRoutes); // Raffle routes before partyRoutes (has own auth per-route)
app.use('/api/parties', displayRoutes); // Display routes (host management, some public)
app.use('/api/parties', performerRoutes); // Performer/music routes
app.use('/api/parties', venuePhotoRoutes); // Venue photo routes (host only)
app.use('/api/parties', venueReportRoutes); // Venue report routes (includes public)
app.use('/api/parties', venueRoutes); // Venue routes (host only)
app.use('/api/partner-intake', partnerIntakeRoutes); // Public partner intake form routes
app.use('/api/parties', sponsorRoutes); // Sponsor CRM routes (host only)
app.use('/api/parties', budgetRoutes); // Budget routes (host only)
app.use('/api/parties', payoutRoutes); // Payout/reimbursement routes (host only, before partyRoutes)
app.use('/api/parties', checklistRoutes); // Checklist routes (host only)
app.use('/api/parties', reportRoutes); // Report routes (includes public report viewing)
app.use('/api/parties', leaderboardRoutes); // quattro-71244: gamified dashboard leaderboard (host only, before partyRoutes)
app.use('/api/parties', quizHostRouter); // Quiz CRUD routes (host only, before partyRoutes)
app.use('/api/parties', partyRoutes); // Party routes have global auth (must be last /api/parties router)
app.use('/api/rsvp', rsvpRoutes);
app.use('/api/preferences', preferencesRoutes); // Public preferences (used during RSVP)
app.use('/api/user', userRoutes);
app.use('/api/events', pageviewRoutes); // Page view tracking (public, before eventRoutes)
app.use('/api/events', linkclickRoutes); // Link click tracking (public, before eventRoutes)
app.use('/api/events', funnelRoutes); // RSVP funnel tracking (public)
app.use('/api/events', quizPublicRouter); // Public quiz endpoints (before eventRoutes)
app.use('/api/events', onesheetRoutes); // One Sheet interest form (public, before eventRoutes)
app.use('/api/events', eventRoutes);
app.use('/api/nft', nftRoutes);
app.use('/api/gpp', gppRoutes);
app.use('/api/cities', citiesRoutes); // Public list of cities hosting GPP events
app.use('/api/leaderboard', publicLeaderboardRoutes); // stromboli-71593: public /leaderboard ranking GPP parties + countries
app.use('/api/ens', ensRoutes); // taleggio-30219: ENS → 0x resolution utility (auth-optional)
app.use('/api/checkin', checkinRoutes);
app.use('/api/scorecard', scorecardRoutes);
app.use('/api/display', displayRoutes); // Public display viewer routes
app.use('/api/reports', reportRoutes); // Public report viewing via slug
app.use('/api/reports', venueReportRoutes); // Public venue report viewing via slug

// Public API v1 routes
app.use('/api/v1', v1Routes);

// Swagger documentation
setupSwagger(app);
app.use('/api/ai-phone', aiPhoneRoutes);

// Health check — calabrese-58204: now includes a DB round-trip so external
// uptime monitors can detect connection-pool exhaustion / DB-saturation
// incidents like the 2026-05-19 outage instead of seeing a healthy app
// process sitting on a dead pool.
app.get('/api/health', async (_req, res) => {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const dbMs = Date.now() - start;
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.1.0',
      dbMs,
      degraded: dbMs > 1000,
    });
  } catch (e: any) {
    res.status(503).json({
      status: 'degraded',
      timestamp: new Date().toISOString(),
      error: e?.code || 'DB_UNREACHABLE',
      dbMs: Date.now() - start,
    });
  }
});

// API documentation page
app.get('/api', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RSV.Pizza API</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace; background: #0a0a0a; color: #e0e0e0; padding: 2rem; max-width: 900px; margin: 0 auto; line-height: 1.6; }
  h1 { color: #ff393a; font-size: 2rem; margin-bottom: 0.5rem; }
  h2 { color: #ff393a; font-size: 1.3rem; margin: 2rem 0 1rem; border-bottom: 1px solid #222; padding-bottom: 0.5rem; }
  h3 { color: #ccc; font-size: 1rem; margin: 1.5rem 0 0.5rem; }
  p, li { color: #aaa; }
  a { color: #ff393a; text-decoration: none; }
  a:hover { text-decoration: underline; }
  code { background: #1a1a1a; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; color: #f0f0f0; }
  pre { background: #111; border: 1px solid #222; border-radius: 8px; padding: 1rem; overflow-x: auto; margin: 0.5rem 0 1rem; font-size: 0.85em; line-height: 1.5; }
  pre code { background: none; padding: 0; }
  .endpoint { background: #111; border: 1px solid #222; border-radius: 8px; padding: 1rem 1.2rem; margin: 0.75rem 0; }
  .method { display: inline-block; background: #1a3a1a; color: #4ade80; padding: 2px 8px; border-radius: 4px; font-weight: 700; font-size: 0.8em; margin-right: 0.5rem; }
  .path { color: #f0f0f0; font-family: monospace; font-size: 0.95em; }
  .param { color: #facc15; }
  .desc { color: #888; font-size: 0.9em; margin-top: 0.3rem; }
  .badge { display: inline-block; background: #1a1a2e; color: #818cf8; padding: 2px 8px; border-radius: 4px; font-size: 0.75em; margin-left: 0.5rem; }
  .note { background: #1a1a0a; border: 1px solid #333; border-radius: 8px; padding: 0.75rem 1rem; margin: 1rem 0; font-size: 0.9em; color: #cca; }
  ul { padding-left: 1.5rem; margin: 0.5rem 0; }
  li { margin: 0.25rem 0; }
  .subtitle { color: #666; font-size: 1rem; margin-bottom: 2rem; }
</style>
</head>
<body>

<h1>RSV.Pizza API</h1>
<p class="subtitle">Public API for accessing Global Pizza Party events</p>

<div class="note">
  Base URL: <code>https://api.rsv.pizza</code><br>
  All responses are JSON. No authentication required for public endpoints.<br>
  Responses are cached for 5 minutes.
</div>

<h2>Events</h2>

<div class="endpoint">
  <span class="method">GET</span>
  <span class="path">/api/gpp/events</span>
  <span class="badge">public</span>
  <p class="desc">List all Global Pizza Party events. Supports filtering.</p>
</div>

<h3>Query Parameters</h3>
<ul>
  <li><code><span class="param">city</span></code> — Filter by city name (case-insensitive, partial match). Example: <code>?city=london</code></li>
  <li><code><span class="param">country</span></code> — Filter by country (case-insensitive, partial match). Example: <code>?country=nigeria</code></li>
  <li><code><span class="param">region</span></code> — Filter by region slug. Example: <code>?region=western-europe</code></li>
  <li><code><span class="param">limit</span></code> — Max results (default: 500, max: 500)</li>
  <li><code><span class="param">offset</span></code> — Pagination offset (default: 0)</li>
</ul>

<h3>Regions</h3>
<p><code>usa</code>, <code>canada</code>, <code>central-america</code>, <code>south-america</code>, <code>western-europe</code>, <code>eastern-europe</code>, <code>india</code>, <code>china</code>, <code>asia</code>, <code>middle-east</code>, <code>west-africa</code>, <code>east-africa</code>, <code>south-africa</code>, <code>oceania</code></p>

<h3>Example Request</h3>
<pre><code>curl https://api.rsv.pizza/api/gpp/events?country=brazil</code></pre>

<h3>Response</h3>
<pre><code>{
  "events": [
    {
      "id": "abc123",
      "name": "Global Pizza Party S\u00e3o Paulo",
      "city": "S\u00e3o Paulo",
      "customUrl": "saopaulo",
      "inviteCode": "abc123",
      "url": "https://rsv.pizza/saopaulo",
      "date": "2026-05-22T21:00:00.000Z",
      "endTime": "2026-05-23T00:00:00.000Z",
      "timezone": "America/Sao_Paulo",
      "country": "Brazil",
      "region": "south-america",
      "address": "R. Example 123, S\u00e3o Paulo",
      "venueName": "Pizza Place",
      "latitude": -23.5505,
      "longitude": -46.6333,
      "eventImageUrl": "https://...",
      "guestCount": 42,
      "rsvpOpen": true
    }
  ],
  "total": 4,
  "limit": 500,
  "offset": 0
}</code></pre>

<h2>Single Event by City</h2>

<div class="endpoint">
  <span class="method">GET</span>
  <span class="path">/api/gpp/events/by-city/<span class="param">:citySlug</span></span>
  <span class="badge">public</span>
  <p class="desc">Look up a single GPP event by its city URL slug (lowercase, no spaces).</p>
</div>

<h3>Example</h3>
<pre><code>curl https://api.rsv.pizza/api/gpp/events/by-city/london</code></pre>

<h3>Response</h3>
<pre><code>{
  "event": {
    "name": "Global Pizza Party London",
    "city": "London",
    "customUrl": "london",
    "url": "https://rsv.pizza/london",
    "date": "2026-05-22T17:00:00.000Z",
    "endTime": "2026-05-22T20:00:00.000Z",
    "timezone": "Europe/London",
    "country": "United Kingdom",
    "region": "western-europe",
    "guestCount": 87,
    "rsvpOpen": true
  }
}</code></pre>

<h2>Single Event by Slug</h2>

<div class="endpoint">
  <span class="method">GET</span>
  <span class="path">/api/events/<span class="param">:slug</span></span>
  <span class="badge">public</span>
  <p class="desc">Get full public details for any event (not just GPP) by invite code or custom URL.</p>
</div>

<h3>Example</h3>
<pre><code>curl https://api.rsv.pizza/api/events/london</code></pre>

<h2>Partners</h2>

<div class="endpoint">
  <span class="method">GET</span>
  <span class="path">/api/gpp/partners</span>
  <span class="badge">public</span>
  <p class="desc">Aggregated partner logos across all approved Global Pizza Party events. Deduplicated by normalized logo URL with a fallback on normalized name. Cached for 10 minutes.</p>
</div>

<h3>Example Request</h3>
<pre><code>curl https://api.rsv.pizza/api/gpp/partners</code></pre>

<h3>Response</h3>
<pre><code>{
  "partners": [
    {
      "name": "PizzaDAO",
      "logoUrl": "https://...",
      "website": "https://pizzadao.org",
      "brandDescription": "PizzaDAO is a community of pizza enthusiasts...",
      "brandTwitter": "PizzaDAO",
      "brandInstagram": "rare.pizzas",
      "category": "community",
      "eventCount": 423,
      "events": [
        { "slug": "london", "city": "London", "sponsorId": "clz0a1b2c3d4e5f6g7h8i9j0" },
        { "slug": "saopaulo", "city": "São Paulo", "sponsorId": "clz0k1l2m3n4o5p6q7r8s9t0" }
      ]
    }
  ],
  "total": 47,
  "generatedAt": "2026-05-15T12:34:56.789Z"
}</code></pre>

<h2>Health Check</h2>

<div class="endpoint">
  <span class="method">GET</span>
  <span class="path">/api/health</span>
  <span class="badge">public</span>
  <p class="desc">Returns API status and version.</p>
</div>

<div class="note" style="margin-top: 2rem;">
  <strong>Rate limits:</strong> 500 requests per 15 minutes per IP.<br>
  <strong>Questions?</strong> Reach out on <a href="https://t.me/pizzadao">Telegram</a> or email <a href="mailto:hello@rarepizzas.com">hello@rarepizzas.com</a>.
</div>

<p style="margin-top: 2rem; color: #444; font-size: 0.8em;">Powered by <a href="https://rsv.pizza" style="color: #555;">RSV.Pizza</a></p>

</body>
</html>`);
});

// Error handler (must be last)
app.use(errorHandler);

// Start server (only in non-Vercel environments)
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

// Export for Vercel
export default app;
