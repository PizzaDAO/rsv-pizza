import express from 'express';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { errorHandler } from './middleware/error.js';
import authRoutes from './routes/auth.routes.js';
import partyRoutes from './routes/party.routes.js';
import rsvpRoutes from './routes/rsvp.routes.js';
import userRoutes from './routes/user.routes.js';

const app = express();
const PORT = process.env.PORT || 3006;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5176',
  credentials: true,
}));
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests, please try again later' },
});
app.use('/api', limiter);

// Stricter rate limit for RSVP submissions (prevent spam)
const rsvpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 RSVPs per hour per IP
  message: { error: 'Too many RSVP submissions, please try again later' },
});
app.use('/api/rsvp', rsvpLimiter);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/parties', partyRoutes);
app.use('/api/rsvp', rsvpRoutes);
app.use('/api/user', userRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handler (must be last)
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
