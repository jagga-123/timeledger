import mongoose from 'mongoose';

const clientSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    company: { type: String, trim: true },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// One client name per user (case-insensitive: "Acme" and "acme" clash)
clientSchema.index({ userId: 1, name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

export default mongoose.model('Client', clientSchema);
