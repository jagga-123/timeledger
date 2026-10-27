import Client from '../models/Client.js';
import Project from '../models/Project.js';
import { HttpError, conflictOnDuplicate } from '../utils/httpError.js';
import { isValidObjectId } from '../utils/objectId.js';

const DUPLICATE_MESSAGE = 'This client already has a project with this name';

const findOwnProject = async (req) => {
  const project = await Project.findOne({ _id: req.params.id, userId: req.user.id });
  if (!project) {
    throw new HttpError(404, 'Project not found');
  }
  return project;
};

// A project can only point at one of the user's own clients
const assertOwnClient = async (req, clientId) => {
  const client = await Client.exists({ _id: clientId, userId: req.user.id });
  if (!client) {
    throw new HttpError(400, 'Client not found');
  }
};

export const listProjects = async (req, res) => {
  const { clientId } = req.query;
  if (clientId !== undefined && !isValidObjectId(clientId)) {
    throw new HttpError(400, 'Invalid id');
  }

  const filter = { userId: req.user.id };
  if (clientId) filter.clientId = clientId;

  const projects = await Project.find(filter)
    .populate('client', 'name')
    .collation({ locale: 'en' })
    .sort({ name: 1 });
  res.json({ projects });
};

export const createProject = async (req, res) => {
  await assertOwnClient(req, req.body.clientId);

  const project = await Project.create({ ...req.body, userId: req.user.id }).catch(
    conflictOnDuplicate(DUPLICATE_MESSAGE)
  );
  await project.populate('client', 'name');
  res.status(201).json({ project });
};

export const updateProject = async (req, res) => {
  const project = await findOwnProject(req);
  if (req.body.clientId) {
    await assertOwnClient(req, req.body.clientId);
  }

  project.set(req.body);
  await project.save().catch(conflictOnDuplicate(DUPLICATE_MESSAGE));
  await project.populate('client', 'name');
  res.json({ project });
};

export const deleteProject = async (req, res) => {
  const project = await findOwnProject(req);
  await project.deleteOne();
  res.status(204).end();
};
