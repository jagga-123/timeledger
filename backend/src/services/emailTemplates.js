// The e-mails about an invoice: the one that sends it, and the reminders. Each has an HTML version (table layout
// and inline styles, because e-mail programs ignore most of CSS) and a plain-text version. Everything that comes
// from a person is escaped.

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatMoney = (amount, currency) => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);

const formatDate = (date, timeZone) =>
  new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(date));

const INDIGO = '#4F46E5';
const GREEN = '#059669';
const FONT = "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

// ----- how to pay: a "Pay now" button when there is a payment link, and the UPI ID and bank details below it -----

export const hasPaymentDetails = (payment) => Boolean(payment && (payment.link || payment.upiId || payment.bankDetails));

const button = (href, label, color) => `            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 16px;">
              <tr>
                <td align="center" style="border-radius:8px;background:${color};">
                  <a href="${escapeHtml(href)}" style="display:inline-block;padding:16px 40px;font-size:17px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(label)}</a>
                </td>
              </tr>
            </table>
`;

const paymentHtml = (payment) => {
  if (!hasPaymentDetails(payment)) return '';

  const otherWays =
    payment.upiId || payment.bankDetails
      ? `            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
              <tr>
                <td style="padding:14px 16px;font-size:14px;line-height:1.6;color:#334155;">
                  <div style="font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#64748b;">${payment.link ? 'Or pay another way' : 'How to pay'}</div>
${payment.upiId ? `                  <div style="margin-top:8px;">UPI ID: <strong>${escapeHtml(payment.upiId)}</strong></div>\n` : ''}${
          payment.bankDetails ? `                  <div style="margin-top:8px;white-space:pre-line;">${escapeHtml(payment.bankDetails)}</div>\n` : ''
        }                </td>
              </tr>
            </table>
`
      : '';

  return (payment.link ? button(payment.link, 'Pay now', GREEN) : '') + otherWays;
};

const paymentText = (payment) => {
  if (!hasPaymentDetails(payment)) return [];
  return [
    ...(payment.link ? ['Pay now:', payment.link, ''] : []),
    ...(payment.upiId ? [`UPI ID: ${payment.upiId}`] : []),
    ...(payment.bankDetails ? ['Bank details:', payment.bankDetails] : []),
    ...(payment.upiId || payment.bankDetails ? [''] : []),
  ];
};

// ----- the shared look -----

