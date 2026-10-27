import { Router } from 'express';
import { listEntries } from '../controllers/entry.controller.js';
import { protect } from '../middleware/auth.js';

const router = Router();

router.use(protect);

router.get('/', listEntries);

export default router;
