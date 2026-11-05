import { getReminders, sendNow, setPaused } from '../services/reminder.service.js';

// The invoice page: what the reminders did, what comes next, and whether they are paused
export const getInvoiceReminders = async (req, res) => {
  res.json(await getReminders(req.user.id, req.params.id));
};

// "Send reminder now"
export const sendReminderNow = async (req, res) => {
  res.json(await sendNow(req.user.id, req.params.id)); // { sentTo, reminder }
};

// Pause or resume the automatic reminders of one invoice
export const pauseReminders = async (req, res) => {
  res.json({ invoice: await setPaused(req.user.id, req.params.id, req.body.paused) });
};
