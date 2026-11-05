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

// ----- payment reminders -----

const reminderDays = (label, min, max) =>
  z.number({ error: `${label} must be a number` }).int(`${label} must be a whole number of days`).min(min, `${label} must be between ${min} and ${max}`).max(max, `${label} must be between ${min} and ${max}`);

const remindersSchema = z
  .object({
    enabled: z.boolean({ error: 'Reminders must be on or off' }).optional(),
    beforeDueDays: reminderDays('Days before the due date', 0, 14).optional(), // 0 = no reminder before the due date
    onDueDate: z.boolean({ error: 'On the due date must be on or off' }).optional(),
    afterDueDays: z
      .array(reminderDays('Days after the due date', 1, 60), { error: 'Days after the due date must be a list of numbers' })
      .max(3, 'At most 3 reminders after the due date')
      .refine((days) => new Set(days).size === days.length, 'Each day can only be used once')
      .transform((days) => [...days].sort((a, b) => a - b))
      .optional(),
  })
  .refine((changes) => Object.keys(changes).length > 0, { error: 'Send at least one reminder setting' });

// ----- payment details (all optional; an empty string removes one) -----

const cleanText = (value) =>
  typeof value === 'string' ? value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim() : value;

// A payment link must be a full https address without a password in it, so a button can never run script or leak a login
const isPaymentLink = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.includes('.') && !url.username && !url.password && !/\s/.test(value);
  } catch {
    return false;
  }
};

const optionalText = (schema) => z.preprocess(cleanText, z.union([z.literal(''), schema]));

const paymentSchema = z
  .object({
    link: optionalText(z.string().max(500, 'The payment link must be at most 500 characters').refine(isPaymentLink, 'Payment link must be a full https:// address, like https://rzp.io/l/yourname')).optional(),
    upiId: optionalText(z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,255}@[a-zA-Z][a-zA-Z0-9.]{1,63}$/, 'UPI ID must look like name@bank, for example alex@okhdfcbank')).optional(),
    bankDetails: optionalText(z.string().max(500, 'Bank details must be at most 500 characters')).optional(),
  })
  .refine((changes) => Object.keys(changes).length > 0, { error: 'Send at least one payment detail' });

// PATCH /api/auth/me: change any of the name, the time zone, the rounding rule, the reminder settings and the payment details (at least one)
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
    reminders: remindersSchema.optional(),
    payment: paymentSchema.optional(),
  })
  .refine((changes) => Object.keys(changes).length > 0, {
    error: 'Send at least one of name, timezone, roundingMinutes, reminders or payment',
  });

export const loginSchema = z.object({
  email,
  password: z.string({ error: 'Password is required' }).min(1, 'Password is required'),
});
