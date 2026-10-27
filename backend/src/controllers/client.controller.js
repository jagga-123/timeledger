import mongoose from 'mongoose';
import Client from '../models/Client.js';
import Project from '../models/Project.js';
import { HttpError, conflictOnDuplicate } from '../utils/httpError.js';

const DUPLICATE_MESSAGE = 'You already have a client with this name';

// Every lookup is scoped to the logged-in user, so someone else's id behaves like a missing one
const findOwnClient = async (req) => {
  const client = await Client.findOne({ _id: req.params.id, userId: req.user.id });
  if (!client) {
    throw new HttpError(404, 'Client not found');
  }
  return client;
};

export const listClients = async (req, res) => {
  const [clients, projectCounts] = await Promise.all([
    Client.find({ userId: req.user.id }).select('-__v').collation({ locale: 'en' }).sort({ name: 1 }).lean(),
    Project.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(req.user.id) } },
      { $group: { _id: '$clientId', count: { $sum: 1 } } },
    ]),
  ]);

  const countByClient = new Map(projectCounts.map(({ _id, count }) => [String(_id), count]));
  res.json({
    clients: clients.map((client) => ({
      ...client,
      projectCount: countByClient.get(String(client._id)) || 0,
    })),
  });
};

export const createClient = async (req, res) => {
  const client = await Client.create({ ...req.body, userId: req.user.id }).catch(
    conflictOnDuplicate(DUPLICATE_MESSAGE)
  );
  res.status(201).json({ client });
};

export const updateClient = async (req, res) => {
  const client = await findOwnClient(req);
  client.set(req.body);
  await client.save().catch(conflictOnDuplicate(DUPLICATE_MESSAGE));
  res.json({ client });
};

export const deleteClient = async (req, res) => {
  const client = await findOwnClient(req);

  const hasProjects = await Project.exists({ userId: req.user.id, clientId: client._id });
  if (hasProjects) {
    throw new HttpError(409, "Delete or move this client's projects first");
  }

  await client.deleteOne();
  res.status(204).end();
};
