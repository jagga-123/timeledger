import { z } from 'zod';

// GET /api/timesheet?weekStart=2026-03-09
// Only the format is checked here; "must be a Monday" is checked in the service.
export const timesheetQuerySchema = z.object({
  weekStart: z.iso.date({ error: 'weekStart must be a date like 2026-03-09' }).optional(),
});
