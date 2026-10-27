import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import generateToken from '../utils/generateToken.js';

export const register = async (req, res) => {
  const { name, email, password } = req.body;
  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const user = await User.create({ name, email, passwordHash });
    res.status(201).json({ user, token: generateToken(user) });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'Email is already registered' });
    }
    throw err;
  }
};

export const login = async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });
  const passwordMatches = user && (await bcrypt.compare(password, user.passwordHash));
  if (!passwordMatches) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  res.json({ user, token: generateToken(user) });
};

export const getMe = (req, res) => {
  res.json({ user: req.user });
};
