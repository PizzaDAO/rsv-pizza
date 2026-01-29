import { Router } from 'express';
import partiesRouter from './parties.js';
import guestsRouter from './guests.js';
import webhooksRouter from './webhooks.js';
import keysRouter from './keys.js';
import adminRouter from './admin.js';
import { logApiRequest } from '../../middleware/apiKey.js';

const router = Router();

// Log all API requests
router.use(logApiRequest());

// Mount routes
router.use('/parties', partiesRouter);
router.use('/webhooks', webhooksRouter);
router.use('/keys', keysRouter);
router.use('/admin', adminRouter);

// Guests routes are nested under parties but we export them separately
// for mounting as /parties/:partyId/guests
export { guestsRouter };

export default router;
