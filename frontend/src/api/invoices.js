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

// Emails the invoice and marks it as sent. data: { to?, cc?: [], message? }. Returns { invoice, sentTo, shareUrl }.
export const sendInvoice = async (id, data) => (await api.post(`/invoices/${id}/send`, data)).data;

// The link a client opens without logging in (made now if there is none). Returns the full address.
export const getShareLink = async (id) => (await api.post(`/invoices/${id}/share-link`)).data.shareUrl;

// A new link; the old one stops working
export const regenerateShareLink = async (id) => (await api.post(`/invoices/${id}/share-link/regenerate`)).data.shareUrl;

// No login needed: what a client sees at /i/:token
export const getPublicInvoice = async (token) => (await api.get(`/public/invoices/${token}`)).data.invoice;
