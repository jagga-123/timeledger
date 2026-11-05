import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    // Used later to decide which day a time entry belongs to in the weekly timesheet
    timezone: { type: String, default: 'Asia/Kolkata' },
    currency: { type: String, default: 'USD' },
    // 0 = bill the exact time; 15 = each entry is rounded up to the next 15 minutes when an invoice is created
    roundingMinutes: { type: Number, enum: [0, 15], default: 0 },

    // Automatic payment reminders for invoices that were sent and are not paid (see services/reminder.service.js).
    // beforeDueDays: 0 = no reminder before the due date. afterDueDays: days after the due date, at most 3.
    reminders: {
      enabled: { type: Boolean, default: true },
      beforeDueDays: { type: Number, default: 3, min: 0, max: 14 },
      onDueDate: { type: Boolean, default: true },
      afterDueDays: { type: [Number], default: () => [7, 14] },
    },

    // How the client can pay: all optional, shown on invoice e-mails, reminders and the public invoice page
    payment: {
      link: { type: String, default: '' }, // a Stripe, PayPal or Razorpay payment link (https only)
      upiId: { type: String, default: '' },
      bankDetails: { type: String, default: '' },
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        delete ret.passwordHash;
        delete ret.__v;
        return ret;
      },
    },
  }
);

export default mongoose.model('User', userSchema);
