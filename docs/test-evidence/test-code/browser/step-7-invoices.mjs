import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.E2E_BASE || 'http://localhost:5273';
const API = process.env.E2E_API || 'http://localhost:5100/api';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SHOTS = new URL('./shots7/', import.meta.url).pathname.replace(/^\//, '');
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const check = (name, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- API helpers ----------
const call = async (method, path, token, body) => {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const stamp = Date.now();
const register = async (name) =>
  (await call('POST', '/auth/register', null, { name, email: `s7-${name.toLowerCase()}-${stamp}@example.com`, password: 'Passw0rd!' })).body;
const ist = (date, time) => `${date}T${time}${time.length === 5 ? ':00' : ''}+05:30`;
const addEntry = async (token, projectId, description, startedAt, endedAt, billable = true) => {
  const res = await call('POST', '/entries', token, { projectId, description, startedAt, endedAt, billable });
  if (res.status !== 201) throw new Error(`seeding failed: ${JSON.stringify(res.body)}`);
  return res.body.entry;
};

// ---------- test data: Priya (India, USD) ----------
const priya = await register('Priya');
const T = priya.token;
const acme = (await call('POST', '/clients', T, { name: 'Acme Corp', email: 'billing@acme.com', company: 'Acme Inc' })).body.client;
const zeta = (await call('POST', '/clients', T, { name: 'Zeta Ltd' })).body.client;
const website = (await call('POST', '/projects', T, { name: 'Website', clientId: acme._id, hourlyRate: 50, color: '#10B981' })).body.project;
const appProject = (await call('POST', '/projects', T, { name: 'App', clientId: acme._id, hourlyRate: 60, color: '#4F46E5' })).body.project;
const brand = (await call('POST', '/projects', T, { name: 'Brand', clientId: zeta._id, hourlyRate: 80, color: '#F59E0B' })).body.project;

// The period 9 - 13 March 2026 for Acme: 4 entries should be billed
//   Website: Mon 2h + Thu 1000 s + Fri 23:00-23:30 (30 min) = 10000 s -> 2.78 h x $50 = $138.89
//   App:     Tue 1.5h                                       =  5400 s -> 1.50 h x $60 = $90.00     total $228.89
await addEntry(T, website._id, 'Homepage', ist('2026-03-09', '09:00'), ist('2026-03-09', '11:00'));
await addEntry(T, appProject._id, 'App review', ist('2026-03-10', '10:00'), ist('2026-03-10', '11:30'));
await addEntry(T, website._id, 'Quick fix', ist('2026-03-12', '14:00'), ist('2026-03-12', '14:16:40'));
await addEntry(T, website._id, 'Late deploy', ist('2026-03-13', '23:00'), ist('2026-03-13', '23:30'));
// ...and these must be left out
await addEntry(T, website._id, 'Not billable', ist('2026-03-11', '09:00'), ist('2026-03-11', '10:00'), false);
await addEntry(T, website._id, 'Sunday night', ist('2026-03-08', '22:00'), ist('2026-03-08', '23:00'));
await addEntry(T, brand._id, 'Other client', ist('2026-03-10', '14:00'), ist('2026-03-10', '15:00'));

// 16 - 20 March: the two-tab race. Three entries: Website 2h + 1h and App 2h = 3.00 h x $50 + 2.00 h x $60 = $270.00
// (the Monday 16th entry is also the one that proves the first invoice, which ends on Friday 13th, left it alone)
const raceEntries = [
  await addEntry(T, website._id, 'Next week', ist('2026-03-16', '09:00'), ist('2026-03-16', '11:00')),
  await addEntry(T, website._id, 'Race 1', ist('2026-03-17', '09:00'), ist('2026-03-17', '10:00')),
  await addEntry(T, appProject._id, 'Race 2', ist('2026-03-18', '10:00'), ist('2026-03-18', '12:00')),
];
// 6 - 10 April: the API race
const apiRaceEntries = [];
for (const [day, hours] of [['2026-04-06', 1], ['2026-04-07', 2], ['2026-04-08', 3]]) {
  apiRaceEntries.push(await addEntry(T, website._id, `Api race ${day}`, ist(day, '09:00'), ist(day, `${String(9 + hours).padStart(2, '0')}:00`)));
}

// ---------- independent helpers ----------
const IST_OFFSET = 5.5 * 3600 * 1000;
const pad = (n) => String(n).padStart(2, '0');
const key = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const istWall = (d = new Date()) => new Date(d.getTime() + IST_OFFSET); // UTC fields = India wall clock
const wall = istWall();
const TODAY = key(wall);
const sinceMonday = (wall.getUTCDay() + 6) % 7;
const LAST_WEEK = {
  from: key(new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() - sinceMonday - 7))),
  to: key(new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() - sinceMonday - 1))),
};
const THIS_MONTH = { from: `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-01`, to: TODAY };
const LAST_MONTH = {
  from: key(new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth() - 1, 1))),
  to: key(new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), 0))),
};
const dmy = (isoOrDate) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(isoOrDate));
const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

// ---------- browser helpers ----------
const browser = await puppeteer.launch({ executablePath: EDGE, headless: true });
const consoleErrors = [];
const blocked = [];

