import { z } from 'zod';
import { OBJECT_ID_REGEX } from '../utils/objectId.js';
import { projectId, description, billable } from './timer.validator.js';

// A full ISO timestamp such as 2026-03-10T09:30:00+05:30 or ...Z, turned into a Date
const dateTime = (label) =>
  z.iso
    .datetime({
      offset: true,
      error: (issue) =>
        issue.input === undefined ? `${label} is required` : `${label} must be a valid date and time`,
    })
    .transform((value) => new Date(value));

// Whether endedAt is after startedAt, within 24 hours and not in the future is checked in the service,
// because an edit may send only one of the two times.
export const createEntrySchema = z.object({
  projectId,
  startedAt: dateTime('Start time'),
  endedAt: dateTime('End time'),
  description: description.optional(),
  billable: billable.optional(),
});

export const updateEntrySchema = createEntrySchema.partial();

// ----- GET /api/entries?from=&to=&clientId=&projectId=&billable=&status= -----

const dateParam = (label) =>
  z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), `${label} must be a valid date`)
    .transform((value) => new Date(value))
    .optional();

const idParam = (label) =>
  z.string().regex(OBJECT_ID_REGEX, `${label} is not a valid id`).optional();

export const listEntriesQuerySchema = z.object({
  from: dateParam('from'),
  to: dateParam('to'),
  clientId: idParam('clientId'),
  projectId: idParam('projectId'),
  billable: z
    .enum(['true', 'false'], { error: 'billable must be true or false' })
    .transform((value) => value === 'true')
    .optional(),
  status: z
    .enum(['all', 'unbilled', 'billed'], { error: 'status must be all, unbilled or billed' })
    .default('all'),
});
