import * as timerService from '../services/timer.service.js';
import { listEntriesQuerySchema } from '../validators/entry.validator.js';

// Minimal for now (the dashboard's "Today" list); Step 5 expands entries
export const listEntries = async (req, res) => {
  const { from, to } = listEntriesQuerySchema.parse(req.query);
  const entries = await timerService.listStopped(req.user.id, { from, to });
  res.json({ entries });
};
