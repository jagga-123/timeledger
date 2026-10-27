import { Router } from 'express';
import {
  listClients,
  createClient,
  updateClient,
  deleteClient,
} from '../controllers/client.controller.js';
import { protect } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { validateObjectId } from '../middleware/validateObjectId.js';
import { createClientSchema, updateClientSchema } from '../validators/client.validator.js';

const router = Router();

router.use(protect);
router.param('id', validateObjectId);

router.get('/', listClients);
router.post('/', validate(createClientSchema), createClient);
router.patch('/:id', validate(updateClientSchema), updateClient);
router.delete('/:id', deleteClient);

export default router;
