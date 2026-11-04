import Client from '../models/Client.js';
import Invoice from '../models/Invoice.js';
import User from '../models/User.js';
import { HttpError } from '../utils/httpError.js';
import { shareUrlFor } from '../utils/appUrl.js';
import { sendEmail } from './email.service.js';
import { renderInvoiceEmail } from './emailTemplates.js';
import { ensureShareToken } from './invoiceShare.service.js';
import { userZone, withDisplayStatus } from './invoiceStatus.js';

const LIST_FIELDS = '-lineItems -entryIds';

// Emails the invoice (with a link the client opens without logging in) and, when that works, marks it as sent.
// If the email can't be sent the invoice stays exactly as it was. Sending again is allowed (it only updates
// lastSentAt); a paid invoice can't be sent.
export const sendInvoice = async (userId, id, { to, cc = [], message }) => {
  const [user, invoice] = await Promise.all([User.findById(userId).select('name email'), Invoice.findOne({ _id: id, userId })]);
  if (!invoice) {
    throw new HttpError(404, 'Invoice not found');
  }
  if (invoice.status === 'paid') {
    throw new HttpError(409, 'This invoice is already paid');
  }

  // Who gets it: the address typed in, else the client's address as it is now, else the one copied on the invoice
  const client = await Client.findOne({ _id: invoice.clientId, userId }).select('email');
  const recipient = to || client?.email || invoice.client.email;
  if (!recipient) {
    throw new HttpError(400, "Add the client's email first", [{ path: 'to', message: "Add the client's email first" }]);
  }

  // The link has to work by the time the email arrives, so it is made before anything is sent
  const shareUrl = shareUrlFor(await ensureShareToken(userId, id));
  const { subject, html, text } = renderInvoiceEmail({ invoice, fromName: user.name, shareUrl, message });

  try {
    await sendEmail({
      to: recipient,
      cc,
      subject,
      html,
      text,
      replyTo: { email: user.email, name: user.name }, // the client's reply goes to the freelancer
      fromName: `${user.name} via ${process.env.EMAIL_FROM_NAME || 'TimeLedger'}`,
    });
  } catch (err) {
    console.error(`Sending invoice ${invoice.number} failed: ${err.message}`);
    throw new HttpError(502, "Couldn't send the email. Try again.");
  }

  // Only now does anything change. A draft becomes sent (sentAt = the first time); a sent invoice only gets a new lastSentAt.
  const now = new Date();
  const sent = { lastSentAt: now, sentTo: recipient, sentCc: cc };
  const options = { returnDocument: 'after' };
  const updated =
    (await Invoice.findOneAndUpdate({ _id: id, userId, status: 'draft' }, { $set: { ...sent, status: 'sent', sentAt: now } }, options).select(LIST_FIELDS)) ??
    (await Invoice.findOneAndUpdate({ _id: id, userId, status: 'sent' }, { $set: sent }, options).select(LIST_FIELDS));
  if (!updated) {
    throw new HttpError(409, 'This invoice is already paid'); // it was marked as paid while the email was on its way
  }

  return { invoice: withDisplayStatus(updated, await userZone(userId)), sentTo: recipient, shareUrl };
};
