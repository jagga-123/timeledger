import api from './axios';

// data: { clientId, from, to } with dates as "YYYY-MM-DD" in the user's time zone (both days included)

// What an invoice would contain, without saving anything. Rejects with 400 when nothing is left to bill.
export const previewInvoice = async (data) => (await api.post('/invoices/preview', data)).data.preview;

export const createInvoice = async (data) => (await api.post('/invoices', data)).data.invoice;

export const getInvoices = async () => (await api.get('/invoices')).data.invoices;

// Returns { invoice, entries }
export const getInvoice = async (id) => (await api.get(`/invoices/${id}`)).data;

export const updateInvoiceStatus = async (id, status) => (await api.patch(`/invoices/${id}/status`, { status })).data.invoice;

export const deleteInvoice = (id) => api.delete(`/invoices/${id}`);
