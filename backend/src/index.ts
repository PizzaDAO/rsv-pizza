import express from 'express';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { errorHandler } from './middleware/error.js';
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
import sponsorRoutes from './routes/sponsor.routes.js';
import budgetRoutes from './routes/budget.routes.js';
import checklistRoutes from './routes/checklist.routes.js';
import reportRoutes from './routes/report.routes.js';
import pageviewRoutes from './routes/pageview.routes.js';
import v1Routes from './routes/v1/index.js';
import { setupSwagger } from './swagger.js';
import aiPhoneRoutes from './routes/ai-phone.routes.js';
import underbossRoutes from './routes/underboss.routes.js';
import adminRoutes from './routes/admin.routes.js';

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
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests, please try again later' },
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
app.use('/api/admin', adminRoutes);          // Admin management routes
app.use('/api/underboss', underbossRoutes); // Underboss dashboard (token auth + admin routes)
app.use('/api/auth', authRoutes);
app.use('/api/parties', photoRoutes); // Photo routes first (some are public)
app.use('/api/parties', kitRoutes);   // Kit routes for party kit requests
app.use('/api/parties', donationRoutes); // Donation routes (some are public)
app.use('/api/parties', staffRoutes); // Staff routes (host only)
app.use('/api/parties', raffleRoutes); // Raffle routes before partyRoutes (has own auth per-route)
app.use('/api/parties', displayRoutes); // Display routes (host management, some public)
app.use('/api/parties', performerRoutes); // Performer/music routes
app.use('/api/parties', venueRoutes); // Venue routes (host only)
app.use('/api/parties', sponsorRoutes); // Sponsor CRM routes (host only)
app.use('/api/parties', budgetRoutes); // Budget routes (host only)
app.use('/api/parties', checklistRoutes); // Checklist routes (host only)
app.use('/api/parties', reportRoutes); // Report routes (includes public report viewing)
app.use('/api/parties', partyRoutes); // Party routes have global auth (must be last /api/parties router)
app.use('/api/rsvp', rsvpRoutes);
app.use('/api/user', userRoutes);
app.use('/api/events', pageviewRoutes); // Page view tracking (public, before eventRoutes)
app.use('/api/events', eventRoutes);
app.use('/api/nft', nftRoutes);
app.use('/api/gpp', gppRoutes);
app.use('/api/checkin', checkinRoutes);
app.use('/api/display', displayRoutes); // Public display viewer routes
app.use('/api/reports', reportRoutes); // Public report viewing via slug

// Public API v1 routes
app.use('/api/v1', v1Routes);

// Swagger documentation
setupSwagger(app);
app.use('/api/ai-phone', aiPhoneRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.1.0' });
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
