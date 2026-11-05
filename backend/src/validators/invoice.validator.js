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
  status: z.enum(['draft', 'sent', 'overdue', 'paid'], { error: 'status must be draft, sent, overdue or paid' }).optional(),
  clientId: z.string().regex(OBJECT_ID_REGEX, 'clientId is not a valid id').optional(),
});

// POST /api/invoices/:id/send. Empty strings count as "not given" (a form sends them for empty fields).
const emptyToUndefined = (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value);
const emailAddress = (label) =>
  z.string({ error: `${label} must be an email address` }).trim().pipe(z.email(`${label} must be a valid email address`));

export const sendInvoiceSchema = z.object({
  to: z.preprocess(emptyToUndefined, emailAddress('Recipient').optional()),
  cc: z.array(emailAddress('CC address'), { error: 'CC must be a list of email addresses' }).max(5, 'At most 5 people can be copied').optional(),
  message: z.preprocess(emptyToUndefined, z.string({ error: 'The message must be text' }).trim().max(1000, 'The message must be at most 1000 characters').optional()),
});

// PATCH /api/invoices/:id/reminders: pause or resume the automatic reminders of one invoice
export const pauseRemindersSchema = z.object({
  paused: z.boolean({ error: 'paused must be true or false' }),
});
