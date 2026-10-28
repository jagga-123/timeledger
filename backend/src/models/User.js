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
