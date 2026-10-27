import { z } from 'zod';
import { OBJECT_ID_REGEX } from '../utils/objectId.js';

const projectId = z
  .string({ error: 'Project is required' })
  .regex(OBJECT_ID_REGEX, 'Project is required');

const description = z
  .string({ error: 'Description must be text' })
  .trim()
  .max(200, 'Description must be at most 200 characters');

const billable = z.boolean({ error: 'Billable must be true or false' });

// Anything else in the body (for example a startedAt) is dropped, so the client can't choose the start time
export const startTimerSchema = z.object({
  projectId,
  description: description.optional(),
  billable: billable.optional(),
});

export const updateTimerSchema = startTimerSchema.partial();
