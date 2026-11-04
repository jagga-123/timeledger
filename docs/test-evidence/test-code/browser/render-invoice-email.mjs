// Renders the HTML invoice email in Edge (what the client's mail program would roughly show), at desktop and phone width
import puppeteer from 'puppeteer-core';
import { pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = new URL('./shots-p1a/', import.meta.url).pathname.replace(/^\//, '');
mkdirSync(OUT, { recursive: true });
const { renderInvoiceEmail } = await import(pathToFileURL('C:/Users/sande/OneDrive/Desktop/timeledger/backend/src/services/emailTemplates.js').href);

const invoice = { number: 'INV-0003', total: 602.25, currency: 'USD', dueDate: new Date('2026-11-18T10:00:00Z'), timezone: 'Asia/Kolkata' };
const { subject, html, text } = renderInvoiceEmail({
  invoice,
  fromName: 'Alex Morgan',
  shareUrl: 'http://localhost:5273/i/sVdtUHZ-GpbrPx_lDW84q0FjFexampleToken',
  message: 'Hi team,\nhere is the invoice for the API work. Thank you!',
});
writeFileSync(OUT + 'invoice-email.html', html);
writeFileSync(OUT + 'invoice-email.txt', `Subject: ${subject}\n\n${text}\n`);

const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
for (const [name, width, height] of [['17-invoice-email-desktop', 760, 760], ['18-invoice-email-mobile', 375, 700]]) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, isMobile: width < 500, deviceScaleFactor: 1 });
  await page.setContent(html);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(name, 'overflow', overflow, 'title', await page.title());
  await page.screenshot({ path: OUT + name + '.png', fullPage: true });
}
await browser.close();
console.log(subject);
