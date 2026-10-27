import api from './axios';

// params: { from, to (ISO), clientId, projectId, billable ("true"/"false"), status ("unbilled"/"billed") }.
// Returns { entries, totals }: finished entries newest first, and totals for those same entries.
export const getEntries = async (params) => (await api.get('/entries', { params })).data;

export const createEntry = async (data) => (await api.post('/entries', data)).data.entry;

export const updateEntry = async (id, data) => (await api.patch(`/entries/${id}`, data)).data.entry;

export const deleteEntry = (id) => api.delete(`/entries/${id}`);
