import api from './axios';

// "Who owes me what". All of it is worked out by the server in the user's own time zone.

// The dashboard: { currency, outstanding, overdue, paidThisMonth, avgDaysToPay, aging }
export const getReceivablesSummary = async () => (await api.get('/receivables/summary')).data.summary;

// One row per client, the most overdue first: [{ client, outstanding, overdueAmount, unbilledAmount, ... }]
export const getReceivablesClients = async () => (await api.get('/receivables/clients')).data.clients;

// One client: { client, metrics, unbilled, invoices, lastPayments }. Rejects with 404 for a client that isn't yours.
export const getClientOverview = async (id) => (await api.get(`/clients/${id}/overview`)).data;
