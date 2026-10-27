import Project from '../models/Project.js';
import TimeEntry from '../models/TimeEntry.js';
import { HttpError } from '../utils/httpError.js';

// The running timer lives in the database (an entry with endedAt: null), never in the browser.
// All times come from this server's clock, so every device sees the same start time.

const ALREADY_RUNNING = 'A timer is already running. Stop it first.';
const NOT_RUNNING = 'No timer is running';

const withDetails = (query) => query.populate('project', 'name color').populate('client', 'name');

// A timer can only be started on one of the user's own projects that isn't archived
const findUsableProject = async (userId, projectId) => {
  const project = await Project.findOne({ _id: projectId, userId, archived: false });
  if (!project) {
    throw new HttpError(400, 'Project not found');
  }
  return project;
};

export const getRunning = (userId) => withDetails(TimeEntry.findOne({ userId, endedAt: null }));

export const start = async (userId, { projectId, description, billable }) => {
  const project = await findUsableProject(userId, projectId);

  let entry;
  try {
    entry = await TimeEntry.create({
      userId,
      projectId: project._id,
      clientId: project.clientId,
      description,
      billable,
      startedAt: new Date(), // server time, never a time sent by the client
      source: 'timer',
    });
  } catch (err) {
    // The unique index only allows one entry with endedAt: null per user. This also covers
    // two start requests arriving at the same moment, where both passed any "is one running?" check.
    if (err.code === 11000) {
      throw new HttpError(409, ALREADY_RUNNING);
    }
    throw err;
  }

  return withDetails(TimeEntry.findById(entry._id));
};

export const stop = async (userId) => {
  const endedAt = new Date();

  // One atomic update that matches only a still-running timer, so two stop requests can't both succeed.
  // The duration is calculated by the database from the stored startedAt.
  const entry = await withDetails(
    TimeEntry.findOneAndUpdate(
      { userId, endedAt: null },
      [
        {
          $set: {
            endedAt,
            updatedAt: endedAt,
            durationSeconds: {
              $max: [0, { $floor: { $divide: [{ $subtract: [endedAt, '$startedAt'] }, 1000] } }],
            },
          },
        },
      ],
      // Mongoose 9 only accepts an update pipeline (an array) when this flag is set
      { returnDocument: 'after', updatePipeline: true }
    )
  );

  if (!entry) {
    throw new HttpError(404, NOT_RUNNING);
  }
  return entry;
};

// Edit the running timer only; a stopped entry doesn't match the filter
export const updateRunning = async (userId, { projectId, description, billable }) => {
  const changes = {};
  if (description !== undefined) changes.description = description;
  if (billable !== undefined) changes.billable = billable;
  if (projectId !== undefined) {
    const project = await findUsableProject(userId, projectId);
    changes.projectId = project._id;
    changes.clientId = project.clientId;
  }

  const entry = await withDetails(
    TimeEntry.findOneAndUpdate(
      { userId, endedAt: null },
      { $set: changes },
      { returnDocument: 'after', runValidators: true }
    )
  );

  if (!entry) {
    throw new HttpError(404, NOT_RUNNING);
  }
  return entry;
};

// Stopped entries in a date range, newest first
export const listStopped = (userId, { from, to }) => {
  const filter = { userId, endedAt: { $ne: null } };
  if (from || to) {
    filter.startedAt = {};
    if (from) filter.startedAt.$gte = from;
    if (to) filter.startedAt.$lt = to;
  }
  return withDetails(TimeEntry.find(filter).sort({ startedAt: -1 }).limit(500));
};
