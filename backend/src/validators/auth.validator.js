import { z } from 'zod';
import { isValidTimeZone } from '../utils/timezone.js';

const email = z
  .string({ error: 'Email is required' })
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address'));

export const registerSchema = z.object({
  name: z
    .string({ error: 'Name is required' })
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(50, 'Name must be at most 50 characters'),
  email,
  password: z
    .string({ error: 'Password is required' })
    .min(8, 'Password must be at least 8 characters'),
});

// PATCH /api/auth/me: for now only the time zone can be changed
export const updateMeSchema = z.object({
  timezone: z
    .string({ error: 'Time zone is required' })
    .trim()
    .refine(isValidTimeZone, 'Unknown time zone'),
});

export const loginSchema = z.object({
  email,
  password: z.string({ error: 'Password is required' }).min(1, 'Password is required'),
});
