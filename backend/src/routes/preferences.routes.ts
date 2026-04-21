import { Router, Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';

const router = Router();

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// POST /api/preferences - upsert user preferences (public, no auth required)
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, preferences } = req.body;

    if (!email || !preferences) {
      return res.status(400).json({ error: 'email and preferences are required' });
    }

    // Basic email validation
    if (typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'Invalid email' });
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

// GET /api/preferences?email=... - get user preferences (public)
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const email = req.query.email as string;

    if (!email) {
      return res.status(400).json({ error: 'email query parameter is required' });
    }

    const { data, error } = await supabaseAdmin
      .from('user_preferences')
      .select('dietary_restrictions, liked_toppings, disliked_toppings, liked_beverages, disliked_beverages')
      .eq('email', email)
      .maybeSingle();

    if (error) {
      console.error('Error loading user preferences:', error);
      return res.status(500).json({ error: 'Failed to load preferences' });
    }

    res.json({ preferences: data });
  } catch (error) {
    next(error);
  }
});

export default router;
