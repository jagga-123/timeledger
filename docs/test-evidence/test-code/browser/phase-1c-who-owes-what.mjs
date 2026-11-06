import { mkdirSync, readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { launchEdge } from './launch-edge.mjs';

const run = promisify(execFile);
const BASE = process.env.E2E_BASE || 'http://localhost:5273';
const API = process.env.E2E_API || 'http://localhost:5100/api';
const BACKEND = 'C:/Users/sande/OneDrive/Desktop/timeledger/backend';
const URI_FILE = process.env.E2E_MONGO_URI_FILE;
if (!URI_FILE) throw new Error('E2E_MONGO_URI_FILE is required');
const SHOTS = new URL('./shots-p1c/', import.meta.url).pathname.replace(/^\//, '');
mkdirSync(SHOTS, { recursive: true });
const ZONE = 'Asia/Kolkata';

let failures = 0;
const check = (name, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
const cents = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const sum = (list, pick = (x) => x) => cents(list.reduce((total, item) => total + pick(item), 0));
const localDay = (date, zone = ZONE) => new Date(date).toLocaleDateString('en-CA', { timeZone: zone });
const dayDiff = (a, b) => Math.round((new Date(localDay(b) + 'T00:00:00Z') - new Date(localDay(a) + 'T00:00:00Z')) / 86400000);

// ---------- API, database ----------
const call = async (method, path, token, body) => {
  const res = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const mongoUri = () => readFileSync(URI_FILE, 'utf8').trim();
const runSeed = async () => (await run('node', ['src/seed.js'], { cwd: BACKEND, env: { ...process.env, MONGODB_URI: mongoUri() }, timeout: 120000 })).stdout;
// The throwaway database: no screen can move a due date, so it is set here (days from now; negative = in the past)
const setInvoiceDate = async (number, field, daysFromNow) => {
  const code = "import mongoose from 'mongoose'; await mongoose.connect(process.env.URI); const r = await mongoose.connection.collection('invoices').updateOne({ userId: (await mongoose.connection.collection('users').findOne({ email: 'demo@timeledger.app' }))._id, number: process.argv[1] }, { $set: { [process.argv[2]]: new Date(Date.now() + Number(process.argv[3]) * 86400000) } }); console.log(r.modifiedCount); await mongoose.disconnect();";
  const { stdout } = await run('node', ['--input-type=module', '-e', code, number, field, String(daysFromNow)], { cwd: BACKEND, env: { ...process.env, URI: mongoUri() } });
  return stdout.trim() === '1';
};
const loginDemo = async () => (await call('POST', '/auth/login', null, { email: 'demo@timeledger.app', password: 'Demo@1234' })).body.token;
const invoiceList = async (token) => (await call('GET', '/invoices', token)).body.invoices;

// ---------- browser ----------
const browser = await launchEdge();
const consoleErrors = [];
const blocked = [];
const newContext = () => (browser.createBrowserContext ? browser.createBrowserContext() : browser.createIncognitoBrowserContext());
const freshPage = async (label, { width = 1280, height = 800, mobile = false, beforeLoad } = {}) => {
  const context = await newContext();
  const page = await context.newPage();
  await page.setViewport({ width, height, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
  await page.emulateTimezone(ZONE);
  if (beforeLoad) await page.evaluateOnNewDocument(beforeLoad);
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    if (/localhost:(5000|5173)\b/.test(r.url())) { blocked.push(r.url()); r.abort(); return; }
    r.continue();
  });
  page.on('pageerror', (e) => consoleErrors.push(`[${label}] pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/status of (400|401|404|409|429|502)/.test(m.text())) consoleErrors.push(`[${label}] ${m.text()}`);
  });
  return page;
};
const settled = (page, selector = 'main') => page.waitForFunction((s) => !document.querySelector('.animate-spin') && document.querySelector(s), { timeout: 10000 }, selector);
const open = async (page, token, path) => {
  await page.goto(BASE + '/login');
  await page.evaluate((t) => localStorage.setItem('token', t), token);
  await page.goto(BASE + path);
  await settled(page);
};
const waitSel = (page, sel, timeout = 8000) => page.waitForSelector(sel, { timeout }).then(() => true, () => false);
const hasText = (page, t, timeout = 6000) => page.waitForFunction((s) => document.body.innerText.includes(s), { timeout }, t).then(() => true, () => false);
const shot = (page, name, options = {}) => page.screenshot({ path: SHOTS + name + '.png', ...options });
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const offScreen = (page) => page.evaluate(() => { const w = document.documentElement.clientWidth; return [...document.querySelectorAll('body *')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > w + 1 && !el.closest('[data-rht-toaster]'); }).length; });
const text = (page, sel) => page.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ').trim());
const texts = (page, sel) => page.$$eval(sel, (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
const colorOf = (page, cls, prop = 'color') => page.evaluate((c, p) => { const s = document.createElement('span'); s.className = c; document.body.appendChild(s); const v = getComputedStyle(s)[p]; s.remove(); return v; }, cls, prop);
const styleOf = (page, sel, prop) => page.$eval(sel, (e, p) => getComputedStyle(e)[p], prop);
const clickText = async (page, selector, label) => {
  const handle = await page.evaluateHandle((s, t) => [...document.querySelectorAll(s)].find((e) => e.innerText.trim() === t && e.offsetParent !== null), selector, label);
  const el = handle.asElement();
  if (!el) throw new Error(`Nothing "${label}" in ${selector}`);
  await el.click();
};
// the sidebar badge that is on screen (desktop sidebar or phone tab bar)
const badge = (page) => page.evaluate(() => { const b = [...document.querySelectorAll('[data-testid="overdue-badge"]')].find((e) => e.offsetParent !== null); return b ? { text: b.innerText.trim(), label: b.getAttribute('aria-label'), bg: getComputedStyle(b).backgroundColor, rect: b.getBoundingClientRect().toJSON() } : null; });
const card = (page, id) => page.$eval(`[data-testid="${id}"]`, (e) => { const p = [...e.querySelectorAll('p')]; return { label: p[0].innerText, value: p[1].innerText.trim(), note: p[2]?.innerText.trim() ?? '' }; });
const legend = (page) => page.$$eval('[data-bucket]', (lis) => Object.fromEntries(lis.map((li) => { const p = li.querySelectorAll('p'); return [li.dataset.bucket, { amount: p[1].innerText.trim(), count: p[2].innerText.trim() }]; })));
const moneyReady = (page) => page.waitForFunction(() => { const c = document.querySelector('[data-testid="money-outstanding"] p.font-mono'); return c && c.innerText.trim() !== '—'; }, { timeout: 10000 });

// =====================================================================
// 0. The demo data, and the numbers from the API (checked against the invoices list and the entries totals)
// =====================================================================
await runSeed();
let T = await loginDemo();
const invoices0 = await invoiceList(T);
const byNumber = (list, number) => list.find((i) => i.number === number);
const globex = byNumber(invoices0, 'INV-0001'); // paid
const acme = byNumber(invoices0, 'INV-0002'); // sent, not due yet
const initech = byNumber(invoices0, 'INV-0003'); // sent, overdue
check('the demo has 3 invoices: Globex paid, Acme sent (not due yet), Initech sent and overdue', invoices0.length === 3 && globex.status === 'paid' && acme.displayStatus === 'sent' && initech.displayStatus === 'overdue', JSON.stringify(invoices0.map((i) => `${i.number}:${i.displayStatus}:${i.daysOverdue}`)));
check('Initech\'s invoice is 7 to 13 days overdue', initech.daysOverdue >= 7 && initech.daysOverdue <= 13, String(initech.daysOverdue));

const summary0 = (await call('GET', '/receivables/summary', T)).body.summary;
check('summary: outstanding is every sent invoice (Acme + Initech)', summary0.outstanding.amount === sum([acme, initech], (i) => i.total) && summary0.outstanding.count === 2, JSON.stringify(summary0.outstanding));
check('summary: overdue is Initech\'s invoice, and it is the oldest one', summary0.overdue.amount === initech.total && summary0.overdue.count === 1 && summary0.overdue.oldest.clientName === 'Initech' && summary0.overdue.oldest.days === initech.daysOverdue && summary0.overdue.oldest.number === 'INV-0003', JSON.stringify(summary0.overdue));
check('summary: aging has Acme as current and Initech as 1-30 days', JSON.stringify(summary0.aging) === JSON.stringify([{ key: 'current', amount: acme.total, count: 1 }, { key: '1-30', amount: initech.total, count: 1 }, { key: '31-60', amount: 0, count: 0 }, { key: '61+', amount: 0, count: 0 }]), JSON.stringify(summary0.aging));
const globexDays = dayDiff(globex.sentAt, globex.paidAt);
check('summary: the average days to get paid is Globex\'s (sent to paid, counted on the calendar)', summary0.avgDaysToPay.days === globexDays && summary0.avgDaysToPay.count === 1, `${summary0.avgDaysToPay.days} vs ${globexDays}`);
const thisMonth = localDay(new Date()).slice(0, 7);
check('summary: paid this month is worked out from the paid date (Globex only counts when it was paid this month)', summary0.paidThisMonth.amount === (localDay(globex.paidAt).slice(0, 7) === thisMonth ? globex.total : 0), JSON.stringify(summary0.paidThisMonth));

const rows0 = (await call('GET', '/receivables/clients', T)).body.clients;
check('clients: Initech (overdue) first, then Acme (owes), then Globex (all paid)', rows0.map((r) => r.client.name).join() === 'Initech,Acme Corp,Globex Ltd', rows0.map((r) => r.client.name).join());
const entryTotals = (await call('GET', '/entries?status=unbilled&billable=true', T)).body.totals;
check('clients: the unbilled amounts add up to the unbilled total of the time entries (worked out by a different route)', cents(rows0.reduce((total, r) => total + r.unbilledAmount, 0)) === entryTotals.unbilledAmount && rows0.every((r) => r.unbilledAmount > 0), `${sum(rows0, (r) => r.unbilledAmount)} vs ${entryTotals.unbilledAmount}`);
check('clients: Initech has an overdue invoice, last payment none; Globex paid and nothing owed', rows0[0].overdueCount === 1 && rows0[0].lastPaymentAt === null && rows0[2].outstanding === 0 && rows0[2].lastPaymentAt === globex.paidAt && rows0[2].paidTotal === globex.total);

// somebody else
const stranger = (await call('POST', '/auth/register', null, { name: 'Sam Stranger', email: `sam.${Date.now()}@example.com`, password: 'Stranger@123' })).body;
const strangerClient = (await call('POST', '/clients', stranger.token, { name: 'Secret Corp', email: 'ap@secret.example' })).body.client;
const peek = await call('GET', `/clients/${strangerClient._id}/overview`, T);
const nothing = await call('GET', `/clients/${'0'.repeat(24)}/overview`, T);
check('another user\'s client is a 404 with the same answer as one that does not exist', peek.status === 404 && nothing.status === 404 && JSON.stringify(peek.body) === JSON.stringify(nothing.body), `${peek.status}/${nothing.status}`);
check('a stranger sees none of the demo numbers', (await call('GET', '/receivables/summary', stranger.token)).body.summary.outstanding.amount === 0 && (await call('GET', '/receivables/clients', stranger.token)).body.clients.length === 1);
check('no login, no numbers (401)', (await call('GET', '/receivables/summary')).status === 401 && (await call('GET', '/receivables/clients')).status === 401);

// =====================================================================
// 1. Dashboard: the alert, the money cards, the aging bar and the sidebar badge
// =====================================================================
const A = await freshPage('A-demo');
await open(A, T, '/');
await moneyReady(A);
check('Dashboard: a red banner "1 invoice overdue · $X", and the oldest one ("Initech, N days")', (await waitSel(A, '[data-testid="overdue-banner"]')) && (await text(A, '[data-testid="overdue-banner-title"]')) === `1 invoice overdue · ${money(initech.total)}` && (await text(A, '[data-testid="overdue-banner-oldest"]')) === `Oldest: Initech, ${initech.daysOverdue} days`, `${await text(A, '[data-testid="overdue-banner-title"]')} | ${await text(A, '[data-testid="overdue-banner-oldest"]')}`);
check('...tinted red, at the top: above the timer', (await styleOf(A, '[data-testid="overdue-banner"]', 'backgroundColor')) === (await colorOf(A, 'bg-red-50', 'backgroundColor')) && (await A.evaluate(() => document.querySelector('[data-testid="overdue-banner"]').getBoundingClientRect().top < document.querySelector('[data-testid="money"]').getBoundingClientRect().top)));
check('...with a "View overdue" button that goes to the Overdue filter of Invoices', (await A.$eval('[data-testid="overdue-banner"] a', (a) => [a.innerText.trim(), a.getAttribute('href')])).join() === 'View overdue,/invoices?status=overdue');

const c1 = await card(A, 'money-outstanding');
const c2 = await card(A, 'money-overdue');
const c3 = await card(A, 'money-paid');
const c4 = await card(A, 'money-average');
check('Money row: Outstanding (both sent invoices) with its note', c1.label.toLowerCase() === 'outstanding' && c1.value === money(sum([acme, initech], (i) => i.total)) && c1.note === '2 unpaid invoices', JSON.stringify(c1));
check('Money row: Overdue is red, with "1 invoice · oldest N days"', c2.value === money(initech.total) && c2.note === `1 invoice · oldest ${initech.daysOverdue} days` && (await styleOf(A, '[data-testid="money-overdue"] p.font-mono', 'color')) === (await colorOf(A, 'text-red-600')), JSON.stringify(c2));
check('Money row: Paid this month is emerald when there is something', c3.value === money(summary0.paidThisMonth.amount) && (summary0.paidThisMonth.amount === 0 || (await styleOf(A, '[data-testid="money-paid"] p.font-mono', 'color')) === (await colorOf(A, 'text-emerald-600'))), JSON.stringify(c3));
check('Money row: the average days to get paid, over the last 90 days', c4.value === `${globexDays} days` && c4.note === 'last 90 days · 1 invoice', JSON.stringify(c4));

const leg = await legend(A);
check('Aging bar legend: Current has Acme\'s invoice, 1–30 days has Initech\'s, the others are empty', leg.current.amount === money(acme.total) && leg['1-30'].amount === money(initech.total) && leg['31-60'].amount === '$0.00' && leg['61+'].count === '0 invoices' && leg.current.count === '1 invoice', JSON.stringify(leg));
const parts0 = await A.$$eval('[data-part]', (els) => els.map((e) => [e.dataset.part, e.getBoundingClientRect().width]));
const barWidth = await A.$eval('[data-testid="aging-bar"]', (e) => e.getBoundingClientRect().width);
check('Aging bar: one stacked bar with a part for each bucket that has money, as wide as its share', parts0.length === 2 && Math.abs(parts0[0][1] / barWidth - acme.total / (acme.total + initech.total)) < 0.015, JSON.stringify(parts0.map(([k, w]) => [k, Math.round((w / barWidth) * 100) + '%'])));
check('Aging bar: a text alternative for screen readers', (await A.$eval('[data-testid="aging-bar"]', (e) => e.getAttribute('aria-label'))).startsWith('Unpaid invoices by age: Current'));
const b0 = await badge(A);
check('Sidebar: a small red "1" badge next to Invoices (and nothing on the other items)', b0 && b0.text === '1' && b0.label === '1 overdue invoice' && b0.bg === (await colorOf(A, 'bg-red-600', 'backgroundColor')) && (await A.$$('[data-testid="overdue-badge"]')).length === 2, JSON.stringify(b0));
check('Sidebar: the badge sits inside the Invoices link', await A.evaluate(() => [...document.querySelectorAll('aside a')].find((a) => a.innerText.includes('Invoices'))?.querySelector('[data-testid="overdue-badge"]') !== null));
await shot(A, '01-dashboard-overdue-desktop');

// dismiss for the day
const todayKeyIST = localDay(new Date());
await A.click('[aria-label="Dismiss until tomorrow"]');
await A.waitForFunction(() => !document.querySelector('[data-testid="overdue-banner"]'), { timeout: 5000 }).catch(() => {});
check('Dismiss (X): the banner goes, and the money cards and the badge stay', !(await A.$('[data-testid="overdue-banner"]')) && Boolean(await A.$('[data-testid="money"]')) && (await badge(A))?.text === '1');
check('...for the day: it is remembered in the browser (today\'s date)', (await A.evaluate(() => localStorage.getItem('timeledger.overdueBannerDismissedOn'))) === todayKeyIST);
await A.reload(); await settled(A); await moneyReady(A);
check('...and still hidden after a reload', !(await A.$('[data-testid="overdue-banner"]')));
await A.evaluate(() => localStorage.setItem('timeledger.overdueBannerDismissedOn', '2000-01-01'));
await A.reload(); await settled(A); await moneyReady(A);
check('...a dismissal from another day does not count: the banner is back tomorrow', Boolean(await A.$('[data-testid="overdue-banner"]')));
await shot(A, '02-banner-dismissed-desktop');

// View overdue
await A.evaluate(() => localStorage.removeItem('timeledger.overdueBannerDismissedOn'));
await A.reload(); await settled(A); await moneyReady(A);
await clickText(A, '[data-testid="overdue-banner"] a', 'View overdue');
await A.waitForSelector('[aria-label="Filter by status"]');
await A.waitForSelector('main ul > li a[href^="/invoices/"]');
check('View overdue: Invoices opens with the Overdue filter already on, showing only the overdue invoice', (await A.evaluate(() => location.pathname + location.search)) === '/invoices?status=overdue' && (await A.$eval('[aria-label="Filter by status"] [aria-pressed="true"]', (b) => b.innerText.trim())) === 'Overdue' && (await texts(A, 'main ul > li a[href^="/invoices/"]')).length === 1 && (await text(A, 'main ul > li a[href^="/invoices/"]')).includes('INV-0003'));
await shot(A, '03-invoices-overdue-filter-desktop');

// an unknown status in the address is ignored
await A.goto(BASE + '/invoices?status=nonsense'); await settled(A); await A.waitForSelector('[aria-label="Filter by status"]');
check('an unknown ?status= is ignored (All is on)', (await A.$eval('[aria-label="Filter by status"] [aria-pressed="true"]', (b) => b.innerText.trim())) === 'All');

// =====================================================================
// 2. The clients page: who owes me what
// =====================================================================
await A.goto(BASE + '/clients'); await settled(A); await A.waitForSelector('[data-testid="client-row"]');
const rowText = async (name) => A.evaluate((n) => { const row = [...document.querySelectorAll('[data-testid="client-row"]')].find((r) => r.querySelector('a').innerText.trim() === n); const g = (id) => row?.querySelector(`[data-testid="${id}"]`)?.innerText.replace(/\s+/g, ' ').trim(); return row ? { status: g('client-status'), outstanding: g('client-outstanding'), overdue: g('client-overdue'), unbilled: g('client-unbilled'), last: g('client-last-payment'), href: row.querySelector('a').getAttribute('href') } : null; }, name);
const order = async () => (await A.$$eval('[data-testid="client-row"] a', (as) => as.filter((a) => a.getAttribute('href').startsWith('/clients/')).map((a) => a.innerText.trim())));
const rInit = await rowText('Initech'); const rAcme = await rowText('Acme Corp'); const rGlob = await rowText('Globex Ltd');
const unb = Object.fromEntries(rows0.map((r) => [r.client.name, r.unbilledAmount]));
check('Clients: sorted "Overdue first" by default: Initech, Acme Corp, Globex Ltd', (await order()).join() === 'Initech,Acme Corp,Globex Ltd');
check('Initech: red "Overdue", its overdue amount with "N days", unbilled amount, no payment yet', rInit.status === 'Overdue' && rInit.overdue === `${money(initech.total)} ${initech.daysOverdue} days` && rInit.outstanding === money(initech.total) && rInit.unbilled === money(unb.Initech) && rInit.last === '—', JSON.stringify(rInit));
check('Acme Corp: amber "Owes $X", nothing overdue', rAcme.status === `Owes ${money(acme.total)}` && rAcme.overdue === '—' && rAcme.outstanding === money(acme.total) && rAcme.unbilled === money(unb['Acme Corp']), JSON.stringify(rAcme));
check('Globex Ltd: emerald "All paid" with the date of the last payment', rGlob.status === 'All paid' && rGlob.outstanding === '$0.00' && rGlob.last === new Date(globex.paidAt).toLocaleDateString('en-GB', { timeZone: ZONE, day: 'numeric', month: 'short', year: 'numeric' }), JSON.stringify(rGlob));
const badgeColors = await A.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-testid="client-row"]')].map((r) => [r.querySelector('a').innerText.trim(), getComputedStyle(r.querySelector('[data-testid="client-status"] span')).color])));
check('...the colours are red, amber and emerald', badgeColors.Initech === (await colorOf(A, 'text-red-700')) && badgeColors['Acme Corp'] === (await colorOf(A, 'text-amber-700')) && badgeColors['Globex Ltd'] === (await colorOf(A, 'text-emerald-700')), JSON.stringify(badgeColors));
check('the old things are still there: project count, company, e-mail, Edit and Delete', (await A.$$('[data-testid="client-row"] button')).length === 6 && (await text(A, '[data-testid="client-row"]')).includes('1 project') && (await text(A, '[data-testid="client-row"]')).includes('Initech Inc.'));
await shot(A, '04-clients-desktop');

await A.select('select', 'outstanding');
check('Sort "Outstanding": the biggest amount owed first, whoever is late', (await order()).join() === [['Initech', initech.total], ['Acme Corp', acme.total], ['Globex Ltd', 0]].sort((a, b) => b[1] - a[1]).map(([n]) => n).join());
await A.select('select', 'name');
check('Sort "Name": alphabetical', (await order()).join() === 'Acme Corp,Globex Ltd,Initech');
await A.select('select', 'overdue');
await clickText(A, 'button', 'Owes me money');
check('Filter "Owes me money": only the clients with something outstanding', (await order()).join() === 'Initech,Acme Corp' && (await A.$eval('button[aria-pressed="true"]', (b) => b.innerText.trim())) === 'Owes me money');
await shot(A, '05-clients-owes-me-money-desktop');
await clickText(A, 'button', 'Owes me money');
check('...and the chip switches it off again', (await order()).length === 3);

// open a client
await A.click('[data-testid="client-row"] a');
await A.waitForSelector('[data-testid="client-metrics"]');
check('Clicking a client opens /clients/:id', /^\/clients\/[0-9a-f]{24}$/.test(await A.evaluate(() => location.pathname)) && (await text(A, 'h1')) === 'Initech');

// =====================================================================
// 3. One client
// =====================================================================
const clients = (await call('GET', '/clients', T)).body.clients;
const idOf = (name) => clients.find((c) => c.name === name)._id;
await A.goto(BASE + `/clients/${idOf('Acme Corp')}`); await settled(A); await A.waitForSelector('[data-testid="client-metrics"]');
const ov = (await call('GET', `/clients/${idOf('Acme Corp')}/overview`, T)).body;
check('Client page: the name, and the contact (company and e-mail)', (await text(A, 'h1')) === 'Acme Corp' && (await text(A, 'main')).includes('Acme Corporation · accounts@acme.example'));
const m = { out: await card(A, 'metric-outstanding'), over: await card(A, 'metric-overdue'), unb: await card(A, 'metric-unbilled'), paid: await card(A, 'metric-paid') };
check('Four metric cards: Outstanding, Overdue, Unbilled and Paid, with the same numbers as the API', m.out.value === money(acme.total) && m.over.value === '$0.00' && m.over.note === 'Nothing is late' && m.unb.value === money(ov.metrics.unbilledAmount) && m.paid.value === '$0.00' && m.paid.note === 'No payments yet', JSON.stringify(m));
check('...the Unbilled card says how much time that is', /^\d+h \d+m in \d+ entries$/.test(m.unb.note), m.unb.note);
check('Its invoices, with status badges', (await texts(A, '[data-testid="client-invoices"] li')).length === 1 && (await text(A, '[data-testid="client-invoices"]')).includes('INV-0002') && (await text(A, '[data-testid="client-invoices"]')).includes('Sent'));
check('Two buttons: "New invoice" and, because there is unbilled time, "Invoice unbilled time"', (await texts(A, 'main button')).filter((t) => ['New invoice', 'Invoice unbilled time'].includes(t)).join() === 'Invoice unbilled time,New invoice');
await shot(A, '06-client-detail-desktop');

// New invoice, filled in with this client
await clickText(A, 'main button', 'New invoice');
await A.waitForSelector('[role="dialog"] #clientId');
check('"New invoice" opens the modal with this client already chosen', (await A.$eval('#clientId', (s) => s.options[s.selectedIndex].text)) === 'Acme Corp' && (await A.$eval('#clientId', (s) => s.value)) === idOf('Acme Corp'));
await A.keyboard.press('Escape');
await A.waitForFunction(() => !document.querySelector('[role="dialog"]'), { timeout: 4000 }).catch(() => {});

// Invoice unbilled time: client and the exact days of the unbilled time, with the preview
await clickText(A, 'main button', 'Invoice unbilled time');
await A.waitForSelector('[data-testid="preview-total"]', { timeout: 10000 });
const filled = await A.evaluate(() => ({ client: document.querySelector('#clientId').value, from: document.querySelector('#from').value, to: document.querySelector('#to').value, total: document.querySelector('[data-testid="preview-total"]').innerText.trim() }));
check('"Invoice unbilled time": the client and the days of the unbilled time are filled in', filled.client === idOf('Acme Corp') && filled.from === ov.unbilled.from && filled.to === ov.unbilled.to, JSON.stringify(filled));
check('...and the preview total is exactly the unbilled amount of the card', filled.total === m.unb.value, `${filled.total} vs ${m.unb.value}`);
await shot(A, '07-invoice-unbilled-time-modal-desktop');
await A.keyboard.press('Escape');

// unknown clients
await A.goto(BASE + `/clients/${'0'.repeat(24)}`); await settled(A);
check('A client that does not exist: "Client not found" with a way back', (await hasText(A, 'Client not found')) && (await hasText(A, 'Back to clients')));
await A.goto(BASE + `/clients/${strangerClient._id}`); await settled(A);
check('Somebody else\'s client looks the same: "Client not found", no name, no numbers', (await hasText(A, 'Client not found')) && !(await A.evaluate(() => document.body.innerText.includes('Secret Corp'))));
await A.goto(BASE + '/clients/not-an-id'); await settled(A);
check('A broken id is "Client not found" too', await hasText(A, 'Client not found'));
await shot(A, '08-client-not-found-desktop');

// =====================================================================
// 4. A spread over all four buckets (due dates moved in the throwaway database), and the invoice made from "unbilled time"
// =====================================================================
await A.goto(BASE + `/clients/${idOf('Initech')}`); await settled(A); await A.waitForSelector('[data-testid="client-metrics"]');
const initechBefore = (await call('GET', `/clients/${idOf('Initech')}/overview`, T)).body;
await clickText(A, 'main button', 'Invoice unbilled time');
await A.waitForSelector('[data-testid="preview-total"]', { timeout: 10000 });
await A.waitForFunction(() => !document.querySelector('[role="dialog"] button[type="submit"]').disabled, { timeout: 8000 });
await A.click('[role="dialog"] button[type="submit"]');
await A.waitForFunction(() => /^\/invoices\/[0-9a-f]{24}$/.test(location.pathname), { timeout: 10000 });
check('Creating the invoice from "Invoice unbilled time" bills all of Initech\'s unbilled time (the new invoice is as big as the card said)', (await call('GET', '/invoices', T)).body.invoices.some((i) => i.client.name === 'Initech' && i.number === 'INV-0004' && i.total === initechBefore.metrics.unbilledAmount));
await A.goto(BASE + `/clients/${idOf('Initech')}`); await settled(A); await A.waitForSelector('[data-testid="client-metrics"]');
check('...and the client page now has nothing unbilled and no "Invoice unbilled time" button', (await card(A, 'metric-unbilled')).value === '$0.00' && !(await texts(A, 'main button')).includes('Invoice unbilled time') && (await text(A, '[data-testid="client-invoices"]')).includes('INV-0004'));

// Acme and Globex: invoice the unbilled time and send it, then move the due dates
const makeSent = async (name) => {
  const o = (await call('GET', `/clients/${idOf(name)}/overview`, T)).body;
  const made = (await call('POST', '/invoices', T, { clientId: idOf(name), from: o.unbilled.from, to: o.unbilled.to })).body.invoice;
  const sent = await call('POST', `/invoices/${made._id}/send`, T, {});
  return { number: made.number, status: sent.status };
};
const acme2 = await makeSent('Acme Corp'); // -> 1-30
const globex2 = await makeSent('Globex Ltd'); // -> stays current
check('(set-up) two more invoices were made from unbilled time and sent', acme2.status === 200 && globex2.status === 200, JSON.stringify([acme2, globex2]));
await setInvoiceDate(acme2.number, 'dueDate', -5); //   5 days overdue   -> 1-30
await setInvoiceDate('INV-0002', 'dueDate', -40); //   Acme: 40 days    -> 31-60
await setInvoiceDate('INV-0003', 'dueDate', -70); //   Initech: 70 days -> 61+
const invs = await invoiceList(T);
const bucketOf = (d) => (d <= 0 ? 'current' : d <= 30 ? '1-30' : d <= 60 ? '31-60' : '61+');
const expected = Object.fromEntries(['current', '1-30', '31-60', '61+'].map((k) => [k, invs.filter((i) => i.status === 'sent' && bucketOf(i.daysOverdue) === k)]));
check('(set-up) one unpaid invoice in every bucket', Object.values(expected).every((l) => l.length >= 1), JSON.stringify(Object.fromEntries(Object.entries(expected).map(([k, l]) => [k, l.length]))));

await A.evaluate(() => localStorage.removeItem('timeledger.overdueBannerDismissedOn'));
await A.goto(BASE + '/'); await settled(A); await moneyReady(A);
const leg2 = await legend(A);
check('Aging: the legend has the amounts and counts of every bucket (worked out from the invoices list)', ['current', '1-30', '31-60', '61+'].every((k) => leg2[k].amount === money(sum(expected[k], (i) => i.total)) && leg2[k].count === `${expected[k].length} ${expected[k].length === 1 ? 'invoice' : 'invoices'}`), JSON.stringify(leg2));
const widths = await A.$$eval('[data-part]', (els) => els.map((e) => [e.dataset.part, e.getBoundingClientRect().width]));
const bar2 = await A.$eval('[data-testid="aging-bar"]', (e) => e.getBoundingClientRect().width);
const totalUnpaid = sum(invs.filter((i) => i.status === 'sent'), (i) => i.total);
check('Aging: four parts in order, each as wide as its share of everything unpaid (within 1.5%)', widths.map(([k]) => k).join() === 'current,1-30,31-60,61+' && widths.every(([k, w]) => Math.abs(w / bar2 - sum(expected[k], (i) => i.total) / totalUnpaid) < 0.015), JSON.stringify(widths.map(([k, w]) => [k, Math.round((w / bar2) * 100) + '%'])));
const partColors = await A.$$eval('[data-part]', (els) => els.map((e) => getComputedStyle(e).backgroundColor));
check('...in four different colours, from emerald to red', new Set(partColors).size === 4 && partColors[0] === (await colorOf(A, 'bg-emerald-500', 'backgroundColor')) && partColors[3] === (await colorOf(A, 'bg-red-600', 'backgroundColor')), JSON.stringify(partColors));
const overdueNow = invs.filter((i) => i.displayStatus === 'overdue');
check('The banner counts every overdue invoice and names the oldest (Initech, 70 days)', (await text(A, '[data-testid="overdue-banner-title"]')) === `${overdueNow.length} invoices overdue · ${money(sum(overdueNow, (i) => i.total))}` && (await text(A, '[data-testid="overdue-banner-oldest"]')) === 'Oldest: Initech, 70 days', `${await text(A, '[data-testid="overdue-banner-title"]')}`);
check('The sidebar badge shows the count', (await badge(A))?.text === String(overdueNow.length));
await shot(A, '09-dashboard-all-buckets-desktop');

await A.goto(BASE + '/clients'); await settled(A); await A.waitForSelector('[data-testid="client-row"]');
const spreadRows = (await call('GET', '/receivables/clients', T)).body.clients;
check('Clients: ordered by overdue amount (the API and the page agree)', (await order()).join() === spreadRows.map((r) => r.client.name).join(), `${(await order()).join()} | ${spreadRows.map((r) => r.client.name).join()}`);
await shot(A, '10-clients-spread-desktop');

// =====================================================================
// 5. Phone, 375px (a fresh demo)
// =====================================================================
await runSeed();
T = await loginDemo();
const M = await freshPage('M-phone', { width: 375, height: 667, mobile: true });
await open(M, T, '/');
await moneyReady(M);
const mTops = await M.$$eval('[data-testid^="money-"]', (els) => els.filter((e) => e.dataset.testid !== 'money').map((e) => { const r = e.getBoundingClientRect(); return { top: r.top, left: r.left, width: r.width }; }));
check('Phone: the banner and the Money cards fit; the four cards stack in one column', (await overflow(M)) <= 0 && (await offScreen(M)) === 0 && mTops.length === 4 && mTops.every((r, i) => i === 0 || (r.top > mTops[i - 1].top && Math.abs(r.left - mTops[0].left) < 2)) && mTops.every((r) => r.width > 300), `overflow=${await overflow(M)} off=${await offScreen(M)} ${JSON.stringify(mTops.map((r) => Math.round(r.width)))}`);
const bBtn = await M.$eval('[data-testid="overdue-banner"] a', (a) => a.getBoundingClientRect().toJSON());
check('Phone: the "View overdue" button is full width inside the banner', bBtn.left >= 16 && bBtn.right <= 359 && bBtn.width > 200, JSON.stringify([Math.round(bBtn.left), Math.round(bBtn.right)]));
await shot(M, '11-dashboard-mobile');
await M.evaluate(() => document.querySelector('[data-testid="aging"]').scrollIntoView());
const lis = await M.$$eval('[data-bucket]', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right) }; }));
check('Phone: the aging bar is as wide as the card and the legend sits in two columns, readable and inside the screen', lis.length === 4 && new Set(lis.map((l) => l.left)).size === 2 && lis.every((l) => l.right <= 375) && (await M.$eval('[data-testid="aging-bar"]', (e) => e.getBoundingClientRect().width)) > 280, JSON.stringify(lis));
await shot(M, '12-aging-bar-mobile');
const mb = await badge(M);
check('Phone: the badge is on the Invoices tab of the bottom bar, in the corner of its icon, inside the screen', mb && mb.text === '1' && mb.rect.right <= 375 && mb.rect.top > 550 && (await M.evaluate(() => [...document.querySelectorAll('nav a')].find((a) => a.innerText.includes('Invoices'))?.querySelector('[data-testid="overdue-badge"]') !== null)), JSON.stringify(mb));
await M.goto(BASE + '/clients'); await settled(M); await M.waitForSelector('[data-testid="client-row"]');
check('Phone: the clients page fits; each row has its four figures in two columns', (await overflow(M)) <= 0 && (await offScreen(M)) === 0 && (await M.$$eval('[data-testid="client-row"] dl', (dls) => dls.every((dl) => new Set([...dl.children].map((c) => Math.round(c.getBoundingClientRect().left))).size === 2))), `overflow=${await overflow(M)} off=${await offScreen(M)}`);
await shot(M, '13-clients-mobile');
await M.goto(BASE + `/clients/${(await call('GET', '/clients', T)).body.clients.find((c) => c.name === 'Initech')._id}`); await settled(M); await M.waitForSelector('[data-testid="client-metrics"]');
const cardTops = await M.$$eval('[data-testid="client-metrics"] > div', (els) => els.map((e) => e.getBoundingClientRect().top));
check('Phone: a client page fits; the four metric cards stack, the invoices list is readable', (await overflow(M)) <= 0 && (await offScreen(M)) === 0 && cardTops.length === 4 && cardTops.every((t, i) => i === 0 || t > cardTops[i - 1]), `overflow=${await overflow(M)} off=${await offScreen(M)}`);
await shot(M, '14-client-detail-mobile');
await M.goto(BASE + '/'); await settled(M); await moneyReady(M);
await M.setViewport({ width: 360, height: 640, isMobile: true, hasTouch: true });
check('Phone at 360px: the dashboard still fits', (await overflow(M)) <= 0 && (await offScreen(M)) === 0, `overflow=${await overflow(M)} off=${await offScreen(M)}`);

// =====================================================================
// 6. The badge and the banner follow the invoices: mark them as paid
// =====================================================================
const D = await freshPage('D-paid');
await open(D, T, '/');
await moneyReady(D);
const inv3 = byNumber(await invoiceList(T), 'INV-0003');
await D.goto(BASE + `/invoices/${inv3._id}`); await settled(D);
check('(before) the badge shows 1', (await badge(D))?.text === '1');
await clickText(D, 'button', 'Mark as paid');
await hasText(D, 'Marked as paid');
await D.waitForFunction(() => ![...document.querySelectorAll('[data-testid="overdue-badge"]')].some((b) => b.offsetParent !== null), { timeout: 8000 }).catch(() => {});
check('Mark as paid: the badge in the sidebar disappears at once (no reload)', (await badge(D)) === null);
await D.evaluate(() => localStorage.removeItem('timeledger.overdueBannerDismissedOn'));
await clickText(D, 'aside a', 'Dashboard');
await moneyReady(D);
await D.waitForFunction(() => document.querySelector('[data-testid="money-overdue"] p.font-mono')?.innerText.trim() === '$0.00', { timeout: 8000 }).catch(() => {});
const after = await invoiceList(T);
const paidMonth = sum(after.filter((i) => i.status === 'paid' && localDay(i.paidAt).slice(0, 7) === thisMonth), (i) => i.total);
check('Dashboard after paying: no banner, Overdue $0.00 ("Nothing is late"), Paid this month has the new payment', !(await D.$('[data-testid="overdue-banner"]')) && (await card(D, 'money-overdue')).value === '$0.00' && (await card(D, 'money-overdue')).note === 'Nothing is late' && (await card(D, 'money-paid')).value === money(paidMonth) && paidMonth >= inv3.total, JSON.stringify(await card(D, 'money-paid')));
const dl = await legend(D);
check('...and the aging bar only has Acme\'s invoice left (current)', dl.current.amount === money(byNumber(after, 'INV-0002').total) && dl['1-30'].amount === '$0.00' && (await D.$$('[data-part]')).length === 1);
const avgAfter = (await call('GET', '/receivables/summary', T)).body.summary.avgDaysToPay;
check('...the average days to get paid now covers both payments (Globex\'s and the one just made)', avgAfter.count === 2 && avgAfter.days !== null, JSON.stringify(avgAfter));
await shot(D, '15-dashboard-all-paid-desktop');
await D.goto(BASE + '/clients'); await settled(D); await D.waitForSelector('[data-testid="client-row"]');
await clickText(D, 'button', 'Owes me money');
check('Clients: only Acme still owes money', (await D.$$eval('[data-testid="client-row"] a', (as) => as.filter((a) => a.getAttribute('href').startsWith('/clients/')).map((a) => a.innerText.trim()))).join() === 'Acme Corp');
// pay Acme as well: the filter has nobody left
const inv2 = byNumber(after, 'INV-0002');
await call('PATCH', `/invoices/${inv2._id}/status`, T, { status: 'paid' });
await D.goto(BASE + '/clients'); await settled(D); await D.waitForSelector('[data-testid="client-row"]');
await clickText(D, 'button', 'Owes me money');
check('Clients: when everybody has paid, "Owes me money" says so and offers "Show all clients"', (await hasText(D, 'Nobody owes you money')) && (await texts(D, 'main button')).includes('Show all clients'));
await shot(D, '16-clients-nobody-owes-desktop');

// =====================================================================
// 7. Nothing yet, and a browser that won't store anything
// =====================================================================
const fresh = (await call('POST', '/auth/register', null, { name: 'Nia Newcomer', email: `nia.${Date.now()}@example.com`, password: 'Newcomer@123' })).body;
await call('POST', '/clients', fresh.token, { name: 'First Client', email: 'first@client.example' });
const E = await freshPage('E-empty');
await open(E, fresh.token, '/');
await moneyReady(E);
const e1 = await card(E, 'money-outstanding'); const e4 = await card(E, 'money-average');
check('A new user: no banner, no badge, zeros in the cards, "—" for the average', !(await E.$('[data-testid="overdue-banner"]')) && (await badge(E)) === null && e1.value === '$0.00' && e4.value === '—' && e4.note === 'no payments in the last 90 days', JSON.stringify([e1, e4]));
const emptyLeg = await legend(E);
check('...and an aging bar with nothing in it (all four buckets $0.00)', Object.values(emptyLeg).every((b) => b.amount === '$0.00') && (await E.$$('[data-part]')).length === 0 && (await E.$eval('[data-testid="aging-bar"]', (e) => e.getAttribute('aria-label'))) === 'Nothing unpaid');
await shot(E, '17-dashboard-new-user-desktop');
await E.goto(BASE + '/clients'); await settled(E); await E.waitForSelector('[data-testid="client-row"]');
const firstRow = await text(E, '[data-testid="client-row"]');
check('A client that was never invoiced: "No invoices yet", zero figures', firstRow.includes('No invoices yet') && firstRow.includes('Outstanding $0.00'), firstRow);
await E.click('[data-testid="client-row"] a');
await E.waitForSelector('[data-testid="client-metrics"]');
check('Its page: zeros, "No invoices yet", and no "Invoice unbilled time" button (nothing to bill)', (await card(E, 'metric-outstanding')).value === '$0.00' && (await hasText(E, 'No invoices yet')) && !(await texts(E, 'main button')).includes('Invoice unbilled time') && (await texts(E, 'main button')).includes('New invoice'));

// a browser that refuses to store the dismissal: the banner still works
await runSeed();
T = await loginDemo();
const S = await freshPage('S-nostorage', {
  beforeLoad: () => {
    const key = 'timeledger.overdueBannerDismissedOn';
    const getItem = Storage.prototype.getItem;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.getItem = function (k) { if (k === key) throw new Error('storage blocked'); return getItem.call(this, k); };
    Storage.prototype.setItem = function (k, v) { if (k === key) throw new Error('storage blocked'); return setItem.call(this, k, v); };
  },
});
await open(S, T, '/');
await moneyReady(S);
const shown = Boolean(await S.$('[data-testid="overdue-banner"]'));
await S.click('[aria-label="Dismiss until tomorrow"]');
await sleep(300);
check('Storage blocked: the banner still shows, can be dismissed for this visit, and nothing breaks', shown && !(await S.$('[data-testid="overdue-banner"]')) && Boolean(await S.$('[data-testid="money"]')));
await S.reload(); await settled(S); await moneyReady(S);
check('...it simply comes back after a reload (nothing could be remembered)', Boolean(await S.$('[data-testid="overdue-banner"]')));

// =====================================================================
check('isolated: no request went to the dev servers on 5000/5173', blocked.length === 0, blocked.join(' | '));
check('no unexpected console/page errors', consoleErrors.length === 0, consoleErrors.join(' | '));

await browser.close();
console.log(failures === 0 ? '\nALL PHASE 1C BROWSER CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
