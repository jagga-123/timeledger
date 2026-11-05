import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

// One line per project. Everything is copied in at the time of invoicing, so changing a rate or a name
// later never changes an invoice that already exists.
const lineItemSchema = new mongoose.Schema(
  {
    projectId: { type: ObjectId, ref: 'Project', required: true },
    projectName: { type: String, required: true },
    hourlyRate: { type: Number, required: true },
    rawSeconds: { type: Number, required: true }, // the time that was tracked
    billedSeconds: { type: Number, required: true }, // what is billed: rawSeconds, with each entry rounded up if rounding was on
    hours: { type: Number, required: true }, // billedSeconds / 3600, 2 decimals
    amount: { type: Number, required: true }, // billedSeconds / 3600 * hourlyRate, 2 decimals
  },
  { _id: false }
);

const invoiceSchema = new mongoose.Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true },
    clientId: { type: ObjectId, ref: 'Client', required: true },
    number: { type: String, required: true }, // "INV-0001"

    // The dates the user picked, "YYYY-MM-DD" in `timezone`
    periodStart: { type: String, required: true },
    periodEnd: { type: String, required: true },
    timezone: { type: String, required: true },

    status: { type: String, enum: ['draft', 'sent', 'paid'], default: 'draft' },
    issuedAt: { type: Date, required: true },
    dueDate: { type: Date, required: true },
    sentAt: { type: Date, default: null }, // the first time it was sent (by email here, or marked as sent by hand)
    paidAt: { type: Date, default: null },

    // Sending and sharing. publicToken is the secret part of the link /i/:token that lets the client see the
    // invoice without logging in. It is made when the invoice is first sent (or a share link is asked for) and is
    // left out of every owner response (see toJSON): the link is given as shareUrl instead.
    publicToken: { type: String },
    viewedAt: { type: Date, default: null }, // the first time the client opened the link; never overwritten
    lastSentAt: { type: Date, default: null }, // the latest email (an invoice can be sent again)
    sentTo: { type: String, default: '' },
    sentCc: [{ type: String }],

    // Payment reminders (see services/reminder.service.js). Paused: no automatic reminders for this invoice.
    remindersPaused: { type: Boolean, default: false },
    lastReminderAt: { type: Date, default: null }, // the latest reminder, automatic or manual

    // Snapshots
    client: {
      name: { type: String, required: true },
      email: { type: String, default: '' },
      company: { type: String, default: '' },
    },
    from: {
      name: { type: String, required: true },
      email: { type: String, required: true },
    },
    // The rounding rule that was on when the invoice was created (0 = none); changing the setting later never changes it
    roundingMinutes: { type: Number, enum: [0, 15], default: 0 },
    lineItems: [lineItemSchema],
    entryIds: [{ type: ObjectId, ref: 'TimeEntry' }],

    subtotal: { type: Number, required: true },
    total: { type: Number, required: true },
    currency: { type: String, required: true },
    notes: { type: String, trim: true, maxlength: 500, default: '' },
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        delete ret.__v;
        delete ret.publicToken;
        return ret;
      },
    },
  }
);

// An invoice number is unique per user
invoiceSchema.index({ userId: 1, number: 1 }, { unique: true });
invoiceSchema.index({ userId: 1, issuedAt: -1 });
// A share token identifies exactly one invoice (most invoices have none, so only strings are indexed)
invoiceSchema.index({ publicToken: 1 }, { unique: true, partialFilterExpression: { publicToken: { $type: 'string' } } });

export default mongoose.model('Invoice', invoiceSchema);
