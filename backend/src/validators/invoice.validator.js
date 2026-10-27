import { z } from 'zod';
import { OBJECT_ID_REGEX } from '../utils/objectId.js';

const clientId = z
  .string({ error: 'Client is required' })
  .regex(OBJECT_ID_REGEX, 'Client is required');

const date = (label) => z.iso.date({ error: `${label} must be a date like 2026-03-31` });

// Whether from <= to, the 366 day limit and "not after today" depend on the user's time zone,
// so the service checks those.
export const previewInvoiceSchema = z.object({
  clientId,
  from: date('From date'),
  to: date('To date'),
});

export const createInvoiceSchema = previewInvoiceSchema.extend({
  notes: z.string({ error: 'Notes must be text' }).trim().max(500, 'Notes must be at most 500 characters').optional(),
});

export const updateInvoiceStatusSchema = z.object({
  status: z.enum(['draft', 'sent', 'paid'], { error: 'Status must be draft, sent or paid' }),
});

// GET /api/invoices?status=&clientId=
export const listInvoicesQuerySchema = z.object({
  status: z.enum(['draft', 'sent', 'paid'], { error: 'status must be draft, sent or paid' }).optional(),
  clientId: z.string().regex(OBJECT_ID_REGEX, 'clientId is not a valid id').optional(),
});
