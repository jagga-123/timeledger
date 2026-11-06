import { Router } from 'express';
import { getSummary, getClients } from '../controllers/receivables.controller.js';
import { protect } from '../middleware/auth.js';

const router = Router();

router.use(protect);

router.get('/summary', getSummary);
router.get('/clients', getClients);

export default router;