// Safety net: never let a test request reach the developer's own servers (5000 = backend with the real DB, 5173 = dev server)
const guard = async (page, label) => {
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    if (/localhost:(5000|5173)\b/.test(r.url())) { blocked.push(r.url()); r.abort(); } else { r.continue(); }
  });
  page.on('pageerror', (e) => consoleErrors.push(`[${label}] pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/status of (400|401|404|409)/.test(m.text())) consoleErrors.push(`[${label}] ${m.text()}`);
  });
};
const newContext = () => (browser.createBrowserContext ? browser.createBrowserContext() : browser.createIncognitoBrowserContext());
const openDevice = async (label, token, { width = 1280, height = 800, path = '/', mobile = false } = {}) => {
  const context = await newContext();
  const page = await context.newPage();
  await page.setViewport({ width, height, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
  await guard(page, label);
  await page.goto(BASE + '/login');
  await page.evaluate((t) => localStorage.setItem('token', t), token);
  await page.goto(BASE + path);
  await page.waitForFunction(() => !document.querySelector('.animate-spin') && document.querySelector('main'), { timeout: 10000 });
  return page;
};

const hasText = (page, t, timeout = 6000) =>
  page.waitForFunction((s) => document.body.innerText.includes(s), { timeout }, t).then(() => true, () => false);
const gone = (page, t, timeout = 6000) =>
  page.waitForFunction((s) => !document.body.innerText.includes(s), { timeout }, t).then(() => true, () => false);
const waitSel = (page, sel, timeout = 6000) => page.waitForSelector(sel, { timeout }).then(() => true, () => false);
const waitGone = (page, sel, timeout = 6000) => page.waitForSelector(sel, { hidden: true, timeout }).then(() => true, () => false);
const waitUrl = (page, predicateSource, timeout = 8000) =>
  page.waitForFunction(`(${predicateSource})()`, { timeout }).then(() => true, () => false);
const shot = (page, name, options = {}) => page.screenshot({ path: SHOTS + name + '.png', ...options });
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const path = (page) => page.evaluate(() => location.pathname);
const clickButton = async (page, text, within = 'main', exact = true) => {
  const handle = await page.evaluateHandle(
    (t, w, ex) => [...document.querySelectorAll(`${w} button`)].find((b) => (ex ? b.innerText.trim() === t : b.innerText.trim().startsWith(t)) && b.offsetParent !== null),
    text,
    within,
    exact
  );
  const el = handle.asElement();
  if (!el) throw new Error(`No button "${text}" in ${within}`);
  await el.click();
};
const buttonExists = (page, text, within = 'main') =>
  page.evaluate((t, w) => [...document.querySelectorAll(`${w} button`)].some((b) => b.innerText.trim() === t && b.offsetParent !== null), text, within);
const setField = (page, selector, value) =>
  page.$eval(selector, (el, v) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
const colorOf = (page, cls, prop = 'color') =>
  page.evaluate((c, p) => {
    const probe = document.createElement('span');
    probe.className = c;
    document.body.appendChild(probe);
    const color = getComputedStyle(probe)[p];
    probe.remove();
    return color;
  }, cls, prop);

// the invoice modal: wait until the preview has finished
const previewReady = async (page) => {
  await sleep(450); // the preview waits 250 ms after the last change before asking the server
  return page.waitForFunction(() => {
    const p = document.querySelector('[data-testid="invoice-preview"]');
    return p && !p.innerText.includes('Checking unbilled time') && !p.innerText.includes('Choose the dates') && !p.innerText.includes('Pick a client');
  }, { timeout: 8000 });
};
const modalPreview = (page) => page.$eval('[data-testid="invoice-preview"]', (p) => p.innerText.replace(/\s+/g, ' ').trim());
const fillInvoiceModal = async (page, clientId, from, to, notes) => {
  await page.select('#clientId', clientId);
  await setField(page, '#from', from);
  await setField(page, '#to', to);
  if (notes) await setField(page, '#notes', notes);
  await previewReady(page);
};
const listRows = (page) => page.$$eval('main ul > li a[href^="/invoices/"]', (as) => as.map((a) => a.innerText.replace(/\s+/g, ' ').trim()));

// =====================================================================
// 1. Empty state, the modal, quick picks
// =====================================================================
const A = await openDevice('A-priya', T, { path: '/' });
await A.click('aside a[href="/invoices"]');
await A.waitForFunction(() => location.pathname === '/invoices');
check('Invoices: header "Invoices" with a "New invoice" button', (await A.$eval('main h1', (h) => h.innerText)) === 'Invoices' && (await buttonExists(A, 'New invoice')));
check('empty state "Create your first invoice" with a button', (await hasText(A, 'Create your first invoice')) && (await buttonExists(A, 'New invoice')));
const cards0 = await A.$$eval('[data-testid="summary"] > div', (c) => c.map((x) => x.innerText.replace(/\s+/g, ' ').trim().toLowerCase()));
check('summary cards start at Outstanding $0.00, Paid $0.00, Invoices 0', cards0[0].includes('outstanding') && cards0[0].includes('$0.00') && cards0[1].includes('$0.00') && cards0[2].includes('0'), cards0.join(' | '));
check('the status filter is hidden while there are no invoices', !(await A.$('[aria-label="Filter by status"]')));
await shot(A, '01-invoices-empty-desktop');

await clickButton(A, 'New invoice');
check('"New invoice" opens the modal with a client select, quick picks, dates and notes', (await waitSel(A, '[role=dialog] #clientId')) && (await A.$$eval('[role=dialog] [aria-label="Quick date ranges"] button', (b) => b.map((x) => x.innerText.trim()))).join() === 'Last week,This month,Last month,Custom');
const defaults = await A.evaluate(() => ({ from: document.querySelector('#from').value, to: document.querySelector('#to').value, pressed: [...document.querySelectorAll('[aria-label="Quick date ranges"] button')].find((b) => b.getAttribute('aria-pressed') === 'true')?.innerText.trim() }));
check('it starts on "This month" (the 1st up to today)', defaults.pressed === 'This month' && defaults.from === THIS_MONTH.from && defaults.to === THIS_MONTH.to, JSON.stringify(defaults));
check('"Create invoice" is disabled until there is something to bill', await A.$eval('[role=dialog] button[type=submit]', (b) => b.disabled));
check('...and the preview asks for a client first', (await modalPreview(A)).includes('Pick a client'));

for (const [label, expected] of [['Last week', LAST_WEEK], ['Last month', LAST_MONTH], ['This month', THIS_MONTH]]) {
  await clickButton(A, label, '[role=dialog]');
  const got = await A.evaluate(() => ({ from: document.querySelector('#from').value, to: document.querySelector('#to').value }));
  check(`quick pick "${label}" fills ${expected.from} to ${expected.to}`, got.from === expected.from && got.to === expected.to, JSON.stringify(got));
}
await setField(A, '#from', '2026-03-01');
check('typing a date switches the quick pick to "Custom"', (await A.evaluate(() => [...document.querySelectorAll('[aria-label="Quick date ranges"] button')].find((b) => b.getAttribute('aria-pressed') === 'true')?.innerText.trim())) === 'Custom');
const maxTo = await A.$eval('#to', (i) => i.max);
check('the end date cannot be picked after today', maxTo === TODAY, maxTo);

// =====================================================================
// 2. Preview, then create INV-0001
// =====================================================================
await A.select('#clientId', zeta._id);
await setField(A, '#from', '2026-03-09');
await setField(A, '#to', '2026-03-13');
await previewReady(A);
const zetaPreview = await modalPreview(A);
check('a client with its own unbilled time previews only that (Brand 1.00 h x $80.00 = $80.00)', zetaPreview.includes('Brand') && zetaPreview.includes('1.00 h × $80.00') && zetaPreview.includes('1 entry'), zetaPreview);
await A.select('#clientId', acme._id);
await previewReady(A);
const preview = await modalPreview(A);
check('Acme preview: line items with hours, rate and amount, entry count and total', preview.includes('App') && preview.includes('1.50 h × $60.00') && preview.includes('$90.00') && preview.includes('Website') && preview.includes('2.78 h × $50.00') && preview.includes('$138.89') && preview.includes('4 entries') && preview.includes('9 – 13 Mar 2026'), preview);
check('...with the total $228.89 (non-billable, other client, outside the period and the 23:30 edge handled)', (await A.$eval('[data-testid="preview-total"]', (e) => e.innerText)) === '$228.89');
check('...and "Create invoice" is enabled', !(await A.$eval('[role=dialog] button[type=submit]', (b) => b.disabled)));
await setField(A, '#notes', 'Payment within 14 days.\nThank you!');
await shot(A, '02-new-invoice-modal-desktop');

await A.click('[role=dialog] button[type=submit]');
check('creating shows the toast "Invoice INV-0001 created"', await hasText(A, 'Invoice INV-0001 created'));
check('...and opens the invoice page', await waitUrl(A, "() => /^\\/invoices\\/[0-9a-f]{24}$/.test(location.pathname)"));
const invoiceId1 = (await path(A)).split('/').pop();
await waitSel(A, '[data-testid="invoice-number"]');

// =====================================================================
// 3. The invoice page
// =====================================================================
const page1 = await A.evaluate(() => {
  const text = (sel) => document.querySelector(sel)?.innerText.replace(/\s+/g, ' ').trim();
  const paper = document.querySelector('article.invoice-paper');
  return {
    number: text('[data-testid="invoice-number"]'),
    status: text('[data-testid="invoice-status"]'),
    paper: paper.innerText.replace(/\s+/g, ' ').trim(),
    rows: [...document.querySelectorAll('[data-testid="line-items-table"] tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.innerText.trim())),
    heads: [...document.querySelectorAll('[data-testid="line-items-table"] thead th')].map((th) => th.innerText.trim().toLowerCase()),
    total: text('[data-testid="invoice-total"]'),
    actions: [...document.querySelectorAll('[data-testid="invoice-actions"] button')].map((b) => b.innerText.trim()),
    hasLogo: paper.innerText.includes('TimeLedger') && paper.innerText.includes('INVOICE'),
    paperBg: getComputedStyle(paper).backgroundColor,
  };
});
check('invoice page: logo, "INVOICE", number INV-0001 and a Draft badge', page1.hasLogo && page1.number === 'INV-0001' && page1.status === 'Draft', `${page1.number} ${page1.status}`);
// innerText applies CSS text-transform (the small labels are uppercase), so compare in lower case
const paperLc = page1.paper.toLowerCase();
const inPaper = (s) => paperLc.includes(s.toLowerCase());
check('From (the user) and Bill to (name, company, email)', inPaper('From') && inPaper('Priya') && inPaper(`s7-priya-${stamp}@example.com`) && inPaper('Bill to') && inPaper('Acme Corp') && inPaper('Acme Inc') && inPaper('billing@acme.com'));
check('issue date is today and the due date is 14 days later (India time)', inPaper(`Issue date ${dmy(Date.now())}`) && inPaper(`Due date ${dmy(Date.now() + 14 * 86400000)}`), page1.paper.slice(0, 300));
check('period "9 – 13 Mar 2026"', inPaper('Period 9 – 13 Mar 2026'));
check('line items table: Project, Hours, Rate, Amount', JSON.stringify(page1.heads) === JSON.stringify(['project', 'hours', 'rate', 'amount']), page1.heads.join(' | '));
check('...App 1.50 / $60.00 / $90.00 and Website 2.78 / $50.00 / $138.89', JSON.stringify(page1.rows) === JSON.stringify([['App', '1.50', '$60.00', '$90.00'], ['Website', '2.78', '$50.00', '$138.89']].map((r) => r)) || (page1.rows.length === 2 && page1.rows[0].join('|') === 'App|1.50|$60.00|$90.00' && page1.rows[1].join('|') === 'Website|2.78|$50.00|$138.89'), JSON.stringify(page1.rows));
check('subtotal and total $228.89', page1.total === '$228.89' && inPaper('Subtotal $228.89'));
check('notes are at the bottom', inPaper('Notes') && inPaper('Payment within 14 days.') && inPaper('Thank you!'));
check('actions: Back, Print / Save as PDF, Mark as sent, Mark as paid, Delete (a draft)', JSON.stringify(page1.actions) === JSON.stringify(['Back', 'Print / Save as PDF', 'Mark as sent', 'Mark as paid', 'Delete']), page1.actions.join(' | '));
check('the paper is a white card', page1.paperBg === (await colorOf(A, 'bg-white', 'backgroundColor')));
const slate700 = await colorOf(A, 'text-slate-700');
const draftBadgeColor = await A.$eval('[data-testid="invoice-status"] span', (s) => getComputedStyle(s).color);
check('Draft badge is slate', draftBadgeColor === slate700, draftBadgeColor);

const details = await A.evaluate(() => {
  const d = document.querySelector('[data-testid="entries-included"]');
  return { open: d.open, summary: d.querySelector('summary').innerText.trim() };
});
check('"Time entries included (4)" is collapsed at first', !details.open && details.summary === 'Time entries included (4)', JSON.stringify(details));
await A.click('[data-testid="entries-included"] summary');
const included = await A.$$eval('[data-testid="entries-included"] li', (lis) => lis.map((li) => li.innerText.replace(/\s+/g, ' ').trim()));
check('...opening it lists the 4 entries in time order (date, project, description, duration), including the 23:30 one on 13 March',
  included.length === 4 && included[0].includes('9 Mar 2026') && included[0].includes('Homepage') && included[0].includes('2h') && included[1].includes('App review') && included[2].includes('Quick fix') && included[2].includes('16m') && included[3].includes('13 Mar 2026') && included[3].includes('Late deploy') && included[3].includes('30m'), included.join(' | '));
await gone(A, 'Invoice INV-0001 created'); // let the toast leave so it doesn't cover the logo in the picture
await A.setViewport({ width: 1280, height: 1180 }); // tall enough for the whole page, so the fixed sidebar looks right
await shot(A, '03-invoice-detail-desktop');
await A.setViewport({ width: 1280, height: 800 });

// the sidebar item stays highlighted on an invoice page
check('the "Invoices" sidebar item stays highlighted on the invoice page', await A.$eval('aside a[href="/invoices"]', (a) => a.className.includes('bg-indigo-800')));

// =====================================================================
// 4. The same entries can't be billed again; billed badges link to the invoice
// =====================================================================
await A.goto(BASE + '/invoices');
await A.waitForSelector('[data-testid="summary"]');
await clickButton(A, 'New invoice');
await waitSel(A, '[role=dialog] #clientId');
await fillInvoiceModal(A, acme._id, '2026-03-09', '2026-03-13');
const again = await modalPreview(A);
check('billing the same period again: the preview says there is nothing to bill', again.includes('No unbilled billable time for this client in this period'), again);
check('...and "Create invoice" stays disabled', await A.$eval('[role=dialog] button[type=submit]', (b) => b.disabled));
check('API: creating it again is refused with the same 400', await (async () => { const r = await call('POST', '/invoices', T, { clientId: acme._id, from: '2026-03-09', to: '2026-03-13' }); return r.status === 400 && r.body.message === 'No unbilled billable time for this client in this period'; })());
await A.keyboard.press('Escape');

await A.goto(BASE + '/time-entries?from=2026-03-09&to=2026-03-13');
await A.waitForSelector('main li');
const billed = await A.$$eval('main li', (lis) => lis.filter((li) => li.querySelector('a[href^="/invoices/"]')).map((li) => li.innerText.replace(/\s+/g, ' ').trim()));
check('Time entries: the 4 invoiced entries show a "Billed" badge', billed.length === 4 && billed.every((r) => r.includes('Billed')), String(billed.length));
const unbilledStill = await A.$$eval('main li', (lis) => lis.filter((li) => !li.querySelector('a[href^="/invoices/"]')).map((li) => li.innerText.replace(/\s+/g, ' ').trim()));
check('...and the others are still billable / non-billable', unbilledStill.some((r) => r.includes('Not billable') && r.includes('Non-billable')) && unbilledStill.some((r) => r.includes('Other client') && r.includes('Billable')), unbilledStill.join(' | '));
const badgeHref = await A.$eval('main li a[href^="/invoices/"]', (a) => a.getAttribute('href'));
check('the Billed badge links to its invoice', badgeHref === `/invoices/${invoiceId1}`, badgeHref);
await shot(A, '12-time-entries-billed-badges-desktop');
await A.click('main li a[href^="/invoices/"]');
check('...and clicking it opens that invoice', await waitUrl(A, `() => location.pathname === '/invoices/${invoiceId1}'`));

// =====================================================================
// 5. The key rule in the browser: two tabs bill the same time at the same moment
// =====================================================================
const P1 = await openDevice('tab-1', T, { path: '/invoices' });
const P2 = await openDevice('tab-2', T, { path: '/invoices' });
for (const tab of [P1, P2]) {
  await clickButton(tab, 'New invoice');
  await waitSel(tab, '[role=dialog] #clientId');
  await fillInvoiceModal(tab, acme._id, '2026-03-16', '2026-03-20');
}
const [prev1, prev2] = [await modalPreview(P1), await modalPreview(P2)];
check('both tabs see the same preview ($270.00, 3 entries)', prev1.includes('$270.00') && prev2.includes('$270.00') && prev1.includes('3 entries') && prev1 === prev2, `${prev1} || ${prev2}`);

await Promise.all([P1.click('[role=dialog] button[type=submit]'), P2.click('[role=dialog] button[type=submit]')]);
await sleep(2500);
const urls = [await path(P1), await path(P2)];
const winners = urls.filter((u) => /^\/invoices\/[0-9a-f]{24}$/.test(u));
const losers = [P1, P2].filter((_, i) => !/^\/invoices\/[0-9a-f]{24}$/.test(urls[i]));
check('exactly ONE of the two tabs got an invoice', winners.length === 1 && losers.length === 1, urls.join(' / '));
if (losers.length === 1) {
  check('the other tab is told there is nothing left to bill, and stays on the form', (await hasText(losers[0], 'No unbilled billable time for this client in this period')) && (await waitSel(losers[0], '[role=dialog]')));
  check('...with "Create invoice" disabled again', await losers[0].$eval('[role=dialog] button[type=submit]', (b) => b.disabled));
  await shot(losers[0], '04-second-tab-nothing-to-bill-desktop');
}
const afterRace = (await call('GET', '/invoices', T)).body.invoices;
const raceWinner = afterRace.find((i) => i.periodStart === '2026-03-16');
const raceEntryRows = (await call('GET', '/entries?status=billed&from=2026-03-16T00:00:00Z&to=2026-03-21T00:00:00Z', T)).body.entries;
check('server: only one invoice exists for that period (INV-0002), not two', afterRace.filter((i) => i.periodStart === '2026-03-16').length === 1 && raceWinner?.number === 'INV-0002', afterRace.map((i) => i.number).join(','));
check('server: all 3 entries are on that one invoice', raceEntryRows.length === 3 && raceEntryRows.every((e) => e.invoiceId === raceWinner._id) && raceEntries.every((e) => raceEntryRows.some((r) => r._id === e._id)));
await P1.browserContext().close();
await P2.browserContext().close();

// the same race through the API (6 requests at once)
const apiRace = await Promise.all(Array.from({ length: 6 }, () => call('POST', '/invoices', T, { clientId: acme._id, from: '2026-04-06', to: '2026-04-10' })));
const apiStatuses = apiRace.map((r) => r.status).sort().join(',');
check('API: 6 simultaneous requests for the same period give one 201 and five 400', apiStatuses === '201,400,400,400,400,400', apiStatuses);
const apiWinner = apiRace.find((r) => r.status === 201).body.invoice;
const apiEntries = (await call('GET', '/entries?status=billed&from=2026-04-06T00:00:00Z&to=2026-04-11T00:00:00Z', T)).body.entries;
check('API: all 3 entries are on that single invoice and it lists exactly those ids', apiEntries.length === 3 && apiEntries.every((e) => e.invoiceId === apiWinner._id) && apiWinner.entryIds.length === 3 && apiEntries.every((e) => apiWinner.entryIds.includes(e._id)));
check('API: the invoice numbers are INV-0001, INV-0002, INV-0003 with no gaps or repeats', (await call('GET', '/invoices', T)).body.invoices.map((i) => i.number).sort().join(',') === 'INV-0001,INV-0002,INV-0003');

// =====================================================================
// 6. Status: draft -> sent -> paid
// =====================================================================
await A.goto(BASE + `/invoices/${invoiceId1}`);
await waitSel(A, '[data-testid="invoice-number"]');
await clickButton(A, 'Mark as sent', '[data-testid="invoice-actions"]');
check('Mark as sent: toast, "Sent" badge, and the Mark as sent / Delete buttons go away', (await hasText(A, 'Marked as sent')) && (await A.$eval('[data-testid="invoice-status"]', (e) => e.innerText.trim())) === 'Sent' && !(await buttonExists(A, 'Mark as sent', '[data-testid="invoice-actions"]')) && !(await buttonExists(A, 'Delete', '[data-testid="invoice-actions"]')));
const amber700 = await colorOf(A, 'text-amber-700');
check('the Sent badge is amber and the page shows the sent date', (await A.$eval('[data-testid="invoice-status"] span', (s) => getComputedStyle(s).color)) === amber700 && (await A.$eval('article.invoice-paper', (a) => /(^|\s)sent\s+\d{1,2} \w{3} \d{4}/i.test(a.innerText.replace(/\s+/g, ' ')))));
check('the line items are still there after the status change', (await A.$$eval('[data-testid="line-items-table"] tbody tr', (r) => r.length)) === 2 && (await A.$eval('[data-testid="invoice-total"]', (e) => e.innerText)) === '$228.89');
await clickButton(A, 'Mark as paid', '[data-testid="invoice-actions"]');
check('Mark as paid: toast, "Paid" badge in emerald, no more status buttons', (await hasText(A, 'Marked as paid')) && (await A.$eval('[data-testid="invoice-status"]', (e) => e.innerText.trim())) === 'Paid' && !(await buttonExists(A, 'Mark as paid', '[data-testid="invoice-actions"]')));
check('...emerald colour and a paid date', (await A.$eval('[data-testid="invoice-status"] span', (s) => getComputedStyle(s).color)) === (await colorOf(A, 'text-emerald-700')) && (await A.$eval('article.invoice-paper', (a) => /(^|\s)paid\s+\d{1,2} \w{3} \d{4}/i.test(a.innerText.replace(/\s+/g, ' ')))));
check('API: a paid invoice cannot go back (409 "Can\'t change status from paid to sent") or be deleted (409)', await (async () => {
  const back = await call('PATCH', `/invoices/${invoiceId1}/status`, T, { status: 'sent' });
  const del = await call('DELETE', `/invoices/${invoiceId1}`, T);
  return back.status === 409 && back.body.message === "Can't change status from paid to sent" && del.status === 409 && del.body.message === 'Only draft invoices can be deleted';
})());

// =====================================================================
// 7. The invoice never changes when rates or names change later
// =====================================================================
await call('PATCH', `/projects/${website._id}`, T, { hourlyRate: 99, name: 'Website v2' });
await call('PATCH', `/clients/${acme._id}`, T, { name: 'Acme Renamed', email: 'new@acme.com' });
await A.reload();
await waitSel(A, '[data-testid="invoice-number"]');
const snap = await A.evaluate(() => ({
  rows: [...document.querySelectorAll('[data-testid="line-items-table"] tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.innerText.trim()).join('|')),
  paper: document.querySelector('article.invoice-paper').innerText.replace(/\s+/g, ' '),
  total: document.querySelector('[data-testid="invoice-total"]').innerText,
}));
check('after the project rate (50 -> 99) and the client name/email changed, the old invoice is exactly the same',
  snap.rows.join(' ; ') === 'App|1.50|$60.00|$90.00 ; Website|2.78|$50.00|$138.89' && snap.total === '$228.89' && snap.paper.includes('Acme Corp') && !snap.paper.includes('Acme Renamed') && snap.paper.includes('billing@acme.com') && !snap.paper.includes('new@acme.com'), snap.rows.join(' ; '));

// =====================================================================
// 8. List: badges, summary, filters
// =====================================================================
await A.goto(BASE + '/invoices');
await A.waitForSelector('main ul > li a[href^="/invoices/"]');
const rows = await listRows(A);
check('list: 3 invoices, newest first, each with number, client, period, issued date, total and status', rows.length === 3 && rows[0].startsWith('INV-0003') && rows[2].startsWith('INV-0001') && rows[2].includes('Acme Corp') && rows[2].includes('9 – 13 Mar 2026') && rows[2].includes(`issued ${dmy(Date.now())}`) && rows[2].includes('$228.89') && rows[2].includes('Paid'), rows.join(' || '));
const tones = await A.evaluate(() => {
  const color = (li, label) => { const b = [...li.querySelectorAll('span')].find((s) => s.innerText.trim() === label); return b && getComputedStyle(b).color; };
  const lis = [...document.querySelectorAll('main ul > li')];
  return { paid: color(lis.find((l) => l.innerText.includes('INV-0001')), 'Paid'), draft: color(lis.find((l) => l.innerText.includes('INV-0003')), 'Draft'), mono: getComputedStyle(lis[0].querySelector('.font-mono')).fontFamily };
});
check('badge colours: Paid emerald, Draft slate; amounts in JetBrains Mono', tones.paid === (await colorOf(A, 'text-emerald-700')) && tones.draft === (await colorOf(A, 'text-slate-700')) && tones.mono.includes('JetBrains'), JSON.stringify(tones));

// INV-0001 paid ($228.89), INV-0002 draft ($270.00), INV-0003 draft (6 h x $50 = $300.00)
const cards = await A.$$eval('[data-testid="summary"] > div', (c) => c.map((x) => x.innerText.replace(/\s+/g, ' ').trim().toLowerCase()));
check('summary: Outstanding $570.00 (the two drafts), Paid $228.89, Invoices 3', cards[0].includes('$570.00') && cards[1].includes('$228.89') && cards[2].endsWith('3'), cards.join(' | '));
const filterButtons = await A.$$eval('[aria-label="Filter by status"] button', (b) => b.map((x) => x.innerText.trim()));
check('status filter: All, Draft, Sent, Paid', filterButtons.join() === 'All,Draft,Sent,Paid');
await clickButton(A, 'Draft');
check('filter "Draft" shows the 2 drafts, but the cards still cover everything', (await listRows(A)).length === 2 && (await A.$$eval('[data-testid="summary"] > div', (c) => c[0].innerText.includes('$570.00'))));
await clickButton(A, 'Paid');
check('filter "Paid" shows INV-0001 only', (await listRows(A)).length === 1 && (await listRows(A))[0].startsWith('INV-0001'));
await clickButton(A, 'Sent');
check('filter "Sent" with none shows an empty state', await hasText(A, 'No sent invoices'));
await clickButton(A, 'All');
await shot(A, '05-invoices-list-desktop');

// =====================================================================
// 9. Deleting a draft frees its entries
// =====================================================================
await A.click(`main ul > li a[href="/invoices/${raceWinner._id}"]`);
await waitSel(A, '[data-testid="invoice-number"]');
await clickButton(A, 'Delete', '[data-testid="invoice-actions"]');
const confirmText = await A.$eval('[role=dialog]', (d) => d.innerText.replace(/\s+/g, ' '));
check('Delete asks for confirmation and explains the entries become unbilled', confirmText.includes('Delete invoice?') && confirmText.includes('INV-0002') && confirmText.includes('3 time entries become unbilled'), confirmText);
await shot(A, '06-delete-invoice-confirm-desktop');
await clickButton(A, 'Cancel', '[role=dialog]');
check('Cancel keeps it', (await waitGone(A, '[role=dialog]')) && (await call('GET', `/invoices/${raceWinner._id}`, T)).status === 200);
await clickButton(A, 'Delete', '[data-testid="invoice-actions"]');
await clickButton(A, 'Delete', '[role=dialog]');
check('confirming deletes it: toast, back to the list', (await hasText(A, 'Invoice INV-0002 deleted')) && (await waitUrl(A, "() => location.pathname === '/invoices'")));
const freed = (await call('GET', '/entries?status=unbilled&from=2026-03-16T00:00:00Z&to=2026-03-21T00:00:00Z', T)).body.entries;
check('server: its 3 entries are unbilled again (and can be edited again)', freed.length === 3 && freed.every((e) => e.invoiceId === null) && (await call('PATCH', `/entries/${freed[0]._id}`, T, { description: 'edited again' })).status === 200);

await clickButton(A, 'New invoice');
await waitSel(A, '[role=dialog] #clientId');
await fillInvoiceModal(A, acme._id, '2026-03-16', '2026-03-20');
check('the freed entries show up in a new preview again', (await modalPreview(A)).includes('3 entries'));
await A.click('[role=dialog] button[type=submit]');
check('a new invoice for them gets INV-0004: the number of the deleted one is not reused', await hasText(A, 'Invoice INV-0004 created'));

// =====================================================================
// 10. Printing / saving as PDF
// =====================================================================
await A.goto(BASE + `/invoices/${invoiceId1}`);
await waitSel(A, '[data-testid="invoice-number"]');
await A.setViewport({ width: 794, height: 1123 }); // an A4 page at 96 dpi
await A.emulateMediaType('print');
await sleep(300);
const printed = await A.evaluate(() => {
  const display = (sel) => { const e = document.querySelector(sel); return e ? getComputedStyle(e).display : 'missing'; };
  const paper = document.querySelector('article.invoice-paper');
  const box = paper.getBoundingClientRect();
  return {
    aside: display('aside'), header: display('header'), bottomNav: display('nav.fixed'), actions: display('[data-testid="invoice-actions"]'), entries: display('[data-testid="entries-included"]'),
    bodyBg: getComputedStyle(document.body).backgroundColor,
    paperVisible: box.width > 0 && box.height > 0,
    paperLeft: Math.round(box.left), paperRight: Math.round(box.right), viewport: window.innerWidth,
    scrollOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    paperBorder: getComputedStyle(paper).borderTopWidth, paperShadow: getComputedStyle(paper).boxShadow,
    mainPadding: getComputedStyle(document.querySelector('main')).paddingLeft,
    tableShown: display('[data-testid="line-items-table"]'), stackedShown: display('[data-testid="line-items-stacked"]'),
  };
});
check('print: the sidebar, top bar, bottom bar, action buttons and the entry list are hidden', printed.aside === 'none' && printed.header === 'none' && printed.bottomNav === 'none' && printed.actions === 'none' && printed.entries === 'none', JSON.stringify([printed.aside, printed.header, printed.bottomNav, printed.actions, printed.entries]));
// Tailwind's shadow-none computes to a list of fully transparent, zero-size shadows, which draws nothing
const noShadow = printed.paperShadow === 'none' || /^(rgba\(0, 0, 0, 0\) 0px 0px 0px 0px(, )?)+$/.test(printed.paperShadow);
check('print: white background, no leftover sidebar space, no border or shadow', printed.bodyBg === 'rgb(255, 255, 255)' && printed.mainPadding === '0px' && printed.paperBorder === '0px' && noShadow, JSON.stringify([printed.bodyBg, printed.mainPadding, printed.paperBorder, printed.paperShadow]));
check('print: the invoice fills the page width and nothing is cut off at the sides', printed.paperVisible && printed.paperLeft >= 0 && printed.paperRight <= printed.viewport && printed.scrollOverflow <= 0, JSON.stringify([printed.paperLeft, printed.paperRight, printed.viewport, printed.scrollOverflow]));
check('print: the line items show as a table (not the stacked phone layout)', printed.tableShown !== 'none' && printed.stackedShown === 'none');
await shot(A, '07-invoice-print-preview');
// page.pdf() gives a Uint8Array. Chromium writes a plain PDF 1.4 file, so the page tree can be read as text.
const pdfInfo = (bytes) => {
  const text = Buffer.from(bytes).toString('latin1');
  const pages = Number(text.match(/\/Type\s*\/Pages\s*\/Count\s+(\d+)/)?.[1] ?? 0);
  const box = text.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
  return { pages, width: Number(box?.[1] ?? 0), height: Number(box?.[2] ?? 0), isPdf: text.startsWith('%PDF-'), bytes: bytes.length };
};
const pdf = await A.pdf({ preferCSSPageSize: true, printBackground: true });
writeFileSync(SHOTS + 'invoice-INV-0001.pdf', pdf);
const info = pdfInfo(pdf);
check('print: a real PDF was produced (A4 size 595 x 842 pt, one page for this invoice)', info.isPdf && info.bytes > 5000 && Math.abs(info.width - 595) < 1 && Math.abs(info.height - 842) < 1 && info.pages === 1, JSON.stringify(info));
await A.emulateMediaType('screen');
await A.setViewport({ width: 1280, height: 800 });

// a long invoice (many projects) runs over several pages instead of being cut off
const big = await register('Big');
const bigClient = (await call('POST', '/clients', big.token, { name: 'Giant Co' })).body.client;
for (let i = 1; i <= 36; i++) {
  const project = (await call('POST', '/projects', big.token, { name: `Project ${String(i).padStart(2, '0')}`, clientId: bigClient._id, hourlyRate: 40 + i })).body.project;
  await addEntry(big.token, project._id, `Work ${i}`, ist('2026-03-10', '09:00'), ist('2026-03-10', '10:30'));
}
const bigInvoice = (await call('POST', '/invoices', big.token, { clientId: bigClient._id, from: '2026-03-10', to: '2026-03-10' })).body.invoice;
const B = await openDevice('B-big', big.token, { width: 794, height: 1123, path: `/invoices/${bigInvoice._id}` });
await waitSel(B, '[data-testid="invoice-number"]');
await B.emulateMediaType('print');
await sleep(300);
const bigPdfBytes = await B.pdf({ preferCSSPageSize: true, printBackground: true });
writeFileSync(SHOTS + 'invoice-long-36-projects.pdf', bigPdfBytes);
const bigPages = pdfInfo(bigPdfBytes).pages;
const bigBox = await B.evaluate(() => { const r = document.querySelector('article.invoice-paper').getBoundingClientRect(); return { right: r.right, height: r.height, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, rows: document.querySelectorAll('[data-testid="line-items-table"] tbody tr').length }; });
check('print: an invoice with 36 projects runs over several pages (nothing cut off) and still fits the width', bigPages >= 2 && bigBox.rows === 36 && bigBox.right <= 794 && bigBox.overflow <= 0, `${bigPages} pages, ${bigBox.rows} lines`);
await B.browserContext().close();

// =====================================================================
// 11. Other users, and an unknown invoice
// =====================================================================
const bob = await register('Bob');
const C = await openDevice('C-bob', bob.token, { path: `/invoices/${invoiceId1}` });
check("another user opening my invoice sees \"Invoice not found\" (and none of my data)", (await hasText(C, 'Invoice not found')) && !(await C.evaluate(() => document.body.innerText.includes('Acme') || document.body.innerText.includes('228.89'))));
await C.goto(BASE + '/invoices');
await C.waitForSelector('[data-testid="summary"]');
check("...and their own list is empty", await hasText(C, 'Create your first invoice'));
await C.goto(BASE + '/invoices/not-a-real-id');
check('a malformed invoice id also shows "Invoice not found"', await hasText(C, 'Invoice not found'));
await C.browserContext().close();

// =====================================================================
// 12. Phone (375px)
// =====================================================================
const M = await openDevice('M-phone', T, { width: 375, height: 667, mobile: true, path: '/invoices' });
await M.waitForSelector('main ul > li a[href^="/invoices/"]');
check('phone: the invoice list has no horizontal scroll', (await overflow(M)) <= 0, `overflow=${await overflow(M)}`);
const rowFits = await M.evaluate(() => [...document.querySelectorAll('main ul > li')].every((li) => li.getBoundingClientRect().right <= window.innerWidth + 0.5));
check('phone: every invoice row fits and shows its total and status', rowFits && (await M.$$eval('main ul > li', (lis) => lis.every((li) => /\$\d/.test(li.innerText) && /(Draft|Sent|Paid)/.test(li.innerText)))));
await shot(M, '08-invoices-list-mobile');
await clickButton(M, 'New invoice');
await waitSel(M, '[role=dialog] #clientId');
await fillInvoiceModal(M, zeta._id, '2026-03-09', '2026-03-13');
const mBox = await M.$eval('[role=dialog]', (d) => { const r = d.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
check('phone: the new-invoice modal fits the screen without sideways scroll', mBox.left >= 0 && mBox.right <= 375 && mBox.top >= 0 && mBox.bottom <= 667 && (await overflow(M)) <= 0, JSON.stringify(mBox));
await shot(M, '09-new-invoice-modal-mobile');
await M.keyboard.press('Escape');

await M.goto(BASE + `/invoices/${invoiceId1}`);
await waitSel(M, '[data-testid="invoice-number"]');
const mInvoice = await M.evaluate(() => ({
  table: getComputedStyle(document.querySelector('[data-testid="line-items-table"]')).display,
  stacked: getComputedStyle(document.querySelector('[data-testid="line-items-stacked"]')).display,
  stackedText: document.querySelector('[data-testid="line-items-stacked"]').innerText.replace(/\s+/g, ' ').trim(),
  paperRight: document.querySelector('article.invoice-paper').getBoundingClientRect().right,
  actionsRight: Math.max(...[...document.querySelectorAll('[data-testid="invoice-actions"] button')].map((b) => b.getBoundingClientRect().right)),
}));
check('phone: the line items become stacked rows (project, amount, hours × rate)', mInvoice.table === 'none' && mInvoice.stacked !== 'none' && mInvoice.stackedText.includes('Website') && mInvoice.stackedText.includes('$138.89') && mInvoice.stackedText.includes('2.78 h × $50.00'), mInvoice.stackedText);
check('phone: the invoice page has no horizontal scroll and the buttons fit', (await overflow(M)) <= 0 && mInvoice.paperRight <= 375 && mInvoice.actionsRight <= 375, `overflow=${await overflow(M)} paper=${mInvoice.paperRight} actions=${mInvoice.actionsRight}`);
await shot(M, '10-invoice-detail-mobile-top');
await M.setViewport({ width: 375, height: 1260, isMobile: true, hasTouch: true }); // the whole invoice in one screen, bottom bar at the bottom
await sleep(200);
await shot(M, '11-invoice-detail-mobile-full');
await M.browserContext().close();

// =====================================================================
check('isolated: no request went to the dev servers on 5000/5173', blocked.length === 0, blocked.join(' | '));
check('no unexpected console/page errors', consoleErrors.length === 0, consoleErrors.join(' | '));

await browser.close();
console.log(failures === 0 ? '\nALL STEP 7 BROWSER CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
