import api from './axios';

// Each call returns the response body: { timer, serverTime } (stop returns { entry, serverTime })
export const getTimer = async () => (await api.get('/timer')).data;

export const startTimer = async (data) => (await api.post('/timer/start', data)).data;

export const stopTimer = async () => (await api.post('/timer/stop')).data;

export const updateTimer = async (data) => (await api.patch('/timer', data)).data;
