import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    // Used later to decide which day a time entry belongs to in the weekly timesheet
    timezone: { type: String, default: 'Asia/Kolkata' },
    currency: { type: String, default: 'USD' },
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
