import { run } from '../services/reminder.service.js';

// Called by the hourly scheduler (see .github/workflows/reminders.yml). Safe to call as often as you like.
export const runReminders = async (req, res) => {
  const result = await run();
  res.json({ ...result, ranAt: new Date().toISOString() });
};