const layout = ({ subject, preheader, heading, introHtml = '', rows, shareUrl, payment, footer }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:24px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;font-family:${FONT};color:#0f172a;">
        <tr>
          <td style="padding:0 4px 16px;font-size:20px;font-weight:700;color:${INDIGO};">TimeLedger</td>
        </tr>
        <tr>
          <td style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:32px 28px;">
            <h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;font-weight:700;color:#0f172a;">${escapeHtml(heading)}</h1>
${introHtml}            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;border-top:1px solid #e2e8f0;">
${rows
  .map(
    ([label, value, big]) => `              <tr>
                <td style="padding:14px 0;font-size:14px;color:#64748b;border-bottom:1px solid #e2e8f0;">${escapeHtml(label)}</td>
                <td align="right" style="padding:14px 0;font-size:${big ? '22px' : '15px'};font-weight:${big ? '700' : '600'};color:#0f172a;border-bottom:1px solid #e2e8f0;">${escapeHtml(value)}</td>
              </tr>`
  )
  .join('\n')}
            </table>
${button(shareUrl, 'View invoice', INDIGO)}${paymentHtml(payment)}            <p style="margin:0;font-size:13px;line-height:1.6;color:#64748b;">If the button doesn't work, copy this link into your browser:<br><a href="${escapeHtml(shareUrl)}" style="color:${INDIGO};word-break:break-all;">${escapeHtml(shareUrl)}</a></p>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:16px 4px 0;font-size:12px;color:#94a3b8;">${escapeHtml(footer)}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

const paragraph = (text) => `            <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#334155;">${escapeHtml(text)}</p>\n`;

// ----- the e-mail that sends an invoice -----

export const renderInvoiceEmail = ({ invoice, fromName, shareUrl, message, payment }) => {
  const total = formatMoney(invoice.total, invoice.currency);
  const due = formatDate(invoice.dueDate, invoice.timezone);
  const subject = `Invoice ${invoice.number} from ${fromName}`;
  const note = (message || '').trim();

  const text = [
    `Invoice ${invoice.number} from ${fromName}`,
    '',
    ...(note ? [note, ''] : []),
    `Amount: ${total}`,
    `Due date: ${due}`,
    '',
    'View the invoice:',
    shareUrl,
    '',
    ...paymentText(payment),
    '-- Sent with TimeLedger',
  ].join('\n');

  const html = layout({
    subject,
    preheader: `${fromName} sent you invoice ${invoice.number} for ${total}, due ${due}.`,
    heading: `Invoice ${invoice.number} from ${fromName}`,
    introHtml: note
      ? `            <p style="margin:0 0 24px;padding:12px 16px;border-left:3px solid ${INDIGO};background:#f8fafc;font-size:15px;line-height:1.6;color:#334155;white-space:pre-line;">${escapeHtml(note)}</p>\n`
      : '',
    rows: [
      ['Amount', total, true],
      ['Due date', due],
    ],
    shareUrl,
    payment,
    footer: 'Sent with TimeLedger',
  });

  return { subject, html, text };
};

// ----- the reminders -----
// daysUntilDue is worked out on the day the reminder is sent: 3 = due in 3 days, 0 = due today, -7 = 7 days overdue.
// The words follow the real situation (a reminder that went out a day late still tells the truth).

export const reminderWording = (invoiceNumber, daysUntilDue) => {
  if (daysUntilDue > 0) return { subject: `Reminder: ${invoiceNumber} is due in ${plural(daysUntilDue, 'day')}`, heading: `Invoice ${invoiceNumber} is due in ${plural(daysUntilDue, 'day')}` };
  if (daysUntilDue === 0) return { subject: `${invoiceNumber} is due today`, heading: `Invoice ${invoiceNumber} is due today` };
  return { subject: `${invoiceNumber} is ${plural(-daysUntilDue, 'day')} overdue`, heading: `Invoice ${invoiceNumber} is ${plural(-daysUntilDue, 'day')} overdue` };
};

export const renderReminderEmail = ({ invoice, fromName, shareUrl, payment, daysUntilDue }) => {
  const total = formatMoney(invoice.total, invoice.currency);
  const due = formatDate(invoice.dueDate, invoice.timezone);
  const { subject, heading } = reminderWording(invoice.number, daysUntilDue);
  const greeting = `Hi ${invoice.client.name},`;

  const body =
    daysUntilDue > 0
      ? `Just a friendly reminder that invoice ${invoice.number} from ${fromName} for ${total} is due on ${due}.`
      : daysUntilDue === 0
        ? `Just a friendly reminder that invoice ${invoice.number} from ${fromName} for ${total} is due today.`
        : `Invoice ${invoice.number} from ${fromName} for ${total} was due on ${due}, so it is now ${plural(-daysUntilDue, 'day')} overdue. If you have already paid, thank you, and please ignore this message.`;
  const closing = `You can see the invoice below. If you have any questions, just reply to this e-mail to reach ${fromName}.`;

  const text = [
    heading,
    '',
    greeting,
    '',
    body,
    '',
    `Amount: ${total}`,
    `Due date: ${due}`,
    '',
    closing,
    '',
    'View the invoice:',
    shareUrl,
    '',
    ...paymentText(payment),
    `-- Sent with TimeLedger on behalf of ${fromName}`,
  ].join('\n');

  const html = layout({
    subject,
    preheader: `${body}`,
    heading,
    introHtml: paragraph(greeting) + paragraph(body) + paragraph(closing),
    rows: [
      ['Amount', total, true],
      ['Due date', due],
    ],
    shareUrl,
    payment,
    footer: `Sent with TimeLedger on behalf of ${fromName}`,
  });

  return { subject, html, text };
};
