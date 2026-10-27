import * as entriesService from '../services/entries.service.js';
import { listEntriesQuerySchema } from '../validators/entry.validator.js';

export const listEntries = async (req, res) => {
  const filters = listEntriesQuerySchema.parse(req.query);
  res.json(await entriesService.list(req.user.id, filters)); // { entries, totals }
};

export const createEntry = async (req, res) => {
  const entry = await entriesService.create(req.user.id, req.body);
  res.status(201).json({ entry });
};

export const updateEntry = async (req, res) => {
  const entry = await entriesService.update(req.user.id, req.params.id, req.body);
  res.json({ entry });
};

export const deleteEntry = async (req, res) => {
  await entriesService.remove(req.user.id, req.params.id);
  res.status(204).end();
};
