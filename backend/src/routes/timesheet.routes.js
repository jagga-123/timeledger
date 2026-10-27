import { Router } from 'express';
import { getTimesheet } from '../controllers/timesheet.controller.js';
import { protect } from '../middleware/auth.js';

const router = Router();

router.use(protect);

router.get('/', getTimesheet);

export default router;
