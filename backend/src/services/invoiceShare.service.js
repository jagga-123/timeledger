import crypto from 'node:crypto';
import Invoice from '../models/Invoice.js';
import { HttpError } from '../utils/httpError.js';
import { shareUrlFor } from '../utils/appUrl.js';
import User from '../models/User.js';
import { usableZone } from '../utils/timezone.js';
import { hasPaymentDetails } from './emailTemplates.js';
import { withDisplayStatus } from './invoiceStatus.js';

// The share link /i/:token lets a client see ONE invoice without logging in. The token is 24 random bytes
// (192 bits), so it can't be guessed; whoever has the link can see the invoice, which is the point.

const newToken = () => crypto.randomBytes(24).toString('base64url');
const notFound = () => new HttpError(404, 'Invoice not found');

// Tries again on the (astronomically unlikely) chance that a token already exists
const withFreshToken = async (attempt) => {
  for (let tries = 0; tries < 3; tries++) {
    try {
      return await attempt(newToken());
    } catch (err) {
      if (err.code !== 11000) throw err;
    }
  }
  throw new HttpError(500, 'Could not make a share link');
};

// The invoice's token, made now if it has none. Safe when two requests ask at the same moment: the update only
// matches an invoice without a token, so only one token is ever stored and both callers get that one.
export const ensureShareToken = async (userId, id) => {
  const made = await withFreshToken((token) =>
    Invoice.findOneAndUpdate({ _id: id, userId, publicToken: null }, { $set: { publicToken: token } }, { returnDocument: 'after' }).select('publicToken')
  );
  if (made) return made.publicToken;

  const existing = await Invoice.findOne({ _id: id, userId }).select('publicToken');
  if (!existing) throw notFound();
  return existing.publicToken;
};

export const getShareUrl = async (userId, id) => shareUrlFor(await ensureShareToken(userId, id));

// A new token: the old link stops working at once. The new link has not been opened yet, so "viewed" starts again.
export const regenerateShareUrl = async (userId, id) => {
  const invoice = await withFreshToken((token) =>
    Invoice.findOneAndUpdate({ _id: id, userId }, { $set: { publicToken: token, viewedAt: null } }, { returnDocument: 'after' }).select('publicToken')
  );
  if (!invoice) throw notFound();
  return shareUrlFor(invoice.publicToken);
};

// What the client may see, and nothing else: no user id, no entry ids, no internal ids of any kind
export const getPublicInvoice = async (token) => {
  const invoice = await Invoice.findOne({ publicToken: token });
  if (!invoice) throw new HttpError(404, 'This invoice link is not valid');

  // The first visit is remembered; the filter makes sure a later visit never overwrites it
  await Invoice.updateOne({ _id: invoice._id, viewedAt: null }, { $set: { viewedAt: new Date() } });

  const owner = await User.findById(invoice.userId).select('timezone payment');
  const { displayStatus, daysOverdue } = withDisplayStatus(invoice, usableZone(owner?.timezone));

  // How to pay, as the owner has set it up now. Nothing to show when they set up nothing, or when it is already paid.
  const pay = owner?.payment;
  const payment =
    displayStatus !== 'paid' && hasPaymentDetails(pay)
      ? { link: pay.link || null, upiId: pay.upiId || null, bankDetails: pay.bankDetails || null }
      : null;

  return {
    number: invoice.number,
    displayStatus,
    daysOverdue,
    issuedAt: invoice.issuedAt,
    dueDate: invoice.dueDate,
    sentAt: invoice.sentAt,
    paidAt: invoice.paidAt,
    periodStart: invoice.periodStart,
    periodEnd: invoice.periodEnd,
    timezone: invoice.timezone,
    currency: invoice.currency,
    roundingMinutes: invoice.roundingMinutes ?? 0,
    from: { name: invoice.from.name, email: invoice.from.email },
    client: { name: invoice.client.name, email: invoice.client.email, company: invoice.client.company },
    lineItems: invoice.lineItems.map((line) => ({
      projectName: line.projectName,
      hourlyRate: line.hourlyRate,
      hours: line.hours,
      amount: line.amount,
    })),
    subtotal: invoice.subtotal,
    total: invoice.total,
    notes: invoice.notes,
    payment,
  };
};
