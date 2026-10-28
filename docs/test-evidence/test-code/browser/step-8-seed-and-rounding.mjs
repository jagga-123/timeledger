import puppeteer from 'puppeteer-core';
import { mkdirSync, readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const BASE = process.env.E2E_BASE || 'http://localhost:5273';
const API = process.env.E2E_API || 'http://localhost:5100/api';
const BACKEND = 'C:/Users/sande/OneDrive/Desktop/timeledger/backend';
const URI_FILE = process.env.E2E_MONGO_URI_FILE; // written by the isolated backend: the throwaway database's address
if (!URI_FILE) throw new Error('E2E_MONGO_URI_FILE is required (the isolated backend writes the database address there)');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SHOTS = new URL('./shots8/', import.meta.url).pathname.replace(/^\//, '');
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

// `npm run seed` itself (node src/seed.js), pointed at the throwaway database instead of the one in backend/.env
const runSeed = async (extraEnv = {}) => {
  try {
    const { stdout } = await run('node', ['src/seed.js'], {
      cwd: BACKEND,
      env: { ...process.env, MONGODB_URI: readFileSync(URI_FILE, 'utf8').trim(), ...extraEnv },
      timeout: 120000,
    });
    return { code: 0, out: stdout };
  } catch (e) {
    return { code: e.code ?? 1, out: (e.stdout ?? '') + (e.stderr ?? '') };
  }
};

// ---------- independent oracle (written without looking at the app's code) ----------
const IST = 5.5 * 3600 * 1000;
const pad = (n) => String(n).padStart(2, '0');
const key = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const dayKeyIST = (iso) => key(new Date(new Date(iso).getTime() + IST));
const wall = new Date(Date.now() + IST); // UTC fields = India wall clock
const TODAY = key(wall);
const sinceMonday = (wall.getUTCDay() + 6) % 7;
const mondayKey = (weeksAgo) => key(new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() - sinceMonday - 7 * weeksAgo)));
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
const fmtDur = (total) => {
  const s = Math.floor(total);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : m > 0 ? `${m}m` : `${s}s`;
};
const billedSeconds = (seconds, rounding) => (rounding ? Math.ceil(seconds / (rounding * 60)) * rounding * 60 : seconds);

