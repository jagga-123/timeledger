// Renders the reminder e-mails and the invoice e-mail with "Pay now" in Edge (roughly what the client's mail program shows),
// at desktop and phone width, and saves the HTML and text versions
import { pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchEdge } from './launch-edge.mjs';

const OUT = new URL('./shots-p1b/', import.meta.url).pathname.replace(/^\//, '');
mkdirSync(OUT, { recursive: true });
const { renderInvoiceEmail, renderReminderEmail } = await import(pathToFileURL('C:/Users/sande/OneDrive/Desktop/timeledger/backend/src/services/emailTemplates.js').href);

const invoice = { number: 'INV-0003', total: 602.25, currency: 'USD', dueDate: new Date('2026-11-18T10:00:00Z'), timezone: 'Asia/Kolkata', client: { name: 'Initech' } };
const shareUrl = 'http://localhost:5273/i/sVdtUHZ-GpbrPx_lDW84q0FjFexampleToken';
const fromName = 'Alex Morgan';
const payment = {
  link: 'https://pay.example.com/alex-morgan',
  upiId: 'alex.morgan@okhdfcbank',
  bankDetails: 'Account name: Alex Morgan\nBank: HDFC Bank\nAccount no: 50100123456789\nIFSC: HDFC0001234',
};
const withoutLink = { ...payment, link: '' };

const emails = [
  { name: 'reminder-email', ...renderReminderEmail({ invoice, fromName, shareUrl, payment, daysUntilDue: 3 }), shots: [['14-reminder-email-desktop', 760, 900], ['15-reminder-email-mobile', 375, 800]] },
  { name: 'reminder-email-overdue-without-link', ...renderReminderEmail({ invoice, fromName, shareUrl, payment: withoutLink, daysUntilDue: -7 }), shots: [['16-reminder-email-overdue-no-link-desktop', 760, 900]] },
  { name: 'invoice-email-with-pay-now', ...renderInvoiceEmail({ invoice, fromName, shareUrl, message: 'Hi team,\nhere is the invoice for the API work. Thank you!', payment }), shots: [['17-invoice-email-pay-now-desktop', 760, 900]] },
];

const browser = await launchEdge();
for (const email of emails) {
  writeFileSync(OUT + email.name + '.html', email.html);
  writeFileSync(OUT + email.name + '.txt', `Subject: ${email.subject}\n\n${email.text}\n`);
  for (const [file, width, height] of email.shots) {
    const page = await browser.newPage();
    await page.setViewport({ width, height, isMobile: width < 500, deviceScaleFactor: 1 });
    await page.setContent(email.html);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const pay = await page.evaluate(() => [...document.querySelectorAll('a')].filter((a) => /Pay now/.test(a.innerText)).map((a) => a.href));
    console.log(file, '| overflow', overflow, '| Pay now links', JSON.stringify(pay), '| subject:', email.subject);
    await page.screenshot({ path: OUT + file + '.png', fullPage: true });
    await page.close();
  }
}
await browser.close();
process.exit(0);
