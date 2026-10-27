import api from './axios';

// Pass a clientId to only get that client's projects
export const getProjects = async (clientId) =>
  (await api.get('/projects', { params: clientId ? { clientId } : {} })).data.projects;

export const createProject = async (data) => (await api.post('/projects', data)).data.project;

export const updateProject = async (id, data) => (await api.patch(`/projects/${id}`, data)).data.project;

export const deleteProject = (id) => api.delete(`/projects/${id}`);
