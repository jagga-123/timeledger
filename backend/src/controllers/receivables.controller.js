import * as receivables from '../services/receivables.service.js';

// The dashboard's money cards, the overdue alert and the aging bar
export const getSummary = async (req, res) => {
  res.json({ summary: await receivables.summary(req.user.id) });
};

// One row per client: what they owe, what is overdue, what is not billed yet
export const getClients = async (req, res) => {
  res.json({ clients: await receivables.byClient(req.user.id) });
};

// GET /api/clients/:id/overview: the same numbers for one client, plus their invoices and last payments
export const getClientOverview = async (req, res) => {
  res.json(await receivables.clientDetail(req.user.id, req.params.id));
};
