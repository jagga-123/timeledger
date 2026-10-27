import { z } from 'zod';

const dateParam = (label) =>
  z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), `${label} must be a valid date`)
    .transform((value) => new Date(value))
    .optional();

// GET /api/entries?from=<ISO date-time>&to=<ISO date-time>
export const listEntriesQuerySchema = z.object({
  from: dateParam('from'),
  to: dateParam('to'),
});
