import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

// One tracked block of time. A running timer is an entry with endedAt: null.
const timeEntrySchema = new mongoose.Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true },
    projectId: { type: ObjectId, ref: 'Project', required: true },
    // Copied from the project so invoice queries don't need a join
    clientId: { type: ObjectId, ref: 'Client', required: true },
    description: { type: String, trim: true, maxlength: 200, default: '' },
    billable: { type: Boolean, default: true },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, default: null },
    durationSeconds: { type: Number, default: 0, min: 0 },
    source: { type: String, enum: ['timer', 'manual'], default: 'timer' },
    invoiceId: { type: ObjectId, ref: 'Invoice', default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        delete ret.id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// The database itself allows only ONE running timer per user (entries with endedAt: null),
// even when two requests arrive at the same moment from two devices.
timeEntrySchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { endedAt: null } });

// For listing a user's entries by date
timeEntrySchema.index({ userId: 1, startedAt: -1 });

// entry.project = { _id, name, color } and entry.client = { _id, name } when populated
timeEntrySchema.virtual('project', {
  ref: 'Project',
  localField: 'projectId',
  foreignField: '_id',
  justOne: true,
});
timeEntrySchema.virtual('client', {
  ref: 'Client',
  localField: 'clientId',
  foreignField: '_id',
  justOne: true,
});

export default mongoose.model('TimeEntry', timeEntrySchema);
