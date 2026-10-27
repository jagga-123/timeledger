import { z } from 'zod';
import { OBJECT_ID_REGEX } from '../utils/objectId.js';

// These three fields are shared with the time entry validators
export const projectId = z
  .string({ error: 'Project is required' })
  .regex(OBJECT_ID_REGEX, 'Project is required');

export const description = z
  .string({ error: 'Description must be text' })
  .trim()
  .max(200, 'Description must be at most 200 characters');

export const billable = z.boolean({ error: 'Billable must be true or false' });

// Anything else in the body (for example a startedAt) is dropped, so the client can't choose the start time
export const startTimerSchema = z.object({
  projectId,
  description: description.optional(),
  billable: billable.optional(),
});

export const updateTimerSchema = startTimerSchema.partial();
