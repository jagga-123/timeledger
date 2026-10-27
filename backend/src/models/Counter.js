import mongoose from 'mongoose';

// A per-user counter, used for invoice numbers (INV-0001, INV-0002, ...).
// It is only ever incremented, so a number is never handed out twice, even after an invoice is deleted.
const counterSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

counterSchema.index({ userId: 1, name: 1 }, { unique: true });

export default mongoose.model('Counter', counterSchema);
