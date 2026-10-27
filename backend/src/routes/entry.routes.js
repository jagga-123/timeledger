import { Router } from 'express';
import {
  listEntries,
  createEntry,
  updateEntry,
  deleteEntry,
} from '../controllers/entry.controller.js';
import { protect } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { validateObjectId } from '../middleware/validateObjectId.js';
import { createEntrySchema, updateEntrySchema } from '../validators/entry.validator.js';

const router = Router();

router.use(protect);
router.param('id', validateObjectId);

router.get('/', listEntries);
router.post('/', validate(createEntrySchema), createEntry);
router.patch('/:id', validate(updateEntrySchema), updateEntry);
router.delete('/:id', deleteEntry);

export default router;
