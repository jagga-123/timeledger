import { Router } from 'express';
import {
  getTimer,
  startTimer,
  stopTimer,
  updateTimer,
} from '../controllers/timer.controller.js';
import { protect } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { startTimerSchema, updateTimerSchema } from '../validators/timer.validator.js';

const router = Router();

router.use(protect);

router.get('/', getTimer);
router.post('/start', validate(startTimerSchema), startTimer);
router.post('/stop', stopTimer);
router.patch('/', validate(updateTimerSchema), updateTimer);

export default router;
