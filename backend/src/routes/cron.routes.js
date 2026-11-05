import { Router } from 'express';
import { runReminders } from '../controllers/cron.controller.js';
import { requireCronSecret } from '../middleware/cronSecret.js';

const router = Router();

// No login: protected by the shared secret instead
router.post('/reminders', requireCronSecret, runReminders);

export default router;
