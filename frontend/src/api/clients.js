import api from './axios';

export const getClients = async () => (await api.get('/clients')).data.clients;

export const createClient = async (data) => (await api.post('/clients', data)).data.client;

export const updateClient = async (id, data) => (await api.patch(`/clients/${id}`, data)).data.client;

export const deleteClient = (id) => api.delete(`/clients/${id}`);
