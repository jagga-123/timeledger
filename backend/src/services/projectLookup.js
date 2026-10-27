import Project from '../models/Project.js';
import { HttpError } from '../utils/httpError.js';

// Time can only be tracked on one of the user's own projects that isn't archived
export const findUsableProject = async (userId, projectId) => {
  const project = await Project.findOne({ _id: projectId, userId, archived: false });
  if (!project) {
    throw new HttpError(400, 'Project not found', [{ path: 'projectId', message: 'Project not found' }]);
  }
  return project;
};
