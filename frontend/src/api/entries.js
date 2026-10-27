import api from './axios';

// Stopped entries between two ISO date-times, newest first
export const getEntries = async ({ from, to }) =>
  (await api.get('/entries', { params: { from, to } })).data.entries;
