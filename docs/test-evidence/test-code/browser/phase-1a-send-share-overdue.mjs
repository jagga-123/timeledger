import puppeteer from 'puppeteer-core';
import { launchEdge } from './launch-edge.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const BASE = process.env.E2E_BASE || 'http://localhost:5273';
const API = process.env.E2E_API || 'http://localhost:5100/api';
const BACKEND = 'C:/Users/sande/OneDrive/Desktop/timeledger/backend';
const URI_FILE = process.env.E2E_MONGO_URI_FILE;
const BACKEND_LOG = process.env.E2E_BACKEND_LOG; // the isolated backend's output: the console email provider prints the emails there
if (!URI_FILE || !BACKEND_LOG) throw new Error('E2E_MONGO_URI_FILE and E2E_BACKEND_LOG are required');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SHOTS = new URL('./shots-p1a/', import.meta.url).pathname.replace(/^\//, '');
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const check = (name, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- API, seed and the "inbox" ----------
const call = async (method, path, token, body) => {
  const res = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const runSeed = async () => {
  const { stdout } = await run('node', ['src/seed.js'], { cwd: BACKEND, env: { ...process.env, MONGODB_URI: readFileSync(URI_FILE, 'utf8').trim() }, timeout: 120000 });
  return stdout;
};

// The console email provider prints every email to the backend's output: that is what a developer sees locally
const readEmails = () =>
  readFileSync(BACKEND_LOG, 'utf8')
    .split('---------- email (console provider: nothing was sent) ----------')
    .slice(1)
    .map((chunk) => {
      const lines = chunk.split(/\r?\n/);
      const field = (name) => lines.find((l) => l.startsWith(name))?.slice(name.length).trim();
      const end = lines.findIndex((l) => l.startsWith('------------------------------------------------'));
      return { to: field('To:'), cc: field('Cc:'), subject: field('Subject:'), body: lines.slice(lines.findIndex((l) => l.startsWith('Subject:')) + 2, end).join('\n') };
    });

const emailsBefore = readEmails().length;
const inbox = () => readEmails().slice(emailsBefore); // the backend log keeps every email since it started: only this run's
const pad = (n) => String(n).padStart(2, '0');
const IST = 5.5 * 3600 * 1000;
const key = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const wall = new Date(Date.now() + IST);
const TODAY = key(wall);
const mondayKey = (weeksAgo) => key(new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() - ((wall.getUTCDay() + 6) % 7) - 7 * weeksAgo)));
const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
const dayWord = (n) => `${n} ${n === 1 ? 'day' : 'days'} overdue`;

// ---------- browser helpers ----------
const browser = await launchEdge();
const consoleErrors = [];
const blocked = [];
let failNextSend = false; // makes the next "send invoice" request fail with a 502, as if the email provider were down

const guard = async (page, label) => {
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const url = r.url();
    if (/localhost:(5000|5173)\b/.test(url)) { blocked.push(url); r.abort(); return; }
    if (failNextSend && r.method() === 'POST' && /\/api\/invoices\/[0-9a-f]{24}\/send$/.test(url)) {
      failNextSend = false;
      r.respond({ status: 502, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': BASE }, body: JSON.stringify({ message: "Couldn't send the email. Try again." }) });
      return;
    }
    r.continue();
  });
  page.on('pageerror', (e) => consoleErrors.push(`[${label}] pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/status of (400|401|404|409|429|502)/.test(m.text())) consoleErrors.push(`[${label}] ${m.text()}`);
  });
};
const newContext = () => (browser.createBrowserContext ? browser.createBrowserContext() : browser.createIncognitoBrowserContext());
const freshPage = async (label, { width = 1280, height = 800, mobile = false } = {}) => {
  const context = await newContext();
  try { await context.overridePermissions(BASE, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']); } catch { /* the copy check falls back to the link box */ }
  const page = await context.newPage();
  await page.setViewport({ width, height, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
  await page.emulateTimezone('Asia/Kolkata');
  await guard(page, label);
  return page;
};
const settled = (page, selector = 'main') => page.waitForFunction((s) => !document.querySelector('.animate-spin') && document.querySelector(s), { timeout: 10000 }, selector);
const withToken = async (page, token, path) => {
  await page.goto(BASE + '/login');
  await page.evaluate((t) => localStorage.setItem('token', t), token);
  await page.goto(BASE + path);
  await settled(page);
};
const hasText = (page, t, timeout = 6000) => page.waitForFunction((s) => document.body.innerText.includes(s), { timeout }, t).then(() => true, () => false);
const gone = (page, t, timeout = 6000) => page.waitForFunction((s) => !document.body.innerText.includes(s), { timeout }, t).then(() => true, () => false);
const waitSel = (page, sel, timeout = 6000) => page.waitForSelector(sel, { timeout }).then(() => true, () => false);
const waitGone = (page, sel, timeout = 6000) => page.waitForSelector(sel, { hidden: true, timeout }).then(() => true, () => false);
const waitUrl = (page, source, timeout = 8000) => page.waitForFunction(`(${source})()`, { timeout }).then(() => true, () => false);
const shot = (page, name, options = {}) => page.screenshot({ path: SHOTS + name + '.png', ...options });
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const offScreen = (page, width) => page.evaluate((w) => [...document.querySelectorAll('body *')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > w + 1 && !el.closest('[data-rht-toaster]'); }).length, width);
const clickButton = async (page, text, within = 'main') => {
  const handle = await page.evaluateHandle((t, w) => [...document.querySelectorAll(`${w} button`)].find((b) => b.innerText.trim() === t && b.offsetParent !== null), text, within);
  const el = handle.asElement();
  if (!el) throw new Error(`No button "${text}" in ${within}`);
  await el.click();
};
const buttonTexts = (page, within) => page.$$eval(`${within} button`, (bs) => bs.filter((b) => b.offsetParent !== null).map((b) => b.innerText.trim()));
const typeInto = async (page, selector, text) => {
  await page.click(selector);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  if (text) await page.type(selector, text);
};
const colorOf = (page, cls, prop = 'color') => page.evaluate((c, p) => { const s = document.createElement('span'); s.className = c; document.body.appendChild(s); const v = getComputedStyle(s)[p]; s.remove(); return v; }, cls, prop);
const timeline = (page) => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-testid="invoice-timeline"] li')].map((li) => [li.dataset.step, { done: li.dataset.done === 'true', text: li.innerText.replace(/\s+/g, ' ').trim() }])));
const badgeOf = (page) => page.$eval('[data-testid="invoice-status"] span', (s) => ({ text: s.innerText.trim(), color: getComputedStyle(s).color }));
const pdfInfo = (bytes) => {
  const text = Buffer.from(bytes).toString('latin1');
  const box = text.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
  return { pages: Number(text.match(/\/Type\s*\/Pages\s*\/Count\s+(\d+)/)?.[1] ?? 0), width: Number(box?.[1] ?? 0), height: Number(box?.[2] ?? 0) };
};

// =====================================================================
// 0. Demo data and one new draft invoice
// =====================================================================
const seedOut = await runSeed();
check('npm run seed created the demo data (a paid and a sent invoice)', seedOut.includes('INV-0001') && seedOut.includes('INV-0002'));
// The seed's sent invoice is due a few days from now, so to have an overdue one the due date is moved back in the
// THROWAWAY database (there is no screen for changing a due date)
const moveDueDate = async (number, daysAgo) => {
  const code = "import mongoose from 'mongoose'; await mongoose.connect(process.env.URI); const r = await mongoose.connection.collection('invoices').updateOne({ number: process.argv[1] }, { $set: { dueDate: new Date(Date.now() - Number(process.argv[2]) * 86400000) } }); console.log(r.modifiedCount); await mongoose.disconnect();";
  const { stdout } = await run('node', ['--input-type=module', '-e', code, number, String(daysAgo)], { cwd: BACKEND, env: { ...process.env, URI: readFileSync(URI_FILE, 'utf8').trim() } });
  return stdout.trim() === '1';
};
check('test set-up: the sent demo invoice INV-0002 is moved 3 days past its due date (in the throwaway database)', await moveDueDate('INV-0002', 3));
const login = await call('POST', '/auth/login', null, { email: 'demo@timeledger.app', password: 'Demo@1234' });
const T = login.body.token;
const clients = (await call('GET', '/clients', T)).body.clients;
const initech = clients.find((c) => c.name === 'Initech');
const seeded = (await call('GET', '/invoices', T)).body.invoices;
const inv1 = seeded.find((i) => i.number === 'INV-0001'); // Globex, paid
const inv2 = seeded.find((i) => i.number === 'INV-0002'); // Acme, sent
check('API: every invoice has displayStatus and daysOverdue', seeded.every((i) => ['draft', 'sent', 'overdue', 'paid'].includes(i.displayStatus) && Number.isInteger(i.daysOverdue)) && seeded.every((i) => i.publicToken === undefined));
const inv2Overdue = inv2.displayStatus === 'overdue';
check(`API: INV-0002 (sent, due ${inv2.dueDate.slice(0, 10)}) is now ${dayWord(inv2.daysOverdue)}, while its stored status is still "sent"`, inv2Overdue && inv2.status === 'sent' && inv2.daysOverdue === 3, `${inv2.displayStatus} ${inv2.daysOverdue}`);

const made = await call('POST', '/invoices', T, { clientId: initech._id, from: mondayKey(4), to: TODAY, notes: 'Thank you!' });
const inv3 = made.body.invoice;
check('a new draft invoice for Initech (INV-0003) to send', made.status === 201 && inv3.number === 'INV-0003' && inv3.displayStatus === 'draft');

// =====================================================================
// 1. Invoices list: Overdue everywhere
// =====================================================================
const A = await freshPage('A-demo');
await withToken(A, T, '/invoices');
await A.waitForSelector('main ul > li a[href^="/invoices/"]');
const chips = await A.$$eval('[aria-label="Filter by status"] button', (b) => b.map((x) => x.innerText.trim()));
check('status filter chips: All, Draft, Sent, Overdue, Paid', chips.join() === 'All,Draft,Sent,Overdue,Paid', chips.join());
const rows = await A.$$eval('main ul > li a[href^="/invoices/"]', (as) => as.map((a) => ({ text: a.innerText.replace(/\s+/g, ' ').trim(), badge: [...a.querySelectorAll('span')].map((s) => s.innerText.trim()).find((t) => /^(Draft|Sent|Paid|\d+ days? overdue)$/.test(t)) })));
const row2 = rows.find((r) => r.text.startsWith('INV-0002'));
check('INV-0002 shows a red-text badge "N days overdue" (not "Sent")', row2.badge === dayWord(inv2.daysOverdue), row2.badge);
const rowBadgeColor = await A.evaluate(() => { const li = [...document.querySelectorAll('main ul > li')].find((l) => l.innerText.includes('INV-0002')); const s = [...li.querySelectorAll('span')].find((x) => /overdue/.test(x.innerText)); return s && getComputedStyle(s).color; });
check('...the overdue badge is red, Draft slate, Paid emerald', rowBadgeColor === (await colorOf(A, 'text-red-700')));
const cards = await A.$$eval('[data-testid="summary"] > div', (c) => c.map((x) => ({ text: x.innerText.replace(/\s+/g, ' ').trim(), noteColor: x.querySelectorAll('p').length > 2 ? getComputedStyle(x.querySelectorAll('p')[2]).color : null })));
const outstanding = inv2.total + inv3.total;
check(`Outstanding card ${money(outstanding)} with "${money(inv2.total)} overdue" below it in red`, cards[0].text.includes(money(outstanding)) && cards[0].text.includes(`${money(inv2.total)} overdue`) && cards[0].noteColor === (await colorOf(A, 'text-red-600')), cards[0].text);
check('the Paid and count cards have no overdue note', !cards[1].text.includes('overdue') && !cards[2].text.includes('overdue'));
await shot(A, '01-invoices-list-overdue-desktop');
await clickButton(A, 'Overdue');
const overdueRows = await A.$$eval('main ul > li a[href^="/invoices/"]', (as) => as.map((a) => a.innerText.slice(0, 8)));
check('filter "Overdue" shows only INV-0002', overdueRows.length === 1 && overdueRows[0] === 'INV-0002', overdueRows.join());
await clickButton(A, 'Sent');
check('filter "Sent" does not include the overdue one (nothing else is sent yet)', await hasText(A, 'No sent invoices'));
await clickButton(A, 'All');

// =====================================================================
// 2. A draft: Send invoice is the main action
// =====================================================================
await A.goto(BASE + `/invoices/${inv3._id}`);
await waitSel(A, '[data-testid="invoice-number"]');
check('draft: the buttons are Back, Print, Send invoice, Mark as sent, Mark as paid, Delete', (await buttonTexts(A, '[data-testid="invoice-actions"]')).join() === 'Back,Print / Save as PDF,Send invoice,Mark as sent,Mark as paid,Delete');
const sendBtnBg = await A.evaluate(() => getComputedStyle([...document.querySelectorAll('[data-testid="invoice-actions"] button')].find((b) => b.innerText.trim() === 'Send invoice')).backgroundColor);
check('"Send invoice" is the primary (indigo) button', sendBtnBg === (await colorOf(A, 'bg-primary', 'backgroundColor')), sendBtnBg);
let tl = await timeline(A);
check('timeline of a draft: Created done; Sent, Viewed and Paid still to come', tl.created.done && !tl.sent.done && !tl.viewed.done && !tl.paid.done && tl.sent.text.includes('Not sent yet'), JSON.stringify(tl));
check('no share link yet: the box says so, and there is no Regenerate button', (await hasText(A, 'There is no link yet')) && !(await buttonTexts(A, '[data-testid="share-link"]')).includes('Regenerate link'));
await shot(A, '02-invoice-draft-send-button-desktop');

// =====================================================================
// 3. The Send invoice modal
// =====================================================================
await clickButton(A, 'Send invoice', '[data-testid="invoice-actions"]');
await waitSel(A, '[role=dialog] #to');
const modal0 = await A.evaluate(() => ({ to: document.querySelector('#to').value, subject: document.querySelector('[data-testid="email-subject"]').innerText.trim(), title: document.querySelector('[role=dialog] h2')?.innerText, submit: document.querySelector('[role=dialog] button[type=submit]').innerText.trim() }));
check('the modal opens with To filled in with the client\'s email and a subject preview', modal0.to === 'finance@initech.example' && modal0.subject === 'Invoice INV-0003 from Alex Morgan' && modal0.title === 'Send invoice' && modal0.submit === 'Send invoice', JSON.stringify(modal0));
await typeInto(A, '#cc', 'boss@initech.example, not-an-address');
await typeInto(A, '#message', 'Hi team,\nhere is the invoice for the API work. Thank you!');
await A.click('[role=dialog] button[type=submit]');
check('a bad CC address is refused under the CC field and nothing is sent', (await hasText(A, 'CC address must be a valid email address')) && inbox().length === 0 && (await call('GET', `/invoices/${inv3._id}`, T)).body.invoice.status === 'draft');
await shot(A, '03-send-invoice-cc-error-desktop');
await typeInto(A, '#cc', 'boss@initech.example');

// the provider is "down" once: the modal stays open, a toast says so, the invoice is untouched
failNextSend = true;
await A.click('[role=dialog] button[type=submit]');
check('when the email can\'t be sent: the toast says so, the form stays open with what was typed, and the invoice is still a draft', (await hasText(A, "Couldn't send the email. Try again.")) && (await A.$('[role=dialog] #message')) !== null && (await A.$eval('#message', (m) => m.value)).includes('API work') && (await call('GET', `/invoices/${inv3._id}`, T)).body.invoice.status === 'draft' && inbox().length === 0);
await shot(A, '04-send-failed-desktop');
await gone(A, "Couldn't send the email. Try again.");

await A.click('[role=dialog] button[type=submit]');
check('Send: toast "Invoice sent to finance@initech.example" and the modal closes', (await hasText(A, 'Invoice sent to finance@initech.example')) && (await waitGone(A, '[role=dialog]')));
await sleep(400);
const afterSend = (await call('GET', `/invoices/${inv3._id}`, T)).body.invoice;
check('the invoice is now Sent: sentAt, lastSentAt and sentTo are saved, and it has a share link', afterSend.status === 'sent' && afterSend.sentAt && afterSend.lastSentAt && afterSend.sentTo === 'finance@initech.example' && /\/i\/[A-Za-z0-9_-]{32}$/.test(afterSend.shareUrl) && afterSend.publicToken === undefined);
const shareUrl = afterSend.shareUrl;
check('the share link points at the app (APP_URL falls back to FRONTEND_URL)', shareUrl.startsWith(BASE + '/i/'), shareUrl);

let emails = inbox();
check('console provider: exactly one email, to the client, CC the boss, with the right subject', emails.length === 1 && emails[0].to === 'finance@initech.example' && emails[0].cc === 'boss@initech.example' && emails[0].subject === 'Invoice INV-0003 from Alex Morgan', JSON.stringify(emails.map((e) => [e.to, e.cc, e.subject])));
check('...the text version has the personal message, the amount, the due date and the link to /i/<token>', emails[0].body.includes('here is the invoice for the API work') && emails[0].body.includes(money(inv3.total)) && emails[0].body.includes('Due date:') && emails[0].body.includes(shareUrl));

const badge3 = await badgeOf(A);
tl = await timeline(A);
check('the page updated by itself: badge "Sent", and the timeline shows Sent with the date and "to finance@initech.example"', badge3.text === 'Sent' && tl.sent.done && tl.sent.text.includes('to finance@initech.example') && !tl.sent.text.includes('Not sent yet') && !tl.viewed.done && tl.viewed.text.includes('Not opened yet'), JSON.stringify(tl.sent));
check('the buttons now say "Resend invoice"; "Mark as sent" and Delete are gone (it is sent)', (await buttonTexts(A, '[data-testid="invoice-actions"]')).join() === 'Back,Print / Save as PDF,Resend invoice,Mark as paid');
check('the share link is shown in a box, with Copy and Regenerate buttons', (await A.$eval('[data-testid="share-link"] input', (i) => i.value)) === shareUrl && (await buttonTexts(A, '[data-testid="share-link"]')).join() === 'Copy share link,Regenerate link');
await gone(A, 'Invoice sent to finance@initech.example');
await shot(A, '05-invoice-sent-timeline-desktop');

// copy the link
await clickButton(A, 'Copy share link', '[data-testid="share-link"]');
check('"Copy share link": toast "Share link copied"', await hasText(A, 'Share link copied'));
let clip = null;
try { clip = await A.evaluate(() => navigator.clipboard.readText()); } catch { /* not allowed in this browser */ }
check('...and the link is really on the clipboard', clip === null ? (await A.$eval('[data-testid="share-link"] input', (i) => i.value)) === shareUrl : clip === shareUrl, clip === null ? '(clipboard not readable here: checked the link box)' : clip);

// =====================================================================
// 4. The client opens the link (no login)
// =====================================================================
const C = await freshPage('C-client');
await C.goto(shareUrl);
await C.waitForSelector('[data-testid="invoice-number"]', { timeout: 10000 });
const pub = await C.evaluate(() => ({
  hasSidebar: !!document.querySelector('aside'), hasBottomNav: !!document.querySelector('nav.fixed'), hasHeader: [...document.querySelectorAll('header')].some((h) => h.parentElement.tagName !== 'ARTICLE'),
  paper: document.querySelector('article.invoice-paper').innerText.replace(/\s+/g, ' ').toLowerCase(),
  total: document.querySelector('[data-testid="invoice-total"]').innerText,
  status: document.querySelector('[data-testid="invoice-status"]').innerText.trim(),
  button: [...document.querySelectorAll('button')].map((b) => b.innerText.trim()),
  footer: document.querySelector('[data-testid="landing-link"]')?.getAttribute('href'),
  footerText: document.querySelector('footer')?.innerText.replace(/\s+/g, ' ').trim(),
  title: document.title, robots: document.querySelector('meta[name="robots"]')?.content, path: location.pathname,
}));
check('the client sees the invoice without logging in: no sidebar, no app bars, the same paper', !pub.hasSidebar && !pub.hasBottomNav && pub.path === shareUrl.replace(BASE, '') && pub.paper.includes('invoice inv-0003') && pub.paper.includes('alex morgan') && pub.paper.includes('initech') && pub.total === money(inv3.total) && pub.status === 'Sent', pub.status);
check('...with a "Download PDF" button and a small "Sent with TimeLedger" footer link to the start page', pub.button.join() === 'Download PDF' && pub.footerText === 'Sent with TimeLedger' && pub.footer === '/');
check('...a useful tab title and no search engine indexing', pub.title === 'Invoice INV-0003 from Alex Morgan' && pub.robots === 'noindex, nofollow', `${pub.title} | ${pub.robots}`);
check('the page holds nothing from the owner: no buttons to send, delete or edit, no share link box', !pub.button.includes('Send invoice') && !(await C.$('[data-testid="invoice-actions"]')) && !(await C.$('[data-testid="share-link"]')));
await shot(C, '06-public-invoice-desktop');

// what the browser actually received: only the allowed fields
const raw = await (await fetch(API + '/public/invoices/' + shareUrl.split('/i/')[1])).json();
const rawText = JSON.stringify(raw);
check('black box: the public JSON has no user id, entry ids, client id, project ids, token or viewedAt', !/"(userId|entryIds|clientId|projectId|_id|publicToken|viewedAt|sentTo)"/.test(rawText) && !rawText.includes(shareUrl.split('/i/')[1]));

// Download PDF: print dialog, and what the page looks like on paper
await C.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
await C.click('[data-testid="download-pdf"]');
check('"Download PDF" opens the print dialog (Save as PDF)', (await C.evaluate(() => window.__printed)) === 1);
await C.setViewport({ width: 794, height: 1123 });
await C.emulateMediaType('print');
await sleep(300);
const printed = await C.evaluate(() => ({ footer: getComputedStyle(document.querySelector('footer')).display, bar: getComputedStyle(document.querySelector('[data-testid="download-pdf"]').parentElement).display, paperRight: document.querySelector('article.invoice-paper').getBoundingClientRect().right, bg: getComputedStyle(document.body).backgroundColor }));
const pdf = await C.pdf({ preferCSSPageSize: true, printBackground: true });
writeFileSync(SHOTS + 'public-invoice.pdf', pdf);
const info = pdfInfo(pdf);
check('printed: the button bar and the footer are hidden, white background, one A4 page', printed.footer === 'none' && printed.bar === 'none' && printed.bg === 'rgb(255, 255, 255)' && printed.paperRight <= 794 && info.pages === 1 && Math.abs(info.width - 595) < 1, JSON.stringify({ ...printed, ...info }));
await shot(C, '07-public-invoice-print-preview');
await C.emulateMediaType('screen');
await C.setViewport({ width: 1280, height: 800 });

// "viewed" shows up for the owner
await A.reload();
await waitSel(A, '[data-testid="invoice-timeline"]');
tl = await timeline(A);
const viewedApi = (await call('GET', `/invoices/${inv3._id}`, T)).body.invoice.viewedAt;
check('the owner\'s timeline now shows Viewed with a date (set when the client opened the link)', tl.viewed.done && !tl.viewed.text.includes('Not opened yet') && Boolean(viewedApi), tl.viewed.text);
await shot(A, '08-timeline-viewed-desktop');
await C.reload();
await C.waitForSelector('[data-testid="invoice-number"]');
await C.goto(shareUrl);
await C.waitForSelector('[data-testid="invoice-number"]');
check('opening it again does not change the first view date', (await call('GET', `/invoices/${inv3._id}`, T)).body.invoice.viewedAt === viewedApi);

// an unknown link
const U = await freshPage('U-unknown');
await U.goto(BASE + '/i/this-is-not-a-real-token');
check('an unknown link says "This invoice link is not valid", still without any app layout', (await hasText(U, 'This invoice link is not valid')) && !(await U.$('aside')));
await shot(U, '09-public-invoice-not-valid-desktop');

// =====================================================================
// 5. Regenerate the link
// =====================================================================
await clickButton(A, 'Regenerate link', '[data-testid="share-link"]');
const confirmText = await A.$eval('[role=dialog]', (d) => d.innerText.replace(/\s+/g, ' '));
check('Regenerate asks first and says the old link stops working', confirmText.includes('Regenerate the share link?') && confirmText.includes('The current link stops working'), confirmText);
await shot(A, '10-regenerate-confirm-desktop');
await clickButton(A, 'Cancel', '[role=dialog]');
check('Cancel keeps the link as it was', (await waitGone(A, '[role=dialog]')) && (await A.$eval('[data-testid="share-link"] input', (i) => i.value)) === shareUrl);
await clickButton(A, 'Regenerate link', '[data-testid="share-link"]');
await clickButton(A, 'Regenerate', '[role=dialog]');
check('Regenerate: toast, and the box shows a different link', (await hasText(A, 'New link made')) && (await A.waitForFunction((old) => document.querySelector('[data-testid="share-link"] input')?.value !== old, { timeout: 5000 }, shareUrl).then(() => true, () => false)));
const newUrl = await A.$eval('[data-testid="share-link"] input', (i) => i.value);
check('the new link is on the same address with a new token', newUrl.startsWith(BASE + '/i/') && newUrl !== shareUrl);
tl = await timeline(A);
check('the timeline starts "Viewed" again (the new link has not been opened)', !tl.viewed.done && tl.viewed.text.includes('Not opened yet'), tl.viewed.text);
await U.goto(shareUrl);
check('the OLD link now says "This invoice link is not valid"', await hasText(U, 'This invoice link is not valid'));
await U.goto(newUrl);
check('the NEW link opens the invoice', await waitSel(U, '[data-testid="invoice-number"]'));

// =====================================================================
// 6. Sending again
// =====================================================================
await clickButton(A, 'Resend invoice', '[data-testid="invoice-actions"]');
await waitSel(A, '[role=dialog] #to');
const modal2 = await A.evaluate(() => ({ title: document.querySelector('[role=dialog] h2')?.innerText, to: document.querySelector('#to').value, note: document.querySelector('[role=dialog]').innerText.includes('Last sent to finance@initech.example') }));
check('Resend: the modal is titled "Resend invoice" and remembers who it was sent to', modal2.title === 'Resend invoice' && modal2.to === 'finance@initech.example' && modal2.note, JSON.stringify(modal2));
await typeInto(A, '#to', 'accounts@initech.example');
await A.click('[role=dialog] button[type=submit]');
check('sending again to another address works (toast shows the new address)', await hasText(A, 'Invoice sent to accounts@initech.example'));
await waitGone(A, '[role=dialog]');
emails = inbox();
const after = (await call('GET', `/invoices/${inv3._id}`, T)).body.invoice;
check('two emails in total; the second has the NEW link; sentAt stayed, status still sent', emails.length === 2 && emails[1].to === 'accounts@initech.example' && emails[1].body.includes(newUrl) && !emails[1].body.includes(shareUrl) && after.status === 'sent' && after.sentAt === afterSend.sentAt && after.sentTo === 'accounts@initech.example');
await gone(A, 'Invoice sent to accounts@initech.example');

// =====================================================================
// 7. An overdue invoice
// =====================================================================
await A.goto(BASE + `/invoices/${inv2._id}`);
await waitSel(A, '[data-testid="invoice-number"]');
const b2 = await badgeOf(A);
tl = await timeline(A);
check(`INV-0002's badge says "${dayWord(inv2.daysOverdue)}" in red, and so does the Sent step of the timeline`, b2.text === dayWord(inv2.daysOverdue) && b2.color === (await colorOf(A, 'text-red-700')) && tl.sent.text.includes(dayWord(inv2.daysOverdue)), `${b2.text} | ${tl.sent.text}`);
check('the demo history is there: Sent to the client, not viewed yet; the share link exists', tl.sent.text.includes('to accounts@acme.example') && !tl.viewed.done && (await A.$('[data-testid="share-link"] input')) !== null);
check('an overdue invoice can be sent again (Resend invoice) and marked as paid', (await buttonTexts(A, '[data-testid="invoice-actions"]')).join() === 'Back,Print / Save as PDF,Resend invoice,Mark as paid');
await shot(A, '11-invoice-overdue-desktop');
await clickButton(A, 'Mark as paid', '[data-testid="invoice-actions"]');
check('Mark as paid ends the overdue state: badge "Paid" (emerald), the timeline shows Paid, and there is no Send button any more', (await hasText(A, 'Marked as paid')) && (await badgeOf(A)).text === 'Paid' && (await timeline(A)).paid.done && !(await buttonTexts(A, '[data-testid="invoice-actions"]')).includes('Resend invoice'));
await A.goto(BASE + '/invoices');
await A.waitForSelector('main ul > li a[href^="/invoices/"]');
const cards2 = await A.$$eval('[data-testid="summary"] > div', (c) => c.map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
check('the Outstanding card no longer has an overdue line; "Overdue" is an empty list', !cards2[0].includes('overdue') && (await (async () => { await clickButton(A, 'Overdue'); return hasText(A, 'No overdue invoices'); })()));
await clickButton(A, 'All');
await A.goto(BASE + `/invoices/${inv1._id}`);
await waitSel(A, '[data-testid="invoice-number"]');
tl = await timeline(A);
check('the paid demo invoice INV-0001 (Globex): no Send button; timeline Created, Sent, Viewed and Paid are all done (and no reminder was sent)', !(await buttonTexts(A, '[data-testid="invoice-actions"]')).some((t) => /Send|Resend/.test(t)) && ['created', 'sent', 'viewed', 'paid'].every((step) => tl[step].done) && !tl.reminder.done, JSON.stringify(Object.entries(tl).map(([step, s]) => `${step}:${s.done}`))); // Phase 1B added a "Reminder sent" step: this invoice never got a reminder
const P = await freshPage('P-public-paid');
await P.goto((await call('GET', `/invoices/${inv1._id}`, T)).body.invoice.shareUrl);
check('its link shows a Paid badge to the client', (await waitSel(P, '[data-testid="invoice-status"]')) && (await P.$eval('[data-testid="invoice-status"]', (e) => e.innerText.trim())) === 'Paid');

// =====================================================================
// 8. Phone (375px)
// =====================================================================
const M = await freshPage('M-owner', { width: 375, height: 667, mobile: true });
await withToken(M, T, `/invoices/${inv3._id}`);
await waitSel(M, '[data-testid="invoice-timeline"]');
const mtl = await M.evaluate(() => { const li = [...document.querySelectorAll('[data-testid="invoice-timeline"] li')].map((e) => e.getBoundingClientRect()); return { stacked: li.every((r, i) => i === 0 || (r.top > li[i - 1].top + 10 && Math.abs(r.left - li[0].left) < 2)), right: Math.max(...li.map((r) => r.right)) }; });
check('Phone: the timeline is vertical and fits the screen; no sideways scroll on the invoice page', mtl.stacked && mtl.right <= 375 && (await overflow(M)) <= 0 && (await offScreen(M, 375)) === 0, `${JSON.stringify(mtl)} off=${await offScreen(M, 375)}`);
check('Phone: the action buttons wrap inside the screen', await M.evaluate(() => [...document.querySelectorAll('[data-testid="invoice-actions"] button')].every((b) => b.getBoundingClientRect().right <= 375)));
await shot(M, '12-invoice-sent-mobile');
await clickButton(M, 'Resend invoice', '[data-testid="invoice-actions"]');
await waitSel(M, '[role=dialog] #to');
const mm = await M.$eval('[role=dialog]', (d) => { const r = d.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
check('Phone: the Send invoice modal fits the screen', mm.left >= 0 && mm.right <= 375 && mm.top >= 0 && mm.bottom <= 667 && (await overflow(M)) <= 0, JSON.stringify(mm));
await shot(M, '13-send-modal-mobile');
await M.keyboard.press('Escape');
await M.goto(BASE + '/invoices');
await M.waitForSelector('main ul > li a[href^="/invoices/"]');
check('Phone: the invoices list with the Overdue chip fits the screen', (await overflow(M)) <= 0 && (await offScreen(M, 375)) === 0);
await shot(M, '14-invoices-list-mobile');

const MC = await freshPage('M-client', { width: 375, height: 667, mobile: true });
await MC.goto(newUrl);
await MC.waitForSelector('[data-testid="invoice-number"]');
const mpub = await MC.evaluate(() => ({ stacked: getComputedStyle(document.querySelector('[data-testid="line-items-stacked"]')).display !== 'none', table: getComputedStyle(document.querySelector('[data-testid="line-items-table"]')).display, btn: (() => { const r = document.querySelector('[data-testid="download-pdf"]').getBoundingClientRect(); return { left: r.left, right: r.right }; })() }));
check('Phone: the public invoice stacks its lines, the Download PDF button is on screen, and nothing runs off the edge', mpub.stacked && mpub.table === 'none' && mpub.btn.right <= 375 && mpub.btn.left >= 0 && (await overflow(MC)) <= 0 && (await offScreen(MC, 375)) === 0 && (await MC.evaluate(() => window.innerWidth)) === 375, `${JSON.stringify({ stacked: mpub.stacked, table: mpub.table, btnRight: mpub.btn.right, btnLeft: mpub.btn.left })} overflow=${await overflow(MC)} off=${await offScreen(MC, 375)} innerWidth=${await MC.evaluate(() => window.innerWidth)}`);
await shot(MC, '15-public-invoice-mobile');
await shot(MC, '16-public-invoice-mobile-full', { fullPage: true });

// =====================================================================
check('isolated: no request went to the dev servers on 5000/5173', blocked.length === 0, blocked.join(' | '));
check('no unexpected console/page errors', consoleErrors.length === 0, consoleErrors.join(' | '));

await browser.close();
console.log(failures === 0 ? '\nALL PHASE 1A BROWSER CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