// What an invoice for this client and period would hold, worked out from the raw entries and the project rates
const expectedInvoice = (entries, rates, clientId, from, to, rounding) => {
  const picked = entries.filter((e) => e.billable && !e.invoiceId && e.clientId === clientId && dayKeyIST(e.startedAt) >= from && dayKeyIST(e.startedAt) <= to);
  const byProject = new Map();
  for (const e of picked) {
    const line = byProject.get(e.projectId) ?? { projectId: e.projectId, raw: 0, billed: 0 };
    line.raw += e.durationSeconds;
    line.billed += billedSeconds(e.durationSeconds, rounding);
    byProject.set(e.projectId, line);
  }
  const lines = [...byProject.values()].map((l) => {
    const { name, rate } = rates.get(l.projectId);
    return { name, rate, raw: l.raw, billed: l.billed, hours: round2(l.billed / 3600), amount: round2((l.billed / 3600) * rate) };
  });
  lines.sort((a, b) => a.name.localeCompare(b.name));
  return { count: picked.length, lines, total: round2(lines.reduce((t, l) => t + l.amount, 0)), raw: lines.reduce((t, l) => t + l.raw, 0), billed: lines.reduce((t, l) => t + l.billed, 0) };
};

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
const freshPage = async (label, { width = 1280, height = 800, mobile = false } = {}) => {
  const context = await newContext();
  const page = await context.newPage();
  await page.setViewport({ width, height, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
  await page.emulateTimezone('Asia/Kolkata');
  await guard(page, label);
  return page;
};
const settled = (page, selector = 'main') =>
  page.waitForFunction((s) => !document.querySelector('.animate-spin') && document.querySelector(s), { timeout: 10000 }, selector);
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
// Elements of the page that run past the right edge of the screen. (On a phone the layout viewport grows with the content,
// so window.innerWidth can't be trusted: compare with the screen width instead.)
const runningOffScreen = (page, width) =>
  page.evaluate((w) => [...document.querySelectorAll('main *')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > w + 1; }).length, width);
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const pathOf = (page) => page.evaluate(() => location.pathname);
const clickButton = async (page, text, within = 'main') => {
  const handle = await page.evaluateHandle(
    (t, w) => [...document.querySelectorAll(`${w} button`)].find((b) => b.innerText.trim() === t && b.offsetParent !== null),
    text,
    within
  );
  const el = handle.asElement();
  if (!el) throw new Error(`No button "${text}" in ${within}`);
  await el.click();
};
const setField = (page, selector, value) =>
  page.$eval(selector, (el, v) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
const typeInto = async (page, selector, text) => {
  await page.click(selector, { clickCount: 1 });
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  if (text) await page.type(selector, text);
};
const colorOf = (page, cls, prop = 'color') =>
  page.evaluate((c, p) => {
    const probe = document.createElement('span');
    probe.className = c;
    document.body.appendChild(probe);
    const color = getComputedStyle(probe)[p];
    probe.remove();
    return color;
  }, cls, prop);

const previewReady = async (page) => {
  await sleep(450); // the preview waits 250 ms after the last change before asking the server
  return page.waitForFunction(() => {
    const p = document.querySelector('[data-testid="invoice-preview"]');
    return p && !p.innerText.includes('Checking unbilled time') && !p.innerText.includes('Choose the dates') && !p.innerText.includes('Pick a client');
  }, { timeout: 8000 });
};
const modalPreview = (page) => page.$eval('[data-testid="invoice-preview"]', (p) => p.innerText.replace(/\s+/g, ' ').trim());
const fillInvoiceModal = async (page, clientId, from, to) => {
  await page.select('#clientId', clientId);
  await setField(page, '#from', from);
  await setField(page, '#to', to);
  await previewReady(page);
};
const settingsState = (page) =>
  page.evaluate(() => ({
    name: document.querySelector('#name')?.value,
    timezone: document.querySelector('#timezone')?.value,
    timezoneReadOnly: document.querySelector('#timezone')?.readOnly,
    on: document.querySelector('button[role="switch"]')?.getAttribute('aria-checked') === 'true',
    saveDisabled: [...document.querySelectorAll('main button')].find((b) => b.innerText.trim() === 'Save changes')?.disabled,
  }));

// =====================================================================
// 1. `npm run seed`, twice, against the throwaway database
// =====================================================================
const seed1 = await runSeed();
check('npm run seed: exits cleanly and prints what it created', seed1.code === 0 && seed1.out.includes('Demo data created for Alex Morgan (demo@timeledger.app') && seed1.out.includes('INV-0001') && seed1.out.includes('INV-0002'), seed1.out.split('\n').slice(0, 3).join(' | '));
const seed2 = await runSeed();
check('npm run seed again: exactly the same summary (safe to run many times)', seed2.code === 0 && seed2.out === seed1.out);
const prod = await runSeed({ NODE_ENV: 'production' });
check('NODE_ENV=production refuses to seed unless SEED_ALLOW=true', prod.code === 1 && prod.out.includes('Refusing to seed') && prod.out.includes('SEED_ALLOW=true'), prod.out.trim().split('\n')[0]);

const login = await call('POST', '/auth/login', null, { email: 'demo@timeledger.app', password: 'Demo@1234' });
check('the demo login works through the API (demo@timeledger.app / Demo@1234)', login.status === 200 && login.body.user.name === 'Alex Morgan' && login.body.user.timezone === 'Asia/Kolkata' && login.body.user.currency === 'USD' && login.body.user.roundingMinutes === 0);
const T = login.body.token;
const DEMO_ID = login.body.user._id;

const entriesAll = (await call('GET', '/entries', T)).body.entries;
const projects = (await call('GET', '/projects', T)).body.projects;
const rates = new Map(projects.map((p) => [p._id, { name: p.name, rate: p.hourlyRate }]));
const clients = (await call('GET', '/clients', T)).body.clients;
const clientId = (name) => clients.find((c) => c.name === name)._id;
const invoicesApi = (await call('GET', '/invoices', T)).body.invoices;
const timer = (await call('GET', '/timer', T)).body.timer;

check('the demo data: 3 clients, 4 projects with the rates from the brief', clients.length === 3 && projects.length === 4 && [['Website redesign', 45], ['Mobile app', 60], ['Brand identity', 80], ['API integration', 55]].every(([n, r]) => projects.some((p) => p.name === n && p.hourlyRate === r)));
check('the client names are Acme Corp, Globex Ltd and Initech', clients.map((c) => c.name).sort().join() === 'Acme Corp,Globex Ltd,Initech');
check('about four weeks of entries, weekdays only, up to today', entriesAll.length > 40 && dayKeyIST(entriesAll.at(-1).startedAt) === mondayKey(4) && entriesAll.every((e) => dayKeyIST(e.startedAt) <= TODAY), `${entriesAll.length} entries from ${dayKeyIST(entriesAll.at(-1).startedAt)}`);
const perDay = new Map();
const crossing = entriesAll.filter((e) => dayKeyIST(e.startedAt) !== dayKeyIST(e.endedAt));
for (const e of entriesAll) if (!crossing.includes(e)) perDay.set(dayKeyIST(e.startedAt), (perDay.get(dayKeyIST(e.startedAt)) ?? 0) + 1);
check('2-4 entries on every full weekday, each 30 minutes to 3 hours', [...perDay].every(([day, n]) => day === TODAY || (n >= 2 && n <= 4)) && entriesAll.every((e) => e.durationSeconds >= 1800 && e.durationSeconds <= 10800), [...perDay.values()].join(''));
check('mostly billable, a few non-billable, one entry that crosses midnight, none in the future', entriesAll.filter((e) => !e.billable).length >= 1 && entriesAll.filter((e) => e.billable).length > entriesAll.length * 0.8 && crossing.length === 1 && entriesAll.every((e) => new Date(e.endedAt) <= new Date()));
check('no running timer', timer === null);
check('two invoices made by the real invoice service: INV-0001 Globex PAID (4 weeks ago), INV-0002 Acme SENT (3 to 2 weeks ago)',
  invoicesApi.length === 2 &&
    invoicesApi.some((i) => i.number === 'INV-0001' && i.client.name === 'Globex Ltd' && i.status === 'paid' && i.periodStart === mondayKey(4)) &&
    invoicesApi.some((i) => i.number === 'INV-0002' && i.client.name === 'Acme Corp' && i.status === 'sent' && i.periodStart === mondayKey(3) && i.periodEnd === dayKeyIST(new Date(Date.parse(mondayKey(2) + 'T00:00:00Z') + 6 * 86400000)))
);
const inv1 = invoicesApi.find((i) => i.number === 'INV-0001');
const inv2 = invoicesApi.find((i) => i.number === 'INV-0002');
const billedEntries = entriesAll.filter((e) => e.invoiceId);
check('the last two weeks are left unbilled (so a reviewer can invoice them right away)', billedEntries.every((e) => dayKeyIST(e.startedAt) < mondayKey(1)) && entriesAll.filter((e) => dayKeyIST(e.startedAt) >= mondayKey(1) && e.billable).every((e) => !e.invoiceId));
check('every billed entry is billable and claimed by exactly one of the two invoices', billedEntries.length > 0 && billedEntries.every((e) => e.billable) && new Set(billedEntries.map((e) => e.invoiceId)).size === 2);

// =====================================================================
// 2. Log in through the screen as the demo user
// =====================================================================
const A = await freshPage('A-demo');
await A.goto(BASE + '/login');
await A.waitForSelector('#email');
await typeInto(A, '#email', 'demo@timeledger.app');
await typeInto(A, '#password', 'Demo@1234');
await clickButton(A, 'Log in', 'form');
check('logging in as demo@timeledger.app / Demo@1234 opens the dashboard for Alex Morgan', (await waitUrl(A, "() => location.pathname === '/'")) && (await hasText(A, 'Welcome, Alex Morgan')));
await settled(A);
await sleep(500);
const dash = await A.evaluate(() => ({ week: document.querySelector('[data-testid="week-total"]')?.innerText, hasStart: [...document.querySelectorAll('main button')].some((b) => b.innerText.trim() === 'Start'), sidebarName: document.querySelector('aside p.truncate')?.innerText }));
const weekEntries = entriesAll.filter((e) => dayKeyIST(e.startedAt) >= mondayKey(0));
check('Dashboard: the "This week" card shows this week\'s tracked time', dash.week === fmtDur(weekEntries.reduce((t, e) => t + e.durationSeconds, 0)), `${dash.week} vs ${fmtDur(weekEntries.reduce((t, e) => t + e.durationSeconds, 0))}`);
check('Dashboard: nothing is running (a Start button, no clock) and the sidebar shows the name', dash.hasStart && dash.sidebarName === 'Alex Morgan');
await shot(A, '01-demo-dashboard-desktop');

// the Timesheet for last week, which holds the late-night entry
await A.goto(BASE + `/timesheet?week=${mondayKey(1)}`);
await waitSel(A, '[data-testid="timesheet-grid"]');
await sleep(400);
const lastWeekEntries = entriesAll.filter((e) => dayKeyIST(e.startedAt) >= mondayKey(1) && dayKeyIST(e.startedAt) < mondayKey(0));
const lastWeekTotal = lastWeekEntries.reduce((t, e) => t + e.durationSeconds, 0);
const sheet = await A.evaluate(() => ({
  rows: [...document.querySelectorAll('[data-testid="timesheet-grid"] tbody tr')].map((tr) => tr.innerText.replace(/\s+/g, ' ').trim()),
  cards: [...document.querySelectorAll('[data-testid="summary"] > div')].map((c) => c.innerText.replace(/\s+/g, ' ').trim().toLowerCase()),
}));
check('Timesheet (last week): a row per project, and the total hours match the entries', sheet.rows.length >= 4 && sheet.cards[0].includes(fmtDur(lastWeekTotal).toLowerCase()), `${sheet.cards[0]} vs ${fmtDur(lastWeekTotal)}`);
await shot(A, '02-demo-timesheet-desktop');

// Time entries: the billed entries show their badge, the non-billable ones say so
await A.goto(BASE + `/time-entries?from=${mondayKey(4)}&to=${TODAY}`);
await A.waitForSelector('main li');
await sleep(500);
const inv1Detail = (await call('GET', `/invoices/${inv1._id}`, T)).body;
const inv2Detail = (await call('GET', `/invoices/${inv2._id}`, T)).body;
const te = await A.evaluate(() => ({
  billed: [...document.querySelectorAll('main li a[href^="/invoices/"]')].map((a) => a.getAttribute('href')),
  nonBillable: [...document.querySelectorAll('main li')].filter((li) => li.innerText.includes('Non-billable')).length,
  total: document.querySelectorAll('main li').length,
}));
check('Time entries (all four weeks): every entry of INV-0001 and INV-0002 has a "Billed" badge that links to its own invoice',
  te.billed.length === billedEntries.length && te.billed.filter((h) => h === `/invoices/${inv1._id}`).length === inv1Detail.invoice.entryIds.length && te.billed.filter((h) => h === `/invoices/${inv2._id}`).length === inv2Detail.invoice.entryIds.length, `${te.billed.length} badges`);
check('...every entry is listed and the non-billable ones are labelled', te.total === entriesAll.length && te.nonBillable === entriesAll.filter((e) => !e.billable).length, `${te.total} entries, ${te.nonBillable} non-billable`);
await shot(A, '03-demo-time-entries-desktop');

// Invoices
await A.goto(BASE + '/invoices');
await A.waitForSelector('main ul > li a[href^="/invoices/"]');
const rows = await A.$$eval('main ul > li a[href^="/invoices/"]', (as) => as.map((a) => a.innerText.replace(/\s+/g, ' ').trim()));
check('Invoices: INV-0002 (Acme, Sent) above INV-0001 (Globex, Paid) with their totals', rows.length === 2 && rows[0].startsWith('INV-0002 Acme Corp') && rows[0].includes(money(inv2.total)) && rows[0].includes('Sent') && rows[1].startsWith('INV-0001 Globex Ltd') && rows[1].includes(money(inv1.total)) && rows[1].includes('Paid'), rows.join(' || '));
const cards = await A.$$eval('[data-testid="summary"] > div', (c) => c.map((x) => x.innerText.replace(/\s+/g, ' ').trim().toLowerCase()));
check('Invoices: Outstanding = the sent invoice, Paid = the paid one, 2 invoices', cards[0].includes(money(inv2.total)) && cards[1].includes(money(inv1.total)) && cards[2].endsWith('2'), cards.join(' | '));
await shot(A, '04-demo-invoices-desktop');
await A.click(`main ul > li a[href="/invoices/${inv2._id}"]`);
await waitSel(A, '[data-testid="invoice-number"]');
const demoInv = await A.evaluate(() => ({
  paper: document.querySelector('article.invoice-paper').innerText.replace(/\s+/g, ' ').toLowerCase(),
  total: document.querySelector('[data-testid="invoice-total"]').innerText,
  status: document.querySelector('[data-testid="invoice-status"]').innerText.trim(),
  rounding: document.querySelector('[data-testid="rounding-note"]')?.innerText ?? null,
}));
check('INV-0002: from Alex Morgan to Acme Corp, status Sent, total as listed, thank-you note, no rounding note', demoInv.paper.includes('alex morgan') && demoInv.paper.includes('acme corp') && demoInv.status === 'Sent' && demoInv.total === money(inv2.total) && demoInv.paper.includes('thank you for your business') && demoInv.rounding === null);
await shot(A, '05-demo-invoice-sent-desktop');

// =====================================================================
// 3. Settings
// =====================================================================
await A.click('aside a[href="/settings"]');
await waitSel(A, '#name');
check('the sidebar has a Settings item (gear) that opens /settings and stays highlighted', (await pathOf(A)) === '/settings' && (await A.$eval('aside a[href="/settings"]', (a) => a.className.includes('bg-indigo-800') && !!a.querySelector('svg'))));
const s0 = await settingsState(A);
check('Settings: Name is filled in, Time zone is Asia/Kolkata and read-only, rounding is off, Save is disabled until something changes', s0.name === 'Alex Morgan' && s0.timezone === 'Asia/Kolkata' && s0.timezoneReadOnly === true && s0.on === false && s0.saveDisabled === true, JSON.stringify(s0));
check('Settings: the toggle is labelled "Round each entry up to 15 minutes"', await hasText(A, 'Round each entry up to 15 minutes'));
await shot(A, '06-settings-desktop');

// an invalid name is answered by the server's message under the field
await typeInto(A, '#name', 'A');
check('typing a different name enables Save', (await settingsState(A)).saveDisabled === false);
await clickButton(A, 'Save changes');
check('a one-letter name is refused with the server\'s message under the field, and nothing changes', (await hasText(A, 'Name must be at least 2 characters')) && (await A.$eval('aside p.truncate', (p) => p.innerText)) === 'Alex Morgan');
await shot(A, '07-settings-name-error-desktop');
await typeInto(A, '#name', 'Alex M. Morgan');
await clickButton(A, 'Save changes');
check('a valid name is saved: toast, and the sidebar shows it straight away', (await hasText(A, 'Settings saved')) && (await A.waitForFunction(() => document.querySelector('aside p.truncate')?.innerText === 'Alex M. Morgan', { timeout: 5000 }).then(() => true, () => false)));
await A.reload();
await waitSel(A, '#name');
check('...and it is still there after a reload', (await settingsState(A)).name === 'Alex M. Morgan');
await typeInto(A, '#name', 'Alex Morgan');
await clickButton(A, 'Save changes');
await hasText(A, 'Settings saved');
await gone(A, 'Settings saved');

// =====================================================================
// 4. The rounding rule
// =====================================================================
const initech = clientId('Initech');
const FROM = mondayKey(4);

// without rounding first
await A.goto(BASE + '/invoices');
await A.waitForSelector('[data-testid="summary"]');
await clickButton(A, 'New invoice');
await waitSel(A, '[role=dialog] #clientId');
await fillInvoiceModal(A, initech, FROM, TODAY);
const plainWanted = expectedInvoice(entriesAll, rates, initech, FROM, TODAY, 0);
const plainText = await modalPreview(A);
check(`Rounding off: the Initech preview bills exactly what was tracked (${plainWanted.count} entries, ${money(plainWanted.total)})`, plainText.includes(money(plainWanted.total)) && plainText.includes(`${plainWanted.count} entries`) && plainWanted.lines.every((l) => plainText.includes(`${l.hours.toFixed(2)} h × ${money(l.rate)}`)), plainText);
check('...and there is no rounding note', (await A.$('[data-testid="rounding-note"]')) === null);
await A.keyboard.press('Escape');

// switch it on in Settings
await A.click('aside a[href="/settings"]');
await waitSel(A, '#name');
await A.click('button[role="switch"]');
check('toggling the switch enables Save', (await settingsState(A)).on === true && (await settingsState(A)).saveDisabled === false);
await clickButton(A, 'Save changes');
check('Save: toast "Settings saved"', await hasText(A, 'Settings saved'));
await A.reload();
await waitSel(A, '#name');
check('...and the rule is still on after a reload (saved on the server)', (await settingsState(A)).on === true && (await call('GET', '/auth/me', T)).body.user.roundingMinutes === 15);
await shot(A, '08-settings-rounding-on-desktop');

// the preview with rounding on
await A.goto(BASE + '/invoices');
await A.waitForSelector('[data-testid="summary"]');
await clickButton(A, 'New invoice');
await waitSel(A, '[role=dialog] #clientId');
await fillInvoiceModal(A, initech, FROM, TODAY);
const roundedWanted = expectedInvoice(entriesAll, rates, initech, FROM, TODAY, 15);
const roundedText = await modalPreview(A);
check(`Rounding on: the preview says "Rounded up to 15 min per entry" and shows the tracked and billed time`, roundedText.includes('Rounded up to 15 min per entry') && roundedText.includes(`${fmtDur(roundedWanted.raw)} tracked`) && roundedText.includes(`${fmtDur(roundedWanted.billed)} billed`), roundedText);
check(`...with the amounts worked out per entry: ${money(roundedWanted.total)} instead of ${money(plainWanted.total)}`, roundedWanted.total > plainWanted.total && roundedText.includes(money(roundedWanted.total)) && roundedWanted.lines.every((l) => roundedText.includes(`${l.hours.toFixed(2)} h × ${money(l.rate)}`) && roundedText.includes(money(l.amount))), roundedText);
await shot(A, '09-new-invoice-rounding-preview-desktop');
await A.click('[role=dialog] button[type=submit]');
check('creating it: toast "Invoice INV-0003 created" and the invoice page opens', (await hasText(A, 'Invoice INV-0003 created')) && (await waitUrl(A, "() => /^\\/invoices\\/[0-9a-f]{24}$/.test(location.pathname)")));
await waitSel(A, '[data-testid="invoice-number"]');
const inv3Id = (await pathOf(A)).split('/').pop();
const page3 = await A.evaluate(() => ({
  note: document.querySelector('[data-testid="rounding-note"]')?.innerText.trim(),
  total: document.querySelector('[data-testid="invoice-total"]').innerText,
  rows: [...document.querySelectorAll('[data-testid="line-items-table"] tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.innerText.trim())),
}));
check('INV-0003 shows "Rounded up to 15 min per entry", the billed hours and the rounded total', page3.note === 'Rounded up to 15 min per entry' && page3.total === money(roundedWanted.total) && page3.rows.length === roundedWanted.lines.length && roundedWanted.lines.every((l, i) => page3.rows[i][0] === l.name && page3.rows[i][1] === l.hours.toFixed(2) && page3.rows[i][3] === money(l.amount)), JSON.stringify(page3.rows));
await A.click('[data-testid="entries-included"] summary');
const listed = await A.$$eval('[data-testid="entries-included"] li', (lis) => lis.map((li) => li.innerText.replace(/\s+/g, ' ').trim()));
const arrows = listed.filter((t) => t.includes('→')).length;
const toRound = entriesAll.filter((e) => e.billable && !e.invoiceId && e.clientId === initech && dayKeyIST(e.startedAt) >= FROM && e.durationSeconds % 900 !== 0).length;
check(`the entry list shows tracked → billed for the entries that were rounded (${toRound} of ${listed.length})`, listed.length === roundedWanted.count && arrows === toRound && toRound > 0, `${arrows} arrows`);
const sampleRounded = entriesAll.find((e) => e.billable && !e.invoiceId && e.clientId === initech && e.durationSeconds % 900 !== 0);
check(`...e.g. "${fmtDur(sampleRounded.durationSeconds)} → ${fmtDur(billedSeconds(sampleRounded.durationSeconds, 15))}"`, listed.some((t) => t.includes(`${fmtDur(sampleRounded.durationSeconds)} → ${fmtDur(billedSeconds(sampleRounded.durationSeconds, 15))}`)));
await gone(A, 'Invoice INV-0003 created'); // let the toast leave so it doesn't cover the buttons in the picture
await A.evaluate(() => window.scrollTo(0, 0));
await shot(A, '10-invoice-rounded-desktop');

const afterEntries = (await call('GET', '/entries', T)).body.entries;
const sameDurations = entriesAll.every((e) => afterEntries.find((x) => x._id === e._id)?.durationSeconds === e.durationSeconds);
check('the entries themselves are untouched: every tracked duration is exactly what it was', sameDurations && afterEntries.length === entriesAll.length);

// switching it off again never changes the invoice that was made with it on, and old invoices never had it
await A.click('aside a[href="/settings"]');
await waitSel(A, '#name');
await A.click('button[role="switch"]');
await clickButton(A, 'Save changes');
await hasText(A, 'Settings saved');
await gone(A, 'Settings saved');
check('rounding switched off again', (await call('GET', '/auth/me', T)).body.user.roundingMinutes === 0);
await A.goto(BASE + `/invoices/${inv3Id}`);
await waitSel(A, '[data-testid="invoice-number"]');
check('INV-0003 is unchanged after switching the rule off: same note, same total', (await A.$eval('[data-testid="rounding-note"]', (n) => n.innerText.trim())) === 'Rounded up to 15 min per entry' && (await A.$eval('[data-testid="invoice-total"]', (n) => n.innerText)) === money(roundedWanted.total));
await A.goto(BASE + `/invoices/${inv1._id}`);
await waitSel(A, '[data-testid="invoice-number"]');
check('INV-0001 (made before) has no rounding note and its total is unchanged', (await A.$('[data-testid="rounding-note"]')) === null && (await A.$eval('[data-testid="invoice-total"]', (n) => n.innerText)) === money(inv1.total));

// a new invoice with the rule off bills as tracked again: Acme, last two weeks
const acme = clientId('Acme Corp');
const acmeWanted = expectedInvoice(entriesAll, rates, acme, mondayKey(1), TODAY, 0);
await A.goto(BASE + '/invoices');
await A.waitForSelector('[data-testid="summary"]');
await clickButton(A, 'New invoice');
await waitSel(A, '[role=dialog] #clientId');
await fillInvoiceModal(A, acme, mondayKey(4), TODAY);
const acmeText = await modalPreview(A);
check(`Rounding off again: an Acme invoice for the unbilled time is exactly as tracked (${acmeWanted.count} entries, ${money(acmeWanted.total)}; the billed INV-0002 entries are not in it)`, acmeText.includes(money(acmeWanted.total)) && acmeText.includes(`${acmeWanted.count} entries`) && !acmeText.includes('Rounded up'), acmeText);
await A.keyboard.press('Escape');

// the printed invoice also carries the note
await A.goto(BASE + `/invoices/${inv3Id}`);
await waitSel(A, '[data-testid="invoice-number"]');
await A.setViewport({ width: 794, height: 1123 });
await A.emulateMediaType('print');
await sleep(300);
const printed = await A.evaluate(() => ({ note: document.querySelector('[data-testid="rounding-note"]')?.offsetParent !== null, aside: getComputedStyle(document.querySelector('aside')).display }));
check('Print view of INV-0003: the sidebar is gone and the rounding note is part of the printed page', printed.note && printed.aside === 'none');
await A.emulateMediaType('screen');
await A.setViewport({ width: 1280, height: 800 });

// =====================================================================
// 5. Seeding again resets the demo user and keeps the session
// =====================================================================
await call('PATCH', '/auth/me', T, { roundingMinutes: 15 });
const seed3 = await runSeed();
const invoiceLines = (out) => out.split(/\r?\n/).filter((l) => l.includes('INV-000') || l.includes('Clients:') || l.includes('Projects:')).join(' | ');
check('npm run seed once more (with an extra invoice and rounding switched on): same clients, projects and invoices again', seed3.code === 0 && invoiceLines(seed3.out) === invoiceLines(seed1.out) && invoiceLines(seed1.out).includes('INV-0002'));
const afterSeed = (await call('GET', '/invoices', T)).body.invoices;
check('the extra invoice INV-0003 is gone and numbering starts again at INV-0001/INV-0002', afterSeed.map((i) => i.number).sort().join() === 'INV-0001,INV-0002');
check('the demo user is the same one (the session still works) and rounding is reset to off', (await call('GET', '/auth/me', T)).body.user._id === DEMO_ID && (await call('GET', '/auth/me', T)).body.user.roundingMinutes === 0);
await A.goto(BASE + '/invoices');
await A.waitForSelector('main ul > li a[href^="/invoices/"]');
check('in the browser: still logged in after the re-seed, with the two seeded invoices', (await A.$$eval('main ul > li a[href^="/invoices/"]', (as) => as.length)) === 2);

// =====================================================================
// 6. Phone (375px)
// =====================================================================
const M = await freshPage('M-phone', { width: 375, height: 667, mobile: true });
await withToken(M, T, '/');
await sleep(500);
const bar = await M.evaluate(() => {
  const box = (sel) => { const r = document.querySelector(sel)?.getBoundingClientRect(); return r && { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) }; };
  return { gear: box('header a[href="/settings"]'), logout: box('header button[aria-label="Log out"]'), bottomTabs: document.querySelectorAll('nav.fixed a').length };
});
check('Phone: the top bar has a Settings gear next to Log out, both inside the screen', bar.gear && bar.logout && bar.gear.right <= bar.logout.left && bar.logout.right <= 375 && bar.gear.width >= 32, JSON.stringify(bar));
check('Phone: the bottom tab bar keeps its six tabs (no cramped seventh)', bar.bottomTabs === 6);
check('Phone: the dashboard fits the screen: no horizontal scroll and no card wider than 375px', (await overflow(M)) <= 0 && (await runningOffScreen(M, 375)) === 0 && (await M.evaluate(() => window.innerWidth)) === 375, `${await runningOffScreen(M, 375)} elements past the edge`);
await shot(M, '11-demo-dashboard-mobile');
await M.click('header a[href="/settings"]');
await waitSel(M, '#name');
const ms = await settingsState(M);
check('Phone: the gear opens Settings, which fits the screen and shows the toggle', ms.name === 'Alex Morgan' && (await overflow(M)) <= 0 && (await hasText(M, 'Round each entry up to 15 minutes')), `overflow=${await overflow(M)}`);
await shot(M, '12-settings-mobile');
const inv2Again = afterSeed.find((i) => i.number === 'INV-0002');
// the top bar while a timer runs: logo, clock, Settings gear and Log out all have to fit (the regression that adding the gear could cause)
const projectsNow = (await call('GET', '/projects', T)).body.projects; // the seed made new ones
const started = await call('POST', '/timer/start', T, { projectId: projectsNow[0]._id, description: 'top bar check' });
check('a timer can be started on the demo user (a reviewer does exactly this)', started.status === 201);
for (const width of [375, 360]) {
  await M.setViewport({ width, height: 667, isMobile: true, hasTouch: true });
  await M.goto(BASE + '/');
  await M.waitForSelector('header [data-testid="mini-timer"]');
  await sleep(300);
  const topBar = await M.evaluate(() => {
    const r = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right }; };
    const header = document.querySelector('header');
    return { logo: r(header.firstElementChild), mini: r(header.querySelector('[data-testid="mini-timer"]')), gear: r(header.querySelector('a[href="/settings"]')), logout: r(header.querySelector('button[aria-label="Log out"]')) };
  });
  check(`Phone ${width}px, timer running: logo, clock, gear and Log out are in this order, don't overlap and stay on screen`,
    topBar.logo.right <= topBar.mini.left && topBar.mini.right <= topBar.gear.left + 0.5 && topBar.gear.right <= topBar.logout.left + 0.5 && topBar.logout.right <= width - 8 && (await overflow(M)) <= 0, JSON.stringify(topBar));
  check(`Phone ${width}px, timer running: the dashboard cards (running timer, This week, Today) fit the screen`, (await runningOffScreen(M, width)) === 0 && (await M.evaluate(() => window.innerWidth)) === width, `${await runningOffScreen(M, width)} elements past the edge`);
  if (width === 375) await shot(M, '15-running-timer-top-bar-mobile');
}
await call('POST', '/timer/stop', T);
await M.setViewport({ width: 375, height: 667, isMobile: true, hasTouch: true });

await M.goto(BASE + `/invoices/${inv2Again._id}`);
await waitSel(M, '[data-testid="invoice-number"]');
check('Phone: the demo invoice has no horizontal scroll and stacks its lines', (await overflow(M)) <= 0 && (await M.$eval('[data-testid="line-items-stacked"]', (e) => getComputedStyle(e).display)) !== 'none');
await shot(M, '13-demo-invoice-mobile');
await M.goto(BASE + `/timesheet?week=${mondayKey(1)}`);
await waitSel(M, '[data-testid="timesheet-days"]');
check('Phone: the demo timesheet shows one card per day without sideways scrolling', (await overflow(M)) <= 0);
await shot(M, '14-demo-timesheet-mobile');

// =====================================================================
check('isolated: no request went to the dev servers on 5000/5173', blocked.length === 0, blocked.join(' | '));
check('no unexpected console/page errors', consoleErrors.length === 0, consoleErrors.join(' | '));

await browser.close();
console.log(failures === 0 ? '\nALL STEP 8 BROWSER CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
