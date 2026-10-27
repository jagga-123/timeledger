import { z } from 'zod';
import { OBJECT_ID_REGEX } from '../utils/objectId.js';

const name = z
  .string({ error: 'Name is required' })
  .trim()
  .min(2, 'Name must be at least 2 characters')
  .max(80, 'Name must be at most 80 characters');

const clientId = z
  .string({ error: 'Client is required' })
  .regex(OBJECT_ID_REGEX, 'Client is required');

const hourlyRate = z
  .number({
    error: (issue) =>
      issue.input === undefined ? 'Hourly rate is required' : 'Hourly rate must be a number',
  })
  .min(0, 'Hourly rate cannot be negative')
  .max(10000, 'Hourly rate cannot be more than 10000');

const color = z
  .string({ error: 'Pick a valid color' })
  .regex(/^#[0-9a-fA-F]{6}$/, 'Pick a valid color');

export const createProjectSchema = z.object({
  name,
  clientId,
  hourlyRate,
  color: color.optional(),
});

export const updateProjectSchema = createProjectSchema
  .partial()
  .extend({ archived: z.boolean({ error: 'Archived must be true or false' }).optional() });
