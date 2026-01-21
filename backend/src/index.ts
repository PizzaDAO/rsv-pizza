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
      origin.endsWith('.vercel.app')  // Allow Vercel preview deployments
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
app.use('/api/auth', authRoutes);
app.use('/api/parties', partyRoutes);
app.use('/api/rsvp', rsvpRoutes);
app.use('/api/user', userRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/nft', nftRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
