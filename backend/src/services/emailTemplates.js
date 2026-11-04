// The email that goes with an invoice: an HTML version (table layout and inline styles, because email programs
// ignore most of CSS) and a plain-text version. Everything that comes from a person is escaped.

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
const FONT = "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";

export const renderInvoiceEmail = ({ invoice, fromName, shareUrl, message }) => {
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
    '-- Sent with TimeLedger',
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(`${fromName} sent you invoice ${invoice.number} for ${total}, due ${due}.`)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:24px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;font-family:${FONT};color:#0f172a;">
        <tr>
          <td style="padding:0 4px 16px;font-size:20px;font-weight:700;color:${INDIGO};">TimeLedger</td>
        </tr>
        <tr>
          <td style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:32px 28px;">
            <h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;font-weight:700;color:#0f172a;">Invoice ${escapeHtml(invoice.number)} from ${escapeHtml(fromName)}</h1>
${
  note
    ? `            <p style="margin:0 0 24px;padding:12px 16px;border-left:3px solid ${INDIGO};background:#f8fafc;font-size:15px;line-height:1.6;color:#334155;white-space:pre-line;">${escapeHtml(note)}</p>\n`
    : ''
}            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;border-top:1px solid #e2e8f0;">
              <tr>
                <td style="padding:14px 0;font-size:14px;color:#64748b;border-bottom:1px solid #e2e8f0;">Amount</td>
                <td align="right" style="padding:14px 0;font-size:22px;font-weight:700;color:#0f172a;border-bottom:1px solid #e2e8f0;">${escapeHtml(total)}</td>
              </tr>
              <tr>
                <td style="padding:14px 0;font-size:14px;color:#64748b;border-bottom:1px solid #e2e8f0;">Due date</td>
                <td align="right" style="padding:14px 0;font-size:15px;font-weight:600;color:#0f172a;border-bottom:1px solid #e2e8f0;">${escapeHtml(due)}</td>
              </tr>
            </table>
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
              <tr>
                <td align="center" style="border-radius:8px;background:${INDIGO};">
                  <a href="${escapeHtml(shareUrl)}" style="display:inline-block;padding:16px 40px;font-size:17px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px;">View invoice</a>
                </td>
              </tr>
            </table>
            <p style="margin:0;font-size:13px;line-height:1.6;color:#64748b;">If the button doesn't work, copy this link into your browser:<br><a href="${escapeHtml(shareUrl)}" style="color:${INDIGO};word-break:break-all;">${escapeHtml(shareUrl)}</a></p>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:16px 4px 0;font-size:12px;color:#94a3b8;">Sent with TimeLedger</td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  return { subject, html, text };
};
