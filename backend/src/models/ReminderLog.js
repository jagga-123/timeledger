import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

// One row for every payment reminder that is being, or was, sent. The row is the CLAIM: it is inserted BEFORE
// the e-mail goes out, and the unique index below lets only one insert win, so the same reminder can never be
// sent twice, even when the job runs twice or two runs overlap.
const reminderLogSchema = new mongoose.Schema(
  {
    invoiceId: { type: ObjectId, ref: 'Invoice', required: true },
    userId: { type: ObjectId, ref: 'User', required: true },
    // before_due, on_due and overdue come from the schedule; manual is "Send reminder now" (any number of times, see the service)
    kind: { type: String, enum: ['before_due', 'on_due', 'overdue', 'manual'], required: true },
    // before_due: days before the due date. overdue: days after it. on_due: 0. A manual reminder has none.
    offsetDays: { type: Number },
    sentAt: { type: Date }, // when it went out; empty while sending and when it failed
    to: { type: String, default: '' },
    status: { type: String, enum: ['sending', 'sent', 'failed'], default: 'sending' },
    attempts: { type: Number, default: 1 }, // a failed one is tried again later, a few times
    error: { type: String, default: '' },
  },
  { timestamps: true }
);

// A scheduled reminder (it has an offsetDays) exists once per invoice. Manual ones have no offsetDays, so they are not in this index.
reminderLogSchema.index(
  { invoiceId: 1, kind: 1, offsetDays: 1 },
  { unique: true, partialFilterExpression: { offsetDays: { $type: 'number' } } }
);
reminderLogSchema.index({ invoiceId: 1, createdAt: -1 });

export default mongoose.model('ReminderLog', reminderLogSchema);
