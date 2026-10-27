import { z } from 'zod';

const name = z
  .string({ error: 'Name is required' })
  .trim()
  .min(2, 'Name must be at least 2 characters')
  .max(80, 'Name must be at most 80 characters');

// An empty string is allowed so the form can clear the email
const email = z
  .string({ error: 'Enter a valid email address' })
  .trim()
  .toLowerCase()
  .refine((value) => value === '' || z.email().safeParse(value).success, 'Enter a valid email address');

const company = z
  .string({ error: 'Company must be text' })
  .trim()
  .max(80, 'Company must be at most 80 characters');

export const createClientSchema = z.object({
  name,
  email: email.optional(),
  company: company.optional(),
});

export const updateClientSchema = createClientSchema
  .partial()
  .extend({ archived: z.boolean({ error: 'Archived must be true or false' }).optional() });
