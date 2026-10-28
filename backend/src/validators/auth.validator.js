import { z } from 'zod';
import { isValidTimeZone } from '../utils/timezone.js';

const email = z
  .string({ error: 'Email is required' })
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address'));

const name = z
  .string({ error: 'Name is required' })
  .trim()
  .min(2, 'Name must be at least 2 characters')
  .max(50, 'Name must be at most 50 characters');

export const registerSchema = z.object({
  name,
  email,
  password: z
    .string({ error: 'Password is required' })
    .min(8, 'Password must be at least 8 characters'),
});

// PATCH /api/auth/me: change any of the name, the time zone and the rounding rule (at least one)
export const updateMeSchema = z
  .object({
    name: name.optional(),
    timezone: z
      .string({ error: 'Time zone must be text' })
      .trim()
      .refine(isValidTimeZone, 'Unknown time zone')
      .optional(),
    roundingMinutes: z
      .union([z.literal(0), z.literal(15)], { error: 'Rounding must be 0 (off) or 15 minutes' })
      .optional(),
  })
  .refine((changes) => Object.keys(changes).length > 0, {
    error: 'Send at least one of name, timezone or roundingMinutes',
  });

export const loginSchema = z.object({
  email,
  password: z.string({ error: 'Password is required' }).min(1, 'Password is required'),
});
