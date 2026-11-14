import { Router, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';

const router = Router();

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// guest-oracles (guests-anon-exposure PR3): preferences are keyed by email, so the
// old public endpoint let anyone read or overwrite anyone's preferences. Both routes
// now require a logged-in user and only ever touch the caller's own row (the email
// in the JWT). A `?email=` / body `email` is still accepted for old bundles, but it
// must match the caller's email or the request is refused (403).
// D6: logged-out RSVPers no longer get preferences prefilled or saved.

function callerEmail(req: AuthRequest): string | null {
  const email = req.userEmail?.trim().toLowerCase();
  return email && email.includes('@') ? email : null;
}

function sameEmail(a: unknown, b: string): boolean {
  return typeof a === 'string' && a.trim().toLowerCase() === b;
}

// Escape LIKE wildcards so an ILIKE lookup is an exact, case-insensitive match.
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// POST /api/preferences - upsert the caller's own preferences (auth required)
router.post('/', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const email = callerEmail(req);
    if (!email) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { email: bodyEmail, preferences } = req.body ?? {};

    if (!preferences || typeof preferences !== 'object') {
      return res.status(400).json({ error: 'preferences are required' });
    }

    if (bodyEmail !== undefined && !sameEmail(bodyEmail, email)) {
      return res.status(403).json({ error: 'You can only save your own preferences' });
    }

    const { error } = await supabaseAdmin
      .from('user_preferences')
      .upsert({
        email,
        dietary_restrictions: preferences.dietary_restrictions || [],
        liked_toppings: preferences.liked_toppings || [],
        disliked_toppings: preferences.disliked_toppings || [],
        liked_beverages: preferences.liked_beverages || [],
        disliked_beverages: preferences.disliked_beverages || [],
        updated_at: new Date().toISOString(),
      }, { onConflict: 'email' });

    if (error) {
      console.error('Error saving user preferences:', error);
      return res.status(500).json({ error: 'Failed to save preferences' });
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// GET /api/preferences - the caller's own preferences (auth required)
router.get('/', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const email = callerEmail(req);
    if (!email) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const queryEmail = req.query.email;
    if (queryEmail !== undefined && !sameEmail(queryEmail, email)) {
      return res.status(403).json({ error: 'You can only read your own preferences' });
    }

    // Older rows were saved with the email as typed on the RSVP form (mixed case),
    // so match case-insensitively and take the most recently updated row.
    // PostgREST also treats `*` in an ilike pattern as `%`, so the ILIKE is only a
    // pre-filter: rows are re-checked for an exact (normalized) email match below.
    const { data, error } = await supabaseAdmin
      .from('user_preferences')
      .select('email, dietary_restrictions, liked_toppings, disliked_toppings, liked_beverages, disliked_beverages')
      .ilike('email', escapeLike(email))
      .order('updated_at', { ascending: false, nullsFirst: false })
      .limit(20);

    if (error) {
      console.error('Error loading user preferences:', error);
      return res.status(500).json({ error: 'Failed to load preferences' });
    }

    const own = (data ?? []).find(
      (row: { email?: unknown }) => typeof row.email === 'string' && row.email.trim().toLowerCase() === email
    );
    if (!own) {
      return res.json({ preferences: null });
    }
    const { email: _rowEmail, ...preferences } = own;
    res.json({ preferences });
  } catch (error) {
    next(error);
  }
});

export default router;
