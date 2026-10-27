import jwt from 'jsonwebtoken';
import User from '../models/User.js';

// Protects a route: verifies the Bearer token and attaches the user to req.user
export const protect = async (req, res, next) => {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }

  const user = await User.findById(payload.id);
  if (!user) {
    return res.status(401).json({ message: 'User no longer exists' });
  }

  req.user = user;
  next();
};
