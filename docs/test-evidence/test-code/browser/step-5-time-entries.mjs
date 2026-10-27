import puppeteer from 'puppeteer-core';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';

const BASE = process.env.E2E_BASE || 'http://localhost:5273';
const API = process.env.E2E_API || 'http://localhost:5100/api';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SHOTS = new URL('./shots5/', import.meta.url).pathname.replace(/^\//, '');
const MONGO_URI_FILE = process.env.E2E_MONGO_URI_FILE || new URL('../mongo-uri.txt', import.meta.url).pathname.replace(/^\//, '');
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const check = (name, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- the throwaway database (for things no API allows yet: marking an entry as billed, timer entries with seconds) ----------
const requireFromBackend = createRequire('C:/Users/sande/OneDrive/Desktop/timeledger/backend/package.json');
const { MongoClient, ObjectId } = requireFromBackend('mongodb');
const mongo = await MongoClient.connect(readFileSync(MONGO_URI_FILE, 'utf8'));
const entriesCollection = mongo.db().collection('timeentries');

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
  (await call('POST', '/auth/register', null, { name, email: `s5-${name.toLowerCase()}-${stamp}@example.com`, password: 'Passw0rd!' })).body;

const priya = await register('Priya');
const T = priya.token;
const acme = (await call('POST', '/clients', T, { name: 'Acme Corp' })).body.client;
const globex = (await call('POST', '/clients', T, { name: 'Globex' })).body.client;
const website = (await call('POST', '/projects', T, { name: 'Website', clientId: acme._id, hourlyRate: 50, color: '#10B981' })).body.project;
const mobileApp = (await call('POST', '/projects', T, { name: 'Mobile app', clientId: acme._id, hourlyRate: 60 })).body.project;
const branding = (await call('POST', '/projects', T, { name: 'Branding', clientId: globex._id, hourlyRate: 80, color: '#F59E0B' })).body.project;

// times written in India time (UTC+5:30), like the app's default time zone
const ist = (date, time) => `${date}T${time}:00+05:30`;
const addEntry = async (projectId, description, startedAt, endedAt, billable = true) => {
  const res = await call('POST', '/entries', T, { projectId, description, startedAt, endedAt, billable });
  if (res.status !== 201) throw new Error(`seeding failed: ${JSON.stringify(res.body)}`);
  return res.body.entry;
};

// A fixed week in the past, so the numbers never depend on the day the test runs
const wireframes = await addEntry(website._id, 'Wireframes', ist('2026-03-09', '09:00'), ist('2026-03-09', '11:00')); // 2h, will be billed
const review = await addEntry(website._id, 'Review', ist('2026-03-10', '10:00'), ist('2026-03-10', '10:30')); // 30m
const internalSync = await addEntry(mobileApp._id, 'Internal sync', ist('2026-03-10', '14:00'), ist('2026-03-10', '15:00'), false); // 1h non-billable
const logo = await addEntry(branding._id, 'Logo options', ist('2026-03-11', '09:00'), ist('2026-03-11', '12:15')); // 3h15m
const night = await addEntry(website._id, 'Night deploy', ist('2026-03-11', '23:00'), ist('2026-03-12', '01:00')); // 2h across midnight
await entriesCollection.updateOne({ _id: new ObjectId(wireframes._id) }, { $set: { invoiceId: new ObjectId() } }); // on an invoice

// Recent entries for the "this week / last week / this month" presets
const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();
const standup = await addEntry(website._id, 'Standup notes', minutesAgo(20), minutesAgo(5));
await addEntry(mobileApp._id, 'Last week task', minutesAgo(7 * 24 * 60 + 30), minutesAgo(7 * 24 * 60 + 10));

// ---------- independent helpers (so the test doesn't just repeat the app's own code) ----------
const fmtDur = (s) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : m > 0 ? `${m}m` : `${s}s`;
};
const fmtMoney = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
const IST_OFFSET = 5.5 * 3600 * 1000;
const istWall = (d = new Date()) => new Date(d.getTime() + IST_OFFSET); // UTC fields of this date are the India wall clock
const istMidnight = (y, m, d) => new Date(Date.UTC(y, m, d) - IST_OFFSET).toISOString();
const istDateKey = (offsetDays = 0) => {
  const w = istWall(new Date(Date.now() + offsetDays * 86400000));
  return `${w.getUTCFullYear()}-${String(w.getUTCMonth() + 1).padStart(2, '0')}-${String(w.getUTCDate()).padStart(2, '0')}`;
};

// ---------- browser helpers ----------
const browser = await puppeteer.launch({ executablePath: EDGE, headless: true });
const consoleErrors = [];
const blocked = [];

// Safety net: never let a test request reach the developer's own servers (5000 = backend with the real DB, 5173 = dev server)
const guard = async (page, label) => {
  page.entryRequests = [];
  page.patchMe = [];
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const url = r.url();
    if (/localhost:(5000|5173)\b/.test(url)) {
      blocked.push(url);
      r.abort();
      return;
    }
    if (r.method() === 'GET' && /\/api\/entries\?/.test(url)) page.entryRequests.push(url);
    if (r.method() === 'PATCH' && /\/api\/auth\/me/.test(url)) page.patchMe.push(r.postData());
    r.continue();
  });
  page.on('pageerror', (e) => consoleErrors.push(`[${label}] pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/status of (400|401|404|409)/.test(m.text())) consoleErrors.push(`[${label}] ${m.text()}`);
  });
};

const newContext = () => (browser.createBrowserContext ? browser.createBrowserContext() : browser.createIncognitoBrowserContext());

const openDevice = async (label, token, { width = 1280, height = 800, timezone, path = '/' } = {}) => {
  const context = await newContext();
  const page = await context.newPage();
  await page.setViewport({ width, height });
  await guard(page, label);
  if (timezone) await page.emulateTimezone(timezone);
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
const shot = (page, name) => page.screenshot({ path: SHOTS + name + '.png' });
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const settled = (page) => page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), { timeout: 8000 }).catch(() => {});
const clickButton = async (page, label, within = 'body', exact = true) => {
  const handle = await page.evaluateHandle(
    (label, within, exact) =>
      [...document.querySelectorAll(`${within} button`)].find(
        (b) => (exact ? b.innerText.trim() === label : b.innerText.trim().startsWith(label)) && b.offsetParent !== null
      ),
    label,
    within,
    exact
  );
  const el = handle.asElement();
  if (!el) throw new Error(`No button "${label}" in ${within}`);
  await el.click();
};

// Set a controlled input's value the way React notices it (date and time inputs are awkward to type into)
const setField = (page, selector, value) =>
  page.$eval(
    selector,
    (el, v) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
    value
  );
const typeInto = async (page, selector, text) => {
  await page.focus(selector);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  if (text) await page.type(selector, text);
};
const chooseProject = async (page, buttonSelector, name) => {
  await page.click(buttonSelector);
  await page.waitForSelector('[role=listbox]');
  const option = await page.evaluateHandle((n) => [...document.querySelectorAll('[role=option]')].find((o) => o.innerText.trim().startsWith(n)), name);
  await option.asElement().click();
};

// change a filter and wait for the list to reload
const setFilter = async (page, id, value) => {
  const before = page.entryRequests.length;
  await page.select(`#${id}`, value);
  for (let i = 0; i < 60 && page.entryRequests.length === before; i++) await sleep(50);
  await settled(page);
};
const setCustomRange = async (page, from, to) => {
  await page.select('#filter-preset', 'custom');
  await sleep(100);
  await setField(page, '#filter-from', from);
  await setField(page, '#filter-to', to);
  await sleep(300);
  await settled(page);
};

// A toast from the previous action can still be on screen, so "toast visible" doesn't prove the save is done.
// Read the server again until it shows the expected state (or give up after a few seconds).
const eventually = async (read, isDone, timeout = 5000) => {
  const deadline = Date.now() + timeout;
  let value = await read();
  while (!isDone(value) && Date.now() < deadline) {
    await sleep(100);
    value = await read();
  }
  return value;
};

const queryOf = (page) => {
  const url = new URL(page.entryRequests.at(-1));
  return Object.fromEntries(url.searchParams);
};
const days = (page) =>
  page.$$eval('main section[aria-label]', (sections) =>
    sections.map((s) => ({
      heading: s.querySelector('h2').innerText.trim(),
      total: s.querySelector('h2 + p').innerText.trim(),
      rows: [...s.querySelectorAll('li')].map((li) => li.innerText.replace(/\s+/g, ' ').trim()),
    }))
  );
const allRows = async (page) => (await days(page)).flatMap((d) => d.rows);
const summary = (page) =>
  page.$$eval('[data-testid="summary"] > div', (cards) => cards.map((c) => c.innerText.replace(/\s+/g, ' ').trim().toLowerCase()));
const rowHandle = (page, text) =>
  page.evaluateHandle((t) => [...document.querySelectorAll('main li')].find((li) => li.innerText.includes(t)), text);

// =====================================================================
// 1. The page, the date presets and what the app asks the server
// =====================================================================
const A = await openDevice('A-priya', T);
await A.click('aside a[href="/time-entries"]');
await A.waitForFunction(() => location.pathname === '/time-entries');
await settled(A);
check('"Time Entries" in the sidebar opens the real page (not "Coming soon")', (await waitSel(A, '[data-testid="summary"]')) && !(await A.evaluate(() => document.body.innerText.includes('Coming soon'))));
check('header: "Time entries" + "Add entry" button', (await A.$eval('main h1', (h) => h.innerText)) === 'Time entries' && Boolean(await rowHandleButton(A, 'Add entry')));

// This week (Monday to Monday, in India time) is the default
const wall = istWall();
const sinceMonday = (wall.getUTCDay() + 6) % 7;
const weekFrom = istMidnight(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() - sinceMonday);
const weekTo = istMidnight(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() - sinceMonday + 7);
check('default range is "This week": the request covers Monday 00:00 to next Monday 00:00 (India time)', queryOf(A).from === weekFrom && queryOf(A).to === weekTo, `${queryOf(A).from} -> ${queryOf(A).to}`);
const todayRows = await days(A);
check('this week shows today\'s entry under a "Today" heading', todayRows.some((d) => d.heading.startsWith('Today') && d.rows.some((r) => r.includes('Standup notes'))), todayRows.map((d) => d.heading).join(' | '));
check('...but not last week\'s', !todayRows.some((d) => d.rows.some((r) => r.includes('Last week task'))));

await setFilter(A, 'filter-preset', 'last-week');
check('"Last week" asks for the previous Monday-to-Monday range', queryOf(A).from === istMidnight(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() - sinceMonday - 7) && queryOf(A).to === weekFrom, `${queryOf(A).from} -> ${queryOf(A).to}`);
check('...and shows last week\'s entry only', (await allRows(A)).length === 1 && (await allRows(A))[0].includes('Last week task'));

await setFilter(A, 'filter-preset', 'this-month');
check('"This month" asks for the 1st to the 1st of next month', queryOf(A).from === istMidnight(wall.getUTCFullYear(), wall.getUTCMonth(), 1) && queryOf(A).to === istMidnight(wall.getUTCFullYear(), wall.getUTCMonth() + 1, 1), `${queryOf(A).from} -> ${queryOf(A).to}`);
check('...and includes today\'s entry', (await allRows(A)).some((r) => r.includes('Standup notes')));

// =====================================================================
// 2. A known week: summary, day groups, rows
// =====================================================================
await setCustomRange(A, '2026-03-09', '2026-03-13');
const customQuery = queryOf(A);
check('custom range includes both end days (9 March 00:00 to 14 March 00:00, India time)', customQuery.from === '2026-03-08T18:30:00.000Z' && customQuery.to === '2026-03-13T18:30:00.000Z', `${customQuery.from} -> ${customQuery.to}`);

// total = 2h + 30m + 1h + 3h15m + 2h = 8h45m; billable = all but the 1h non-billable = 7h45m
// unbilled amount (billable, not billed) = 0.5h x 50 + 3.25h x 80 + 2h x 50 = 25 + 260 + 100 = 385
let base = { total: 7200 + 1800 + 3600 + 11700 + 7200, billable: 7200 + 1800 + 11700 + 7200, unbilled: 25 + 260 + 100 };
let cards = await summary(A);
check('summary cards: total hours', cards[0].includes(fmtDur(base.total)) && fmtDur(base.total) === '8h 45m', cards[0]);
check('summary cards: billable hours', cards[1].includes(fmtDur(base.billable)) && fmtDur(base.billable) === '7h 45m', cards[1]);
check('summary cards: unbilled amount (the billed entry is left out)', cards[2].includes(fmtMoney(base.unbilled)) && fmtMoney(base.unbilled) === '$385.00', cards[2]);

let groups = await days(A);
check('entries are grouped by day, newest day first, with the day\'s hours', JSON.stringify(groups.map((g) => [g.heading, g.total])) === JSON.stringify([['Wed, 11 Mar 2026', '5h 15m'], ['Tue, 10 Mar 2026', '1h 30m'], ['Mon, 9 Mar 2026', '2h']]), JSON.stringify(groups.map((g) => [g.heading, g.total])));
check('within a day the latest start comes first', groups[0].rows[0].includes('Night deploy') && groups[0].rows[1].includes('Logo options'));
const logoRow = groups[0].rows[1];
check('row: project, client, description, time range, duration, badge', ['Branding', 'Globex', 'Logo options', '09:00–12:15', '3h 15m', 'Billable'].every((s) => logoRow.includes(s)), logoRow);
check('row: an entry past midnight shows 23:00–01:00 (+1 day)', groups[0].rows[0].includes('23:00–01:00 (+1 day)') && groups[0].rows[0].includes('2h'), groups[0].rows[0]);
const syncRow = groups[1].rows.find((r) => r.includes('Internal sync'));
check('row: a non-billable entry gets the "Non-billable" badge', syncRow.includes('Non-billable'), syncRow);
const billedRow = groups[2].rows[0];
check('row: an entry on an invoice gets the "Billed" badge', billedRow.includes('Billed') && billedRow.includes('Wireframes'), billedRow);

const rowUi = await A.evaluate(() => {
  const li = [...document.querySelectorAll('main li')];
  const find = (t) => li.find((e) => e.innerText.includes(t));
  const dur = find('Logo options').querySelector('.font-mono.text-sm.font-medium');
  const badgeColor = (t, label) => {
    const badge = [...find(t).querySelectorAll('span')].find((s) => s.innerText.trim() === label);
    return badge ? getComputedStyle(badge).color : null;
  };
  const probe = (cls) => {
    const el = document.createElement('span');
    el.className = cls;
    document.body.appendChild(el);
    const color = getComputedStyle(el).color;
    el.remove();
    return color;
  };
  return {
    durationFont: getComputedStyle(dur).fontFamily,
    billable: badgeColor('Logo options', 'Billable'), emerald: probe('text-emerald-700'),
    non: badgeColor('Internal sync', 'Non-billable'), slate: probe('text-slate-700'),
    billed: badgeColor('Wireframes', 'Billed'), indigo: probe('text-indigo-700'),
    dotColor: getComputedStyle(find('Logo options').querySelector('span[aria-hidden="true"]')).backgroundColor,
    billedHasEdit: Boolean(find('Wireframes').querySelector('button[aria-label="Edit entry"]')),
    billedHasDelete: Boolean(find('Wireframes').querySelector('button[aria-label="Delete entry"]')),
    billedLock: Boolean(find('Wireframes').querySelector('[role="img"][aria-label^="Billed"]')),
    normalHasActions: Boolean(find('Logo options').querySelector('button[aria-label="Edit entry"]')) && Boolean(find('Logo options').querySelector('button[aria-label="Delete entry"]')),
  };
});
check('duration is shown in JetBrains Mono', rowUi.durationFont.includes('JetBrains'));
check('badge colors: Billable emerald, Non-billable slate, Billed indigo', rowUi.billable === rowUi.emerald && rowUi.non === rowUi.slate && rowUi.billed === rowUi.indigo, JSON.stringify([rowUi.billable, rowUi.non, rowUi.billed]));
check('project color dot on each row (Branding is amber)', rowUi.dotColor === 'rgb(245, 158, 11)', rowUi.dotColor);
check('billed entry: lock icon instead of edit/delete', rowUi.billedLock && !rowUi.billedHasEdit && !rowUi.billedHasDelete);
check('normal entry: edit and delete buttons', rowUi.normalHasActions);
await shot(A, '01-time-entries-desktop');

// =====================================================================
// 3. Filters
// =====================================================================
await setFilter(A, 'filter-billable', 'non-billable');
check('Billable filter "Non-billable" sends billable=false and shows just that entry', queryOf(A).billable === 'false' && (await allRows(A)).length === 1 && (await allRows(A))[0].includes('Internal sync'));
cards = await summary(A);
check('...the summary follows the filter (1h total, 0m billable, $0.00)', cards[0].includes('1h') && cards[1].includes('0s') && cards[2].includes('$0.00'), cards.join(' | '));

await setFilter(A, 'filter-billable', 'billable');
check('"Billable" sends billable=true and hides the non-billable entry', queryOf(A).billable === 'true' && (await allRows(A)).length === 4 && !(await allRows(A)).some((r) => r.includes('Internal sync')));
await setFilter(A, 'filter-billable', 'all');

await setFilter(A, 'filter-status', 'billed');
check('Status "Billed" sends status=billed and shows only the invoiced entry', queryOf(A).status === 'billed' && (await allRows(A)).length === 1 && (await allRows(A))[0].includes('Wireframes'));
await shot(A, '02-filter-billed-desktop');
await setFilter(A, 'filter-status', 'unbilled');
check('Status "Unbilled" shows the other 4', queryOf(A).status === 'unbilled' && (await allRows(A)).length === 4 && !(await allRows(A)).some((r) => r.includes('Wireframes')));
await setFilter(A, 'filter-status', 'all');

await setFilter(A, 'filter-client', globex._id);
check('Client filter sends clientId and shows that client\'s entries', queryOf(A).clientId === globex._id && (await allRows(A)).length === 1 && (await allRows(A))[0].includes('Logo options'));
const projectOptions = await A.$$eval('#filter-project option', (o) => o.map((x) => x.innerText.trim()));
check('the Project filter only offers that client\'s projects', JSON.stringify(projectOptions) === JSON.stringify(['All projects', 'Branding']), projectOptions.join(', '));
await setFilter(A, 'filter-client', '');
await setFilter(A, 'filter-project', website._id);
check('Project filter sends projectId and shows only that project', queryOf(A).projectId === website._id && (await allRows(A)).length === 3 && (await allRows(A)).every((r) => r.includes('Website')));
await setFilter(A, 'filter-project', '');

// no match with active filters -> "Clear filters"
await setFilter(A, 'filter-client', globex._id);
await setFilter(A, 'filter-status', 'billed');
check('filters with no match show "No entries match these filters" and a Clear button', (await hasText(A, 'No entries match these filters')) && Boolean(await rowHandleButton(A, 'Clear filters')));
async function rowHandleButton(page, label) {
  return page.evaluateHandle((l) => [...document.querySelectorAll('main button')].find((b) => b.innerText.trim() === l) ?? null, label).then((h) => h.asElement());
}
await clickButton(A, 'Clear filters', 'main');
await settled(A);
await A.waitForFunction(() => document.querySelectorAll('main li').length === 5, { timeout: 5000 }).catch(() => {}); // the list reloads after the click
const clearedQuery = queryOf(A);
const clearedRows = (await allRows(A)).length;
check('Clear filters resets them and keeps the date range', clearedRows === 5 && clearedQuery.status === undefined && clearedQuery.clientId === undefined && clearedQuery.from === '2026-03-08T18:30:00.000Z', `rows=${clearedRows} query=${JSON.stringify(clearedQuery)}`);

// no entries at all in the period -> "No time entries yet"
await setCustomRange(A, '2020-01-01', '2020-01-07');
check('an empty period shows "No time entries yet" with an Add entry button', (await hasText(A, 'No time entries yet')) && Boolean(await rowHandleButton(A, 'Add entry')));
await shot(A, '03-empty-state-desktop');
cards = await summary(A);
check('...and the summary is all zero', cards[0].includes('0s') && cards[2].includes('$0.00'), cards.join(' | '));
await setCustomRange(A, '2026-03-09', '2026-03-13');

// =====================================================================
// 4. Add an entry by hand
// =====================================================================
await clickButton(A, 'Add entry', 'main');
check('"Add entry" opens the modal with today\'s date filled in', (await waitSel(A, '[role=dialog]')) && (await A.$eval('#date', (i) => i.value)) === istDateKey(0), await A.$eval('#date', (i) => i.value));
check('the modal has project, description, date, start, end and a billable switch (on)', (await A.evaluate(() => ['#entry-project', '#description', '#date', '#startTime', '#endTime', '[role=switch]'].every((s) => document.querySelector(`[role=dialog] ${s}`)) && document.querySelector('[role=dialog] [role=switch]').getAttribute('aria-checked') === 'true')));
check('duration starts as "—"', (await A.$eval('[data-testid="entry-duration"]', (e) => e.innerText)).includes('—'));

await clickButton(A, 'Add entry', '[role=dialog]');
check('submitting an empty form shows field errors, and sends nothing', (await hasText(A, 'Pick a project')) && (await hasText(A, 'Enter a start time')) && (await hasText(A, 'Enter an end time')));
check('...the entries list was not touched', (await allRows(A)).length === 5);

await chooseProject(A, '#entry-project', 'Website');
await typeInto(A, '#description', 'Homepage copy');
await setField(A, '#date', '2026-03-12');
await setField(A, '#startTime', '09:00');
await setField(A, '#endTime', '10:30');
check('live duration: 09:00 to 10:30 is "1h 30m"', (await A.$eval('[data-testid="entry-duration"]', (e) => e.innerText)).includes('1h 30m'));

await setField(A, '#endTime', '08:00');
const nextDay = await A.$eval('[data-testid="entry-duration"]', (e) => e.innerText);
check('an end time before the start time means next day: "23h" and "ends next day"', nextDay.includes('23h') && nextDay.includes('ends next day'), nextDay);
await sleep(400); // let the input border colour transition finish before the screenshot
await shot(A, '04-add-entry-ends-next-day-desktop');
await setField(A, '#endTime', '10:30');
check('...and the hint goes away again', !(await A.$eval('[data-testid="entry-duration"]', (e) => e.innerText)).includes('ends next day'));

await clickButton(A, 'Add entry', '[role=dialog]');
check('saving shows a toast, closes the modal and the entry appears in its day', (await hasText(A, 'Entry added')) && (await waitGone(A, '[role=dialog]')));
await settled(A);
groups = await days(A);
check('...under "Thu, 12 Mar 2026" with 1h 30m', groups[0].heading === 'Thu, 12 Mar 2026' && groups[0].total === '1h 30m' && groups[0].rows[0].includes('Homepage copy') && groups[0].rows[0].includes('09:00–10:30'), JSON.stringify(groups[0]));

const saved = (await call('GET', '/entries?from=2026-03-12T00:00:00Z&to=2026-03-13T00:00:00Z', T)).body.entries.find((e) => e.description === 'Homepage copy');
check('server: typed in India time, stored in UTC (09:00 IST = 03:30Z), 5400s, source manual, project\'s client copied', saved && saved.startedAt === '2026-03-12T03:30:00.000Z' && saved.endedAt === '2026-03-12T05:00:00.000Z' && saved.durationSeconds === 5400 && saved.source === 'manual' && saved.clientId === acme._id && saved.billable === true, JSON.stringify(saved && [saved.startedAt, saved.endedAt, saved.durationSeconds, saved.source]));

base = { total: base.total + 5400, billable: base.billable + 5400, unbilled: base.unbilled + 75 };
cards = await summary(A);
check('the summary updated (10h 15m total, 9h 15m billable, $460.00 unbilled)', cards[0].includes('10h 15m') && cards[1].includes('9h 15m') && cards[2].includes('$460.00') && fmtDur(base.total) === '10h 15m' && fmtMoney(base.unbilled) === '$460.00', cards.join(' | '));

// an entry that runs past midnight, added by hand
await clickButton(A, 'Add entry', 'main');
await waitSel(A, '[role=dialog]');
await chooseProject(A, '#entry-project', 'Mobile app');
await setField(A, '#date', '2026-03-13');
await setField(A, '#startTime', '23:00');
await setField(A, '#endTime', '01:00');
await typeInto(A, '#description', 'Release night');
await A.click('[role=dialog] [role=switch]'); // non-billable
check('the Billable switch can be turned off', (await A.$eval('[role=dialog] [role=switch]', (s) => s.getAttribute('aria-checked'))) === 'false');
await clickButton(A, 'Add entry', '[role=dialog]');
await hasText(A, 'Entry added');
await settled(A);
const overnight = (await call('GET', '/entries?from=2026-03-13T00:00:00Z&to=2026-03-14T00:00:00Z', T)).body.entries.find((e) => e.description === 'Release night');
check('server: 23:00 to 01:00 (India time) is stored as 2 hours crossing midnight, non-billable', overnight && overnight.startedAt === '2026-03-13T17:30:00.000Z' && overnight.endedAt === '2026-03-13T19:30:00.000Z' && overnight.durationSeconds === 7200 && overnight.billable === false, JSON.stringify(overnight && [overnight.startedAt, overnight.endedAt, overnight.durationSeconds]));
await hasText(A, 'Release night'); // wait for the list to reload
const releaseRow = (await allRows(A)).find((r) => r.includes('Release night'));
check('...and the list shows "(+1 day)" for it', Boolean(releaseRow) && releaseRow.includes('23:00–01:00 (+1 day)') && releaseRow.includes('Non-billable'), String(releaseRow));
base = { total: base.total + 7200, billable: base.billable, unbilled: base.unbilled };

// server-side rule shown under the field: the end time can't be in the future
await clickButton(A, 'Add entry', 'main');
await waitSel(A, '[role=dialog]');
await chooseProject(A, '#entry-project', 'Website');
await setField(A, '#date', istDateKey(1)); // tomorrow
await setField(A, '#startTime', '09:00');
await setField(A, '#endTime', '10:00');
await clickButton(A, 'Add entry', '[role=dialog]');
const endError = await A.waitForFunction(() => document.getElementById('endTime-error')?.innerText, { timeout: 5000 }).then((h) => h.jsonValue(), () => null);
check('a future end time is rejected by the server and shown under "End time"', endError === "End time can't be in the future", String(endError));
check('...the modal stays open so it can be fixed', await waitSel(A, '[role=dialog]'));
await shot(A, '05-add-entry-server-error-desktop');
await A.keyboard.press('Escape');
await waitGone(A, '[role=dialog]');

// =====================================================================
// 5. Edit
// =====================================================================
let li = (await rowHandle(A, 'Review')).asElement();
await (await li.$('button[aria-label="Edit entry"]')).click();
await waitSel(A, '[role=dialog]');
const prefill = await A.evaluate(() => ({
  project: document.querySelector('#entry-project').innerText,
  description: document.querySelector('#description').value,
  date: document.querySelector('#date').value,
  start: document.querySelector('#startTime').value,
  end: document.querySelector('#endTime').value,
  billable: document.querySelector('[role=dialog] [role=switch]').getAttribute('aria-checked'),
  title: document.querySelector('[role=dialog] h2').innerText,
  duration: document.querySelector('[data-testid="entry-duration"]').innerText,
}));
check('edit modal is filled with the entry', prefill.project.includes('Website') && prefill.description === 'Review' && prefill.date === '2026-03-10' && prefill.start === '10:00' && prefill.end === '10:30' && prefill.billable === 'true' && prefill.title === 'Edit time entry' && prefill.duration.includes('30m'), JSON.stringify(prefill));
await shot(A, '06-edit-entry-desktop');
await setField(A, '#endTime', '11:00');
await typeInto(A, '#description', 'Review and fixes');
await clickButton(A, 'Save changes', '[role=dialog]');
check('saving an edit shows a toast and updates the row', (await hasText(A, 'Entry updated')) && (await hasText(A, 'Review and fixes')));
await settled(A);
const reviewRow = (await allRows(A)).find((r) => r.includes('Review and fixes'));
check('...with the new time and duration (10:00–11:00, 1h)', reviewRow.includes('10:00–11:00') && reviewRow.includes('1h'), reviewRow);
const edited = await eventually(
  async () => (await call('GET', '/entries?from=2026-03-10T00:00:00Z&to=2026-03-11T00:00:00Z', T)).body.entries.find((e) => e.description === 'Review and fixes'),
  (entry) => entry?.durationSeconds === 3600
);
check('server: duration recalculated to 3600s', edited && edited.durationSeconds === 3600 && edited.endedAt === '2026-03-10T05:30:00.000Z', JSON.stringify(edited && [edited.durationSeconds, edited.endedAt]));
base = { total: base.total + 1800, billable: base.billable + 1800, unbilled: base.unbilled + 25 };

// moving an entry to another project updates its client
li = (await rowHandle(A, 'Review and fixes')).asElement();
await (await li.$('button[aria-label="Edit entry"]')).click();
await waitSel(A, '[role=dialog]');
await chooseProject(A, '#entry-project', 'Branding');
await clickButton(A, 'Save changes', '[role=dialog]');
await hasText(A, 'Entry updated');
await settled(A);
const moved = await eventually(
  async () => (await call('GET', '/entries?from=2026-03-10T00:00:00Z&to=2026-03-11T00:00:00Z', T)).body.entries.find((e) => e.description === 'Review and fixes'),
  (entry) => entry?.projectId === branding._id
);
check('changing the project also changes the entry\'s client on the server', moved.projectId === branding._id && moved.clientId === globex._id, JSON.stringify([moved.projectId === branding._id, moved.clientId === globex._id]));

// a timer entry keeps its exact seconds when only the description is edited
const timerEntryId = new ObjectId();
await entriesCollection.insertOne({
  _id: timerEntryId,
  userId: new ObjectId(priya.user._id),
  projectId: new ObjectId(website._id),
  clientId: new ObjectId(acme._id),
  description: 'From the timer',
  billable: true,
  startedAt: new Date('2026-03-12T04:00:07Z'),
  endedAt: new Date('2026-03-12T04:20:41Z'),
  durationSeconds: 1234,
  source: 'timer',
  invoiceId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  __v: 0,
});
await A.reload();
await settled(A);
await setCustomRange(A, '2026-03-09', '2026-03-13');
li = (await rowHandle(A, 'From the timer')).asElement();
await (await li.$('button[aria-label="Edit entry"]')).click();
await waitSel(A, '[role=dialog]');
await typeInto(A, '#description', 'From the timer (checked)');
await clickButton(A, 'Save changes', '[role=dialog]');
await hasText(A, 'Entry updated');
const timerAfter = await entriesCollection.findOne({ _id: timerEntryId });
check('editing only the description of a timer entry leaves its exact start, end and seconds alone', timerAfter.description === 'From the timer (checked)' && timerAfter.durationSeconds === 1234 && timerAfter.startedAt.toISOString() === '2026-03-12T04:00:07.000Z' && timerAfter.endedAt.toISOString() === '2026-03-12T04:20:41.000Z', JSON.stringify([timerAfter.durationSeconds, timerAfter.startedAt, timerAfter.endedAt]));

// =====================================================================
// 6. Delete
// =====================================================================
await settled(A);
li = (await rowHandle(A, 'Internal sync')).asElement();
await (await li.$('button[aria-label="Delete entry"]')).click();
check('delete asks for confirmation', (await hasText(A, 'Delete time entry?')) && (await A.evaluate(() => document.querySelector('[role=dialog]').innerText.includes('Mobile app · 1h'))));
await shot(A, '07-delete-confirm-desktop');
await clickButton(A, 'Cancel', '[role=dialog]');
check('Cancel keeps the entry', (await waitGone(A, '[role=dialog]')) && (await allRows(A)).some((r) => r.includes('Internal sync')));

li = (await rowHandle(A, 'Internal sync')).asElement();
await (await li.$('button[aria-label="Delete entry"]')).click();
await clickButton(A, 'Delete', '[role=dialog]');
check('confirming deletes it, with a toast', (await hasText(A, 'Entry deleted')) && (await gone(A, 'Internal sync')));
check('server: the entry is gone', (await entriesCollection.countDocuments({ description: 'Internal sync' })) === 0);

// the entry gets invoiced in another tab after this list was loaded
li = (await rowHandle(A, 'Night deploy')).asElement();
await entriesCollection.updateOne({ _id: new ObjectId(night._id) }, { $set: { invoiceId: new ObjectId() } });
await (await li.$('button[aria-label="Delete entry"]')).click();
await clickButton(A, 'Delete', '[role=dialog]');
check('deleting an entry that was invoiced in the meantime shows the server\'s 409 message', await hasText(A, "This entry is on an invoice and can't be changed"));
check('...and it is still there', (await entriesCollection.countDocuments({ _id: new ObjectId(night._id) })) === 1);
await settled(A);

// =====================================================================
// 7. Dashboard "Today" can edit entries too
// =====================================================================
await A.goto(BASE + '/');
await A.waitForSelector('section[aria-labelledby="today-heading"] li');
const todayLi = await A.evaluateHandle(() => [...document.querySelectorAll('section[aria-labelledby="today-heading"] li')].find((l) => l.innerText.includes('Standup notes')));
await (await todayLi.asElement().$('button[aria-label="Edit entry"]')).click();
// this modal loads the project list itself, so the form appears a moment after the dialog
check('Dashboard "Today": the pencil opens the same edit modal', (await waitSel(A, '[role=dialog] #description')) && (await A.$eval('#description', (i) => i.value)) === 'Standup notes');
await shot(A, '08-dashboard-edit-desktop');
await typeInto(A, '#description', 'Standup notes (edited)');
await clickButton(A, 'Save changes', '[role=dialog]');
check('...and saving refreshes the Today list', (await hasText(A, 'Standup notes (edited)')) && (await waitGone(A, '[role=dialog]')));
check('server: the description changed, the times did not', (await entriesCollection.findOne({ _id: new ObjectId(standup._id) })).description === 'Standup notes (edited)' && (await entriesCollection.findOne({ _id: new ObjectId(standup._id) })).durationSeconds === 900);

// =====================================================================
// 8. Time zones
// =====================================================================
check('same zone under another name (India: Asia/Kolkata saved, device says Asia/Calcutta): nothing is sent to the server', A.patchMe.length === 0, `PATCH /auth/me calls: ${A.patchMe.length}`);

// a user whose saved zone differs from the device
const nina = await register('Nina');
await call('PATCH', '/auth/me', nina.token, { timezone: 'America/New_York' });
const N = await openDevice('N-device-in-india', nina.token);
await sleep(800);
const ninaAfter = (await call('GET', '/auth/me', nina.token)).body.user;
check('device time zone differs from the saved one: the app saves the device\'s zone, once', N.patchMe.length === 1 && ninaAfter.timezone !== 'America/New_York' && ['Asia/Calcutta', 'Asia/Kolkata'].includes(ninaAfter.timezone), `PATCH calls: ${N.patchMe.length}, now saved: ${ninaAfter.timezone}`);
await N.browserContext().close();

// a device in New York: times typed there are New York times (March 12 is after DST started)
const chris = await register('Chris');
const chrisClient = (await call('POST', '/clients', chris.token, { name: 'NY Client' })).body.client;
await call('POST', '/projects', chris.token, { name: 'NY Project', clientId: chrisClient._id, hourlyRate: 100 });
const C = await openDevice('C-device-in-new-york', chris.token, { timezone: 'America/New_York', path: '/time-entries' });
await sleep(800);
check('a device in New York: the saved zone becomes America/New_York', (await call('GET', '/auth/me', chris.token)).body.user.timezone === 'America/New_York' && C.patchMe.length === 1);
await clickButton(C, 'Add entry', 'main');
await waitSel(C, '[role=dialog]');
await chooseProject(C, '#entry-project', 'NY Project');
await setField(C, '#date', '2026-03-12');
await setField(C, '#startTime', '09:00');
await setField(C, '#endTime', '10:00');
await clickButton(C, 'Add entry', '[role=dialog]');
await hasText(C, 'Entry added');
const nyEntry = (await call('GET', '/entries?from=2026-03-12T00:00:00Z&to=2026-03-13T00:00:00Z', chris.token)).body.entries[0];
check('09:00-10:00 typed in New York is stored as 13:00Z-14:00Z (daylight saving, UTC-4)', nyEntry && nyEntry.startedAt === '2026-03-12T13:00:00.000Z' && nyEntry.endedAt === '2026-03-12T14:00:00.000Z', JSON.stringify(nyEntry && [nyEntry.startedAt, nyEntry.endedAt]));
await C.browserContext().close();

// =====================================================================
// 9. Phone (375px)
// =====================================================================
const M = await openDevice('M-phone', T, { width: 375, height: 667, path: '/time-entries' });
await M.setViewport({ width: 375, height: 667, isMobile: true, hasTouch: true });
await sleep(800); // let the page settle after the viewport change
await M.waitForSelector('[data-testid="summary"]');
check('phone: the filters are collapsed behind a "Filters" button', Boolean(await rowHandleButton(M, 'Filters')) && (await M.$eval('[role=group][aria-label="Filters"]', (g) => getComputedStyle(g).display)) === 'none');
await shot(M, '09-mobile-collapsed-filters');
await clickButton(M, 'Filters', 'main');
check('...tapping it opens the filters', (await M.$eval('[role=group][aria-label="Filters"]', (g) => getComputedStyle(g).display)) !== 'none');
await setCustomRange(M, '2026-03-09', '2026-03-13');
await setFilter(M, 'filter-status', 'unbilled');
check('phone: the Filters button shows how many filters are on', (await M.evaluate(() => [...document.querySelectorAll('main button')].find((b) => b.innerText.includes('Filters')).innerText.replace(/\s+/g, ' ').trim())) === 'Filters 1');
await shot(M, '10-mobile-filters-open');
await clickButton(M, 'Filters', 'main', false); // its text is "Filters 1" now
await shot(M, '11-mobile-list');
check('phone: no horizontal scroll with the list and summary', (await overflow(M)) <= 0, `overflow=${await overflow(M)}`);
const rowsFit = await M.evaluate(() => [...document.querySelectorAll('main li')].every((li) => li.getBoundingClientRect().right <= window.innerWidth + 0.5));
check('phone: every row fits inside the screen', rowsFit);
await clickButton(M, 'Add entry', 'main');
await waitSel(M, '[role=dialog]');
const box = await M.$eval('[role=dialog]', (d) => { const r = d.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
check('phone: the entry modal fits the screen', box.left >= 0 && box.right <= 375 && box.top >= 0 && box.bottom <= 667, JSON.stringify(box));
check('phone: no horizontal scroll with the modal open', (await overflow(M)) <= 0);
await shot(M, '12-mobile-entry-modal');
await M.keyboard.press('Escape');
await M.goto(BASE + '/');
await M.waitForSelector('section[aria-labelledby="today-heading"]');
check('phone: the dashboard Today list has no horizontal scroll', (await overflow(M)) <= 0, `overflow=${await overflow(M)}`);
await M.browserContext().close();

// =====================================================================
check('isolated: no request went to the dev servers on 5000/5173', blocked.length === 0, blocked.join(' | '));
check('no unexpected console/page errors', consoleErrors.length === 0, consoleErrors.join(' | '));

await mongo.close();
await browser.close();
console.log(failures === 0 ? '\nALL STEP 5 BROWSER CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
