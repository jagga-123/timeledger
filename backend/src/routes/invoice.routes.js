import { Router } from 'express';
import {
  previewInvoice,
  createInvoice,
  listInvoices,
  getInvoice,
  updateInvoiceStatus,
  deleteInvoice,
  sendInvoice,
  getShareLink,
  regenerateShareLink,
} from '../controllers/invoice.controller.js';
import { protect } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { validateObjectId } from '../middleware/validateObjectId.js';
import {
  previewInvoiceSchema,
  createInvoiceSchema,
  updateInvoiceStatusSchema,
  sendInvoiceSchema,
} from '../validators/invoice.validator.js';

const router = Router();

router.use(protect);
router.param('id', validateObjectId);

router.get('/', listInvoices);
router.post('/preview', validate(previewInvoiceSchema), previewInvoice);
router.post('/', validate(createInvoiceSchema), createInvoice);
router.get('/:id', getInvoice);
router.patch('/:id/status', validate(updateInvoiceStatusSchema), updateInvoiceStatus);
router.post('/:id/send', validate(sendInvoiceSchema), sendInvoice);
router.post('/:id/share-link', getShareLink);
router.post('/:id/share-link/regenerate', regenerateShareLink);
router.delete('/:id', deleteInvoice);

export default router;
