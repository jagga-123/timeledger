import crypto from 'node:crypto';

// The scheduler is not a user, so it proves itself with a shared secret in the X-Cron-Secret header.
// Both sides are hashed first, so the comparison takes the same time whatever is guessed (and lengths never differ).
const digest = (value) => crypto.createHash('sha256').update(String(value)).digest();

export const requireCronSecret = (req, res, next) => {
  const expected = process.env.CRON_SECRET || '';

  // Not set up (or still the placeholder from .env.example, which everybody can read): nothing is accepted, not even an empty header
  if (expected.length < 16 || expected.startsWith('replace-with')) {
    return res.status(503).json({ message: 'CRON_SECRET is not set up on the server' });
  }
  if (!crypto.timingSafeEqual(digest(req.get('X-Cron-Secret') || ''), digest(expected))) {
    return res.status(401).json({ message: 'Invalid cron secret' });
  }
  next();
};
