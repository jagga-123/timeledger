import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getPublicInvoice } from '../controllers/public.controller.js';

const router = Router();

// Nobody is logged in here, so limit what one address can ask for (stops guessing links and scraping)
const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many requests. Please try again in a minute.' },
});

router.get('/invoices/:token', limiter, getPublicInvoice);

export default router;
