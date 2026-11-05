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
const BACKEND_LOG = process.env.E2E_BACKEND_LOG;
const CRON_SECRET = process.env.E2E_CRON_SECRET || 'e2e-cron-secret-0123456789abcdef';
if (!URI_FILE || !BACKEND_LOG) throw new Error('E2E_MONGO_URI_FILE and E2E_BACKEND_LOG are required');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SHOTS = new URL('./shots-p1b/', import.meta.url).pathname.replace(/^\//, '');
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const check = (name, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DEMO_LINK = 'https://pay.example.com/alex-morgan';

// ---------- API, database and the "inbox" ----------
const call = async (method, path, token, body) => {
  const res = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const mongoUri = () => readFileSync(URI_FILE, 'utf8').trim();
const runSeed = async () => (await run('node', ['src/seed.js'], { cwd: BACKEND, env: { ...process.env, MONGODB_URI: mongoUri() }, timeout: 120000 })).stdout;

// Moves one date of an invoice in the THROWAWAY database (no screen can change a due date or a sent date)
const setInvoiceDate = async (number, field, daysFromNow) => {
  const code = "import mongoose from 'mongoose'; await mongoose.connect(process.env.URI); const r = await mongoose.connection.collection('invoices').updateOne({ number: process.argv[1] }, { $set: { [process.argv[2]]: new Date(Date.now() + Number(process.argv[3]) * 86400000) } }); console.log(r.modifiedCount); await mongoose.disconnect();";
  const { stdout } = await run('node', ['--input-type=module', '-e', code, number, field, String(daysFromNow)], { cwd: BACKEND, env: { ...process.env, URI: mongoUri() } });
  return stdout.trim() === '1';
};

// The console e-mail provider prints every e-mail to the backend's output
const readEmails = () =>
  readFileSync(BACKEND_LOG, 'utf8')
    .split('---------- email (console provider: nothing was sent) ----------')
    .slice(1)
    .map((chunk) => {
      const lines = chunk.split(/\r?\n/);
      const field = (name) => lines.find((l) => l.startsWith(name))?.slice(name.length).trim();
      const end = lines.findIndex((l) => l.startsWith('------------------------------------------------'));
      return { to: field('To:'), subject: field('Subject:'), body: lines.slice(lines.findIndex((l) => l.startsWith('Subject:')) + 2, end).join('\n') };
    });
const emailsBefore = readEmails().length;
const inbox = () => readEmails().slice(emailsBefore);

const pad = (n) => String(n).padStart(2, '0');
const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

// ---------- browser helpers ----------
const browser = await launchEdge();
const consoleErrors = [];
const blocked = [];
let failNextReminder = false;

const guard = async (page, label) => {
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const url = r.url();
    if (/localhost:(5000|5173)\b/.test(url)) { blocked.push(url); r.abort(); return; }
    if (failNextReminder && r.method() === 'POST' && /\/reminders\/send-now$/.test(url)) {
      failNextReminder = false;
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
const shot = (page, name, options = {}) => page.screenshot({ path: SHOTS + name + '.png', ...options });
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const offScreen = (page, width) => page.evaluate((w) => [...document.querySelectorAll('body *')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > w + 1 && !el.closest('[data-rht-toaster]'); }).length, width);
const clickButton = async (page, text, within = 'main') => {
  await page.waitForFunction((t, w) => [...document.querySelectorAll(`${w} button`)].some((b) => b.innerText.trim() === t && b.offsetParent !== null), { timeout: 8000 }, text, within).catch(() => {});
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
const timelineOrder = (page) => page.$$eval('[data-testid="invoice-timeline"] li', (lis) => lis.map((li) => li.dataset.step));
const remindersText = (page) => page.$eval('[data-testid="reminders"]', (e) => e.innerText.replace(/\s+/g, ' ').trim());
// the section mounts with "Loading reminders..." while its own request is still running: wait for the real text
const nextLine = async (page) => {
  await page.waitForFunction(() => { const e = document.querySelector('[data-testid="next-reminder"]'); return e && !e.innerText.includes('Loading reminders'); }, { timeout: 8000 });
  return page.$eval('[data-testid="next-reminder"]', (e) => e.innerText.replace(/\s+/g, ' ').trim());
};
const history = (page) => page.$$eval('[data-testid="reminder-history"] li', (lis) => lis.map((li) => ({ status: li.dataset.status, text: li.innerText.replace(/\s+/g, ' ').trim() })));
const card = (name) => `[data-testid="${name}"]`;
const switchState = (page, within, index) => page.$$eval(`${within} button[role="switch"]`, (s, i) => s[i]?.getAttribute('aria-checked') === 'true', index);
const clickSwitch = async (page, within, index) => {
  await page.waitForFunction((sel, i) => document.querySelectorAll(sel).length > i, { timeout: 8000 }, `${within} button[role="switch"]`, index); // the invoice switch appears once its reminders have loaded
  const switches = await page.$$(`${within} button[role="switch"]`);
  await switches[index].click();
};
const chips = (page) => page.$$eval('[data-testid="reminders-settings"] [aria-label="Days after the due date"] button', (b) => b.map((x) => ({ day: x.innerText.replace(/\D/g, ''), on: x.getAttribute('aria-pressed') === 'true', disabled: x.disabled })));
const summary = (page) => page.$eval('[data-testid="reminder-summary"]', (e) => e.innerText.trim());
const pdfInfo = (bytes) => { const text = Buffer.from(bytes).toString('latin1'); return { pages: Number(text.match(/\/Type\s*\/Pages\s*\/Count\s+(\d+)/)?.[1] ?? 0) }; };

// =====================================================================
// 0. Demo data, and the documented curl command
// =====================================================================
const seedOut = await runSeed();
check('npm run seed: the demo user now has reminders on and fake payment details', seedOut.includes('INV-0002'));
const login = await call('POST', '/auth/login', null, { email: 'demo@timeledger.app', password: 'Demo@1234' });
const T = login.body.token;
const me0 = login.body.user;
check('the demo user: reminders 3 days before, on the due date, 7 and 14 after; a payment link, UPI ID and bank details', JSON.stringify(me0.reminders) === JSON.stringify({ enabled: true, beforeDueDays: 3, onDueDate: true, afterDueDays: [7, 14] }) && me0.payment.link === DEMO_LINK && me0.payment.upiId === 'alex.morgan@okhdfcbank' && me0.payment.bankDetails.includes('HDFC Bank'));
const invoices0 = (await call('GET', '/invoices', T)).body.invoices;
const inv1 = invoices0.find((i) => i.number === 'INV-0001'); // paid
const inv2 = invoices0.find((i) => i.number === 'INV-0002'); // sent
const clients = (await call('GET', '/clients', T)).body.clients;
const initech = clients.find((c) => c.name === 'Initech');
check('the sent demo invoice INV-0002 is not paused and has no reminders yet', inv2.status === 'sent' && inv2.remindersPaused === false && (await call('GET', `/invoices/${inv2._id}/reminders`, T)).body.history.length === 0);

// The documented way to run the job locally: curl with the secret
const curl = async (secret) => {
  try {
    const { stdout } = await run('curl', ['-s', '-w', '\\n%{http_code}', '-X', 'POST', ...(secret === null ? [] : ['-H', `X-Cron-Secret: ${secret}`]), API + '/cron/reminders']);
    const [body, code] = stdout.trim().split(/\r?\n(?=\d+$)/);
    return { code: Number(code), body: JSON.parse(body) };
  } catch (e) {
    return { code: 0, body: {}, error: e.message };
  }
};
const noSecret = await curl(null);
const wrongSecret = await curl('wrong-secret');
check('curl without the secret, or with a wrong one: 401 and nothing runs', noSecret.code === 401 && wrongSecret.code === 401 && inbox().length === 0, `${noSecret.code}/${wrongSecret.code}`);
const idle = await curl(CRON_SECRET);
check('curl -X POST -H "X-Cron-Secret: ..." .../api/cron/reminders: 200 with { checked, sent, skipped, failed }', idle.code === 200 && ['checked', 'sent', 'skipped', 'failed'].every((k) => Number.isInteger(idle.body[k])) && idle.body.sent === 0, JSON.stringify(idle.body));

// =====================================================================
// 1. Settings: payment reminders
// =====================================================================
const A = await freshPage('A-demo');
await withToken(A, T, '/settings');
await waitSel(A, card('reminders-settings'));
const R = card('reminders-settings');
check('Settings has a "Payment reminders" card and a "Payment details" card', (await hasText(A, 'Payment reminders')) && (await hasText(A, 'Payment details')) && (await waitSel(A, card('payment-settings'))));
check('the reminder defaults: on, 3 days before, on the due date, chips 7 and 14 (30 is not picked)', (await switchState(A, R, 0)) && (await A.$eval('#beforeDueDays', (s) => s.value)) === '3' && (await switchState(A, R, 1)) && JSON.stringify(await chips(A)) === JSON.stringify([{ day: '7', on: true, disabled: false }, { day: '14', on: true, disabled: false }, { day: '30', on: false, disabled: false }]));
check('the summary line says what will happen', (await summary(A)) === 'Clients get reminders 3 days before, on the due date, and 7 and 14 days after.', await summary(A));
check('Save is disabled until something changes', await A.$eval(`${R} button[type=submit]`, (b) => b.disabled));
await shot(A, '01-settings-reminders-desktop');

// change it: 5 days before, drop 7, add 30
await A.select('#beforeDueDays', '5');
await A.click(`${R} [aria-label="Days after the due date"] button:nth-child(1)`); // 7 off
await A.click(`${R} [aria-label="Days after the due date"] button:nth-child(3)`); // 30 on
check('the summary follows the choices at once', (await summary(A)) === 'Clients get reminders 5 days before, on the due date, and 14 and 30 days after.', await summary(A));
await clickButton(A, 'Save reminders', R);
check('Save: toast "Reminder settings saved"', await hasText(A, 'Reminder settings saved'));
const me1 = (await call('GET', '/auth/me', T)).body.user;
check('saved on the server: 5 days before, on the due date, [14, 30]', JSON.stringify(me1.reminders) === JSON.stringify({ enabled: true, beforeDueDays: 5, onDueDate: true, afterDueDays: [14, 30] }), JSON.stringify(me1.reminders));
await A.reload();
await waitSel(A, R);
check('...and it is still there after a reload', (await summary(A)) === 'Clients get reminders 5 days before, on the due date, and 14 and 30 days after.');

// the master switch
await clickSwitch(A, R, 0);
check('switching the master toggle off: the options are disabled and the summary says reminders are off', (await A.$eval('#beforeDueDays', (s) => s.disabled)) && (await summary(A)) === 'Automatic reminders are off.' && (await chips(A)).every((c) => c.disabled));
await clickButton(A, 'Save reminders', R);
await hasText(A, 'Reminder settings saved');
check('saved: reminders are off for this user', (await call('GET', '/auth/me', T)).body.user.reminders.enabled === false);

// no reminder is sent while they are off, even when one is due; the bells in the list are muted
await setInvoiceDate('INV-0002', 'dueDate', 3);
const offRun = await curl(CRON_SECRET);
check('the job with reminders off sends nothing (the invoice is skipped)', offRun.body.sent === 0 && offRun.body.skipped >= 1 && inbox().length === 0, JSON.stringify(offRun.body));
await A.goto(BASE + '/invoices');
await A.waitForSelector('main ul > li a[href^="/invoices/"]');
check('Invoices list: a muted bell-off on the sent invoice ("Reminders are off in Settings")', (await A.$$eval('[data-testid="reminders-off"]', (b) => b.map((x) => x.title))).join() === 'Reminders are off in Settings');
// ...and back on, with the defaults
await call('PATCH', '/auth/me', T, { reminders: { enabled: true, beforeDueDays: 3, onDueDate: true, afterDueDays: [7, 14] } });

// =====================================================================
// 2. Settings: payment details and their validation
// =====================================================================
await A.goto(BASE + '/settings');
await waitSel(A, card('payment-settings'));
const P = card('payment-settings');
const fields = await A.evaluate(() => ({ link: document.querySelector('#link').value, upi: document.querySelector('#upiId').value, bank: document.querySelector('#bankDetails').value }));
check('the payment card is filled in (from the demo data)', fields.link === DEMO_LINK && fields.upi === 'alex.morgan@okhdfcbank' && fields.bank.includes('Account no: 50100123456789'));
await shot(A, '02-settings-payment-desktop');

await typeInto(A, '#link', 'http://insecure.example.com/pay');
await typeInto(A, '#upiId', 'bad id');
await clickButton(A, 'Save payment details', P);
check('an http:// link and a bad UPI ID are refused, each under its own field', (await hasText(A, 'Payment link must be a full https:// address')) && (await hasText(A, 'UPI ID must look like name@bank')));
check('...and nothing was saved', (await call('GET', '/auth/me', T)).body.user.payment.link === DEMO_LINK);
await shot(A, '03-settings-payment-errors-desktop');
await typeInto(A, '#link', 'javascript:alert(1)');
await clickButton(A, 'Save payment details', P);
check('a javascript: link is refused too', await hasText(A, 'Payment link must be a full https:// address'));

// a valid link with nicer details, saved
await typeInto(A, '#link', 'https://rzp.io/l/alex-morgan');
await typeInto(A, '#upiId', 'alex.morgan@okhdfcbank');
await clickButton(A, 'Save payment details', P);
check('valid details save: toast "Payment details saved"', await hasText(A, 'Payment details saved'));
check('...and are stored as typed', (await call('GET', '/auth/me', T)).body.user.payment.link === 'https://rzp.io/l/alex-morgan');
await gone(A, 'Payment details saved');

// =====================================================================
// 3. The invoice page: reminders, and "Pay now" for the client
// =====================================================================
// make INV-0002's first reminder (3 days before) due today, so the hourly job has something to send
check('test set-up: INV-0002 is made due in 3 days (the throwaway database)', await setInvoiceDate('INV-0002', 'dueDate', 3));

await A.goto(BASE + `/invoices/${inv2._id}`);
await waitSel(A, '[data-testid="reminders"]');
check('timeline: Created, Sent, Reminder sent, Viewed, Paid', (await timelineOrder(A)).join() === 'created,sent,reminder,viewed,paid');
const reminders0 = (await call('GET', `/invoices/${inv2._id}/reminders`, T)).body;
check('before the job: "Next reminder: today, due in 3 days", no history, and the reminder step still to come', (await nextLine(A)) === 'Next reminder: today, due in 3 days' && (await history(A)).length === 0 && !(await timeline(A)).reminder.done && reminders0.next.kind === 'before_due' && reminders0.next.daysFromNow === 0, await nextLine(A));
check('the controls: a "Pause reminders" switch and a "Send reminder now" button', (await buttonTexts(A, '[data-testid="reminders"]')).join() === 'Pause reminders,Send reminder now');
await shot(A, '04-invoice-reminders-before-desktop');

// the hourly job, called the way the GitHub Action calls it
const jobRun = await curl(CRON_SECRET);
check('the job (curl with the secret): 1 reminder sent', jobRun.code === 200 && jobRun.body.sent === 1 && jobRun.body.failed === 0, JSON.stringify(jobRun.body));
let mails = inbox();
check('the e-mail: to the client, "Reminder: INV-0002 is due in 3 days", the amount, a link to the invoice, Pay now and the UPI ID', mails.length === 1 && mails[0].to === 'accounts@acme.example' && mails[0].subject === 'Reminder: INV-0002 is due in 3 days' && mails[0].body.includes(money(inv2.total)) && /\/i\/[A-Za-z0-9_-]{32}/.test(mails[0].body) && mails[0].body.includes('Pay now:\nhttps://rzp.io/l/alex-morgan') && mails[0].body.includes('UPI ID: alex.morgan@okhdfcbank') && mails[0].body.includes('Alex Morgan'), JSON.stringify(mails.map((m) => m.subject)));
const jobAgain = await curl(CRON_SECRET);
check('calling the job again (an hourly scheduler does) sends nothing more', jobAgain.body.sent === 0 && inbox().length === 1, JSON.stringify(jobAgain.body));

await A.reload();
await waitSel(A, '[data-testid="reminder-history"]');
const hist = await history(A);
check('the page shows the reminder: "3 days before the due date", to the client, Sent', hist.length === 1 && hist[0].status === 'sent' && hist[0].text.includes('3 days before the due date') && hist[0].text.includes('accounts@acme.example') && hist[0].text.includes('Sent'), hist[0]?.text);
const tl = await timeline(A);
check('the timeline now has "Reminder sent" with a date and "1 reminder so far"', tl.reminder.done && tl.reminder.text.includes('1 reminder so far'), tl.reminder.text);
check('the next one is on the due date', (await nextLine(A)).endsWith('on the due date') && (await nextLine(A)).includes(`Next reminder:`), await nextLine(A));
await shot(A, '05-invoice-reminder-sent-desktop');

// "Send reminder now" right after an automatic reminder: 24 hour rule
await clickButton(A, 'Send reminder now', '[data-testid="reminders"]');
check('"Send reminder now" within 24 hours of the automatic one: toast "You already sent a reminder in the last 24 hours", no e-mail', (await hasText(A, 'You already sent a reminder in the last 24 hours')) && inbox().length === 1);
await gone(A, 'You already sent a reminder in the last 24 hours');

// a second invoice for manual sending and pausing: Initech, sent long ago, due in 10 days
const made = await call('POST', '/invoices', T, { clientId: initech._id, from: '2026-10-05', to: '2026-10-15' });
const inv3 = made.body.invoice;
await call('POST', `/invoices/${inv3._id}/send`, T, {});
await setInvoiceDate(inv3.number, 'sentAt', -20);
await setInvoiceDate(inv3.number, 'dueDate', 10);
const mailsBefore3 = inbox().length;

// ---- the draft and the paid invoice ----
const draftMade = await call('POST', '/invoices', T, { clientId: clients.find((c) => c.name === 'Acme Corp')._id, from: '2026-10-20', to: '2026-11-04' });
const draft = draftMade.body.invoice;
await A.goto(BASE + `/invoices/${draft._id}`);
await waitSel(A, '[data-testid="reminders"]');
check('a draft: "Reminders start once the invoice has been sent." and no pause or send buttons', (await nextLine(A)).includes('Reminders start once the invoice has been sent') && (await buttonTexts(A, '[data-testid="reminders"]')).length === 0);
await A.goto(BASE + `/invoices/${inv1._id}`);
await waitSel(A, '[data-testid="reminders"]');
check('a paid invoice: "This invoice is paid, so there are no more reminders." and no buttons', (await nextLine(A)).includes('paid, so there are no more reminders') && (await buttonTexts(A, '[data-testid="reminders"]')).length === 0);

// ---- the second invoice: send now, then pause ----
await A.goto(BASE + `/invoices/${inv3._id}`);
await waitSel(A, '[data-testid="reminders"]');
const next3 = await nextLine(A);
check('INV-0003 (due in 10 days): "Next reminder: <date>, due in 3 days"', /^Next reminder: \d{1,2} \w{3,4} 20\d\d, due in 3 days$/.test(next3), next3);

failNextReminder = true;
await clickButton(A, 'Send reminder now', '[data-testid="reminders"]');
check('when the e-mail provider fails: toast "Couldn\'t send the email. Try again." and nothing is sent', (await hasText(A, "Couldn't send the email. Try again.")) && inbox().length === mailsBefore3);
await shot(A, '06-send-reminder-failed-desktop');
await gone(A, "Couldn't send the email. Try again.");

await clickButton(A, 'Send reminder now', '[data-testid="reminders"]');
check('"Send reminder now": toast "Reminder sent to finance@initech.example"', await hasText(A, 'Reminder sent to finance@initech.example'));
await A.waitForFunction(() => document.querySelectorAll('[data-testid="reminder-history"] li').length === 1, { timeout: 6000 }).catch(() => {});
const hist3 = await history(A);
const mails3 = inbox().slice(mailsBefore3);
check('the e-mail went out (due in 10 days), the history says "Sent by you", and the timeline has the reminder', mails3.length === 1 && mails3[0].subject === 'Reminder: INV-0003 is due in 10 days' && hist3.length === 1 && hist3[0].text.includes('Sent by you') && hist3[0].status === 'sent' && (await timeline(A)).reminder.done, JSON.stringify(mails3.map((m) => m.subject)));
await gone(A, 'Reminder sent to finance@initech.example');

// pause
await clickSwitch(A, '[data-testid="reminders"]', 0);
check('"Pause reminders": toast, the switch is on, and the page says reminders are paused', (await hasText(A, 'Reminders paused for this invoice')) && (await switchState(A, '[data-testid="reminders"]', 0)) && (await A.waitForFunction(() => document.querySelector('[data-testid="next-reminder"]')?.innerText.includes('paused'), { timeout: 5000 }).then(() => true, () => false)), await nextLine(A));
check('saved on the server (remindersPaused)', (await call('GET', `/invoices/${inv3._id}`, T)).body.invoice.remindersPaused === true);
await A.goto(BASE + '/invoices');
await A.waitForSelector('main ul > li a[href^="/invoices/"]');
const bells = await A.evaluate(() => Object.fromEntries([...document.querySelectorAll('main ul > li')].map((li) => [li.innerText.slice(0, 8), li.querySelector('[data-testid]')?.dataset.testid ?? 'none'])));
check('Invoices list: a bell on INV-0002, a muted bell-off on the paused INV-0003, none on the draft and the paid invoice', bells['INV-0002'] === 'reminders-on' && bells['INV-0003'] === 'reminders-off' && bells['INV-0001'] === 'none' && bells[draft.number] === 'none', JSON.stringify(bells));
const bellColors = await A.evaluate(() => ({ on: getComputedStyle(document.querySelector('[data-testid="reminders-on"]')).color, off: getComputedStyle(document.querySelector('[data-testid="reminders-off"]')).color }));
check('...the active bell is indigo and the paused one is muted grey', bellColors.on === (await colorOf(A, 'text-primary')) && bellColors.off === (await colorOf(A, 'text-slate-300')), JSON.stringify(bellColors));
await shot(A, '07-invoices-list-bells-desktop');

// paused: the job leaves it alone even when its reminder is due
await setInvoiceDate(inv3.number, 'dueDate', 3); // before_due would be today
const pausedRun = await curl(CRON_SECRET);
check('the job skips a paused invoice (not even looked at)', pausedRun.body.sent === 0 && inbox().length === mailsBefore3 + 1, JSON.stringify(pausedRun.body));
await A.goto(BASE + `/invoices/${inv3._id}`);
await waitSel(A, '[data-testid="reminders"]');
await clickSwitch(A, '[data-testid="reminders"]', 0);
check('"Pause reminders" off again: toast "Reminders resumed"', await hasText(A, 'Reminders resumed'));
await gone(A, 'Reminders resumed');
const resumedRun = await curl(CRON_SECRET);
check('after resuming, the job sends the reminder that is due (and it counts as the day-of-send guard allows)', resumedRun.body.sent === 0 && resumedRun.body.skipped >= 1, JSON.stringify(resumedRun.body)); // a manual reminder went out today: no automatic one within 24 hours

// =====================================================================
// 4. The client's page: Pay now
// =====================================================================
const share2 = (await call('GET', `/invoices/${inv2._id}`, T)).body.invoice.shareUrl;
const C = await freshPage('C-client');
await C.goto(share2);
await C.waitForSelector('[data-testid="invoice-number"]', { timeout: 10000 });
const pay = await C.evaluate(() => {
  const a = document.querySelector('[data-testid="pay-now"]');
  return { href: a?.getAttribute('href'), target: a?.target, rel: a?.rel, text: a?.innerText.trim(), details: document.querySelector('[data-testid="payment-details"]')?.innerText.replace(/\s+/g, ' ').trim(), heading: document.querySelector('[data-testid="payment-instructions"] h2')?.innerText, bg: a && getComputedStyle(a).backgroundColor };
});
check('the public invoice has a green "Pay now" button that opens the payment link in a new tab, safely', pay.text === 'Pay now' && pay.href === 'https://rzp.io/l/alex-morgan' && pay.target === '_blank' && /noopener/.test(pay.rel) && pay.bg === (await colorOf(C, 'bg-emerald-600', 'backgroundColor')) && pay.heading === 'Pay this invoice', JSON.stringify(pay));
check('...with the UPI ID and the bank details below it', pay.details.includes('alex.morgan@okhdfcbank') && pay.details.includes('HDFC Bank') && pay.details.includes('Account no: 50100123456789'), pay.details);
const order = await C.evaluate(() => { const btn = document.querySelector('[data-testid="pay-now"]').getBoundingClientRect(); const det = document.querySelector('[data-testid="payment-details"]').getBoundingClientRect(); const paper = document.querySelector('article.invoice-paper').getBoundingClientRect(); return btn.top > paper.bottom && det.top > btn.bottom; });
check('the order on the page: the invoice, then Pay now, then the details', order);
await shot(C, '08-public-pay-now-desktop', { fullPage: true });

// printed: the details stay, the button goes
await C.setViewport({ width: 794, height: 1123 });
await C.emulateMediaType('print');
await sleep(300);
const printed = await C.evaluate(() => ({ button: getComputedStyle(document.querySelector('[data-testid="pay-now"]')).display, details: getComputedStyle(document.querySelector('[data-testid="payment-details"]')).display }));
const pdf = await C.pdf({ preferCSSPageSize: true, printBackground: true });
writeFileSync(SHOTS + 'public-invoice-with-payment-details.pdf', pdf);
check('when printed: the Pay now button is hidden and the UPI / bank details stay on the page (one A4 page)', printed.button === 'none' && printed.details !== 'none' && pdfInfo(pdf).pages === 1, JSON.stringify({ ...printed, ...pdfInfo(pdf) }));
await C.emulateMediaType('screen');
await C.setViewport({ width: 1280, height: 800 });

// the public answer: exactly the payment fields
const token2 = share2.split('/i/')[1];
const raw = (await (await fetch(API + '/public/invoices/' + token2)).json()).invoice;
check('black box: the public JSON has payment { link, upiId, bankDetails } and no other owner data', JSON.stringify(Object.keys(raw.payment).sort()) === JSON.stringify(['bankDetails', 'link', 'upiId']) && !/"(reminders|userId|passwordHash|roundingMinutes\\":\d+,\\"rem)"/.test(JSON.stringify(raw)));

// no link: the details stay, the button goes; nothing set up: no block at all; paid: no block
await call('PATCH', '/auth/me', T, { payment: { link: '' } });
await C.reload();
await C.waitForSelector('[data-testid="payment-instructions"]');
check('without a payment link: no Pay now button, but the heading is "How to pay" and the UPI / bank details are there', !(await C.$('[data-testid="pay-now"]')) && (await C.$eval('[data-testid="payment-instructions"] h2', (h) => h.innerText)) === 'How to pay' && (await C.$eval('[data-testid="payment-details"]', (d) => d.innerText)).includes('alex.morgan@okhdfcbank'));
await shot(C, '09-public-how-to-pay-no-link-desktop', { fullPage: true });
await call('PATCH', '/auth/me', T, { payment: { upiId: '', bankDetails: '' } });
await C.reload();
await C.waitForSelector('[data-testid="invoice-number"]');
await sleep(300);
check('with nothing set up: no payment block at all', !(await C.$('[data-testid="payment-instructions"]')));
await call('PATCH', '/auth/me', T, { payment: { link: 'https://rzp.io/l/alex-morgan', upiId: 'alex.morgan@okhdfcbank', bankDetails: 'HDFC Bank' } });
const sharePaid = (await call('GET', `/invoices/${inv1._id}`, T)).body.invoice.shareUrl;
await C.goto(sharePaid);
await C.waitForSelector('[data-testid="invoice-number"]');
await sleep(300);
check('a PAID invoice shows no payment block, even though the owner has payment details', !(await C.$('[data-testid="payment-instructions"]')) && (await C.$eval('[data-testid="invoice-status"]', (e) => e.innerText.trim())) === 'Paid');

// the invoice e-mail has Pay now too
const mailsNow = inbox().length;
const draftSend = await call('POST', `/invoices/${draft._id}/send`, T, {});
const invoiceMail = inbox().slice(mailsNow)[0];
check('the invoice e-mail (Send invoice) has Pay now and the UPI ID as well', draftSend.status === 200 && invoiceMail.body.includes('Pay now:\nhttps://rzp.io/l/alex-morgan') && invoiceMail.body.includes('UPI ID: alex.morgan@okhdfcbank'));

// =====================================================================
// 5. Phone (375px)
// =====================================================================
const M = await freshPage('M-phone', { width: 375, height: 667, mobile: true });
await withToken(M, T, '/settings');
await waitSel(M, card('reminders-settings'));
check('Phone: the Settings page with the reminder and payment cards fits the screen', (await overflow(M)) <= 0 && (await offScreen(M, 375)) === 0 && (await M.evaluate(() => window.innerWidth)) === 375, `off=${await offScreen(M, 375)}`);
await shot(M, '10-settings-reminders-mobile');
await M.evaluate(() => document.querySelector('[data-testid="payment-settings"]').scrollIntoView());
await shot(M, '11-settings-payment-mobile');
await M.goto(BASE + `/invoices/${inv2._id}`);
await waitSel(M, '[data-testid="reminders"]');
const mtl = await M.evaluate(() => { const li = [...document.querySelectorAll('[data-testid="invoice-timeline"] li')].map((e) => e.getBoundingClientRect()); return { five: li.length, stacked: li.every((r, i) => i === 0 || (r.top > li[i - 1].top + 10 && Math.abs(r.left - li[0].left) < 2)) }; });
check('Phone: the invoice page with the reminders fits, and the 5-step timeline is vertical', mtl.five === 5 && mtl.stacked && (await overflow(M)) <= 0 && (await offScreen(M, 375)) === 0, `${JSON.stringify(mtl)} off=${await offScreen(M, 375)}`);
await shot(M, '12-invoice-reminders-mobile');
await M.goto(BASE + '/invoices');
await M.waitForSelector('main ul > li a[href^="/invoices/"]');
check('Phone: the invoices list with the bells fits the screen', (await overflow(M)) <= 0 && (await offScreen(M, 375)) === 0);
const MC = await freshPage('M-client', { width: 375, height: 667, mobile: true });
await MC.goto(share2);
await MC.waitForSelector('[data-testid="payment-instructions"]', { timeout: 10000 });
const mpay = await MC.evaluate(() => { const r = document.querySelector('[data-testid="pay-now"]').getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width }; });
check('Phone: the Pay now button is full width, inside the screen, and nothing runs off the edge', mpay.left >= 0 && mpay.right <= 375 && mpay.width > 250 && (await overflow(MC)) <= 0 && (await offScreen(MC, 375)) === 0, JSON.stringify(mpay));
await MC.evaluate(() => document.querySelector('[data-testid="payment-instructions"]').scrollIntoView());
await shot(MC, '13-public-pay-now-mobile');

// =====================================================================
check('isolated: no request went to the dev servers on 5000/5173', blocked.length === 0, blocked.join(' | '));
check('no unexpected console/page errors', consoleErrors.length === 0, consoleErrors.join(' | '));

await browser.close();
console.log(failures === 0 ? '\nALL PHASE 1B BROWSER CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
