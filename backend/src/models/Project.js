import mongoose from 'mongoose';
import { roundToCents } from '../utils/money.js';

const projectSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
    name: { type: String, required: true, trim: true },
    hourlyRate: { type: Number, required: true, min: 0, max: 10000, set: roundToCents },
    color: { type: String, default: '#4F46E5', match: /^#[0-9a-fA-F]{6}$/ },
    archived: { type: Boolean, default: false },
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

// One project name per client (case-insensitive)
projectSchema.index(
  { userId: 1, clientId: 1, name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } }
);

// project.client = { _id, name } when populated with .populate('client', 'name')
projectSchema.virtual('client', {
  ref: 'Client',
  localField: 'clientId',
  foreignField: '_id',
  justOne: true,
});

export default mongoose.model('Project', projectSchema);
