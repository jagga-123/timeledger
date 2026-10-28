import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.E2E_BASE || 'http://localhost:5273';
const API = process.env.E2E_API || 'http://localhost:5100/api';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SHOTS = new URL('./shots6/', import.meta.url).pathname.replace(/^\//, '');
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
  (await call('POST', '/auth/register', null, { name, email: `s6-${name.toLowerCase()}-${stamp}@example.com`, password: 'Passw0rd!' })).body;

// ---------- test data ----------
const priya = await register('Priya'); // India (the default time zone)
const T = priya.token;
const acme = (await call('POST', '/clients', T, { name: 'Acme Corp' })).body.client;
const zeta = (await call('POST', '/clients', T, { name: 'Zeta Ltd' })).body.client;
const website = (await call('POST', '/projects', T, { name: 'Website', clientId: acme._id, hourlyRate: 50, color: '#10B981' })).body.project;
const appProject = (await call('POST', '/projects', T, { name: 'App', clientId: acme._id, hourlyRate: 60, color: '#4F46E5' })).body.project;
const brand = (await call('POST', '/projects', T, { name: 'Brand', clientId: zeta._id, hourlyRate: 80, color: '#F59E0B' })).body.project;

const ist = (date, time) => `${date}T${time}:00+05:30`;
const addEntry = async (token, projectId, description, startedAt, endedAt, billable = true) => {
  const res = await call('POST', '/entries', token, { projectId, description, startedAt, endedAt, billable });
  if (res.status !== 201) throw new Error(`seeding failed: ${JSON.stringify(res.body)}`);
  return res.body.entry;
};

// The week of Monday 9 March 2026 (India time):
//   Website: Mon 2h | Tue 23:00 -> Wed 01:00 (1h on each day) | Sat 2h          = 6h
//   App:     Wed 30m | Sun 1h30 (not billable)                                   = 2h
//   Brand:   Fri 1h                                                              = 1h
await addEntry(T, website._id, 'Homepage', ist('2026-03-09', '09:00'), ist('2026-03-09', '11:00'));
await addEntry(T, website._id, 'Late night deploy', ist('2026-03-10', '23:00'), ist('2026-03-11', '01:00'));
await addEntry(T, appProject._id, 'App review', ist('2026-03-11', '10:00'), ist('2026-03-11', '10:30'));
await addEntry(T, brand._id, 'Logo', ist('2026-03-13', '14:00'), ist('2026-03-13', '15:00'));
await addEntry(T, website._id, 'Weekend fixes', ist('2026-03-14', '10:00'), ist('2026-03-14', '12:00'));
await addEntry(T, appProject._id, 'Sunday planning', ist('2026-03-15', '20:00'), ist('2026-03-15', '21:30'), false);
// 15 minutes today (for the current-week views and the dashboard card)
const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();
await addEntry(T, website._id, 'Standup', minutesAgo(20), minutesAgo(5));

// ---------- independent helpers ----------
const IST_OFFSET = 5.5 * 3600 * 1000;
const istWall = (d = new Date()) => new Date(d.getTime() + IST_OFFSET); // UTC fields = India wall clock
const pad = (n) => String(n).padStart(2, '0');
const wall = istWall();
const sinceMonday = (wall.getUTCDay() + 6) % 7;
const mondayOf = (offsetWeeks = 0) => {
  const d = new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() - sinceMonday + offsetWeeks * 7));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const THIS_WEEK = mondayOf(0);
const todayLabel = `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][wall.getUTCDay()]} ${wall.getUTCDate()}`;

// ---------- browser helpers ----------
const browser = await puppeteer.launch({ executablePath: EDGE, headless: true });
const consoleErrors = [];
const blocked = [];

// Safety net: never let a test request reach the developer's own servers (5000 = backend with the real DB, 5173 = dev server)
const guard = async (page, label) => {
  page.timesheetRequests = [];
  page.entryRequests = [];
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const url = r.url();
    if (/localhost:(5000|5173)\b/.test(url)) {
      blocked.push(url);
      r.abort();
      return;
    }
    if (r.method() === 'GET' && /\/api\/timesheet/.test(url)) page.timesheetRequests.push(url);
    if (r.method() === 'GET' && /\/api\/entries\?/.test(url)) page.entryRequests.push(url);
    r.continue();
  });
  page.on('pageerror', (e) => consoleErrors.push(`[${label}] pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/status of (400|401|404|409)/.test(m.text())) consoleErrors.push(`[${label}] ${m.text()}`);
  });
};
const newContext = () => (browser.createBrowserContext ? browser.createBrowserContext() : browser.createIncognitoBrowserContext());

const openDevice = async (label, token, { width = 1280, height = 800, timezone, path = '/', mobile = false } = {}) => {
  const context = await newContext();
  const page = await context.newPage();
  await page.setViewport({ width, height, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
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
const waitSel = (page, sel, timeout = 6000) => page.waitForSelector(sel, { timeout }).then(() => true, () => false);
const waitUrl = (page, predicateSource, timeout = 6000) =>
  page.waitForFunction(`(${predicateSource})()`, { timeout }).then(() => true, () => false);
const shot = (page, name, options = {}) => page.screenshot({ path: SHOTS + name + '.png', ...options });
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const settled = (page) =>
  page.waitForFunction(() => !document.querySelector('[aria-busy="true"]') && !document.querySelector('.animate-spin'), { timeout: 8000 }).catch(() => {});
const search = (page) => page.evaluate(() => location.search);
const weekInUrl = (page) => page.evaluate(() => new URLSearchParams(location.search).get('week'));
const label = (page) => page.$eval('[data-testid="week-label"]', (e) => e.innerText.trim());
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

const grid = (page) =>
  page.$eval('[data-testid="timesheet-grid"]', (table) => ({
    headers: [...table.querySelectorAll('thead th')].map((th) => th.innerText.trim()),
    rows: [...table.querySelectorAll('tbody tr')].map((tr) => ({
      project: tr.querySelector('th p:nth-of-type(1)')?.innerText.trim(),
      client: tr.querySelector('th p:nth-of-type(2)')?.innerText.trim(),
      cells: [...tr.querySelectorAll('td')].map((td) => td.innerText.trim()),
    })),
    footer: [...table.querySelectorAll('tfoot th, tfoot td')].map((c) => c.innerText.trim()),
  }));
const summary = (page) =>
  page.$$eval('[data-testid="summary"] > div', (cards) => cards.map((c) => c.innerText.replace(/\s+/g, ' ').trim().toLowerCase()));
const colorOf = (page, cls, prop = 'backgroundColor') =>
  page.evaluate((c, p) => {
    const probe = document.createElement('div');
    probe.className = c;
    document.body.appendChild(probe);
    const color = getComputedStyle(probe)[p];
    probe.remove();
    return color;
  }, cls, prop);

// =====================================================================
// 1. The page for a known week
// =====================================================================
const A = await openDevice('A-priya', T, { path: '/' });
await A.click('aside a[href="/timesheet"]');
check('"Timesheet" in the sidebar opens the real page (not "Coming soon")', (await waitSel(A, '[data-testid="week-label"]')) && !(await A.evaluate(() => document.body.innerText.includes('Coming soon'))));
await A.goto(BASE + '/timesheet?week=2026-03-09');
await settled(A);
await waitSel(A, '[data-testid="timesheet-grid"]');

check('header: "Timesheet" with a note about the time zone', (await A.$eval('main h1', (h) => h.innerText)) === 'Timesheet' && (await hasText(A, 'Times shown in Asia/Kolkata')));
check('week navigator shows "9 – 15 Mar 2026"', (await label(A)) === '9 – 15 Mar 2026', await label(A));

const g = await grid(A);
// (the "Project" and "Total" headers are small capitals via CSS, so innerText gives them in upper case)
check('columns: Project, Mon 9 ... Sun 15, Total', JSON.stringify(g.headers.map((h) => h.toLowerCase())) === JSON.stringify(['project', 'mon 9', 'tue 10', 'wed 11', 'thu 12', 'fri 13', 'sat 14', 'sun 15', 'total']), g.headers.join(' | '));
check('rows are sorted by client, then project (Acme App, Acme Website, Zeta Brand)', JSON.stringify(g.rows.map((r) => `${r.client}/${r.project}`)) === JSON.stringify(['Acme Corp/App', 'Acme Corp/Website', 'Zeta Ltd/Brand']), g.rows.map((r) => `${r.client}/${r.project}`).join(' | '));
check('App row: 30m on Wed, 1h 30m on Sun, 2h in total', JSON.stringify(g.rows[0].cells) === JSON.stringify(['—', '—', '30m', '—', '—', '—', '1h 30m', '2h']), g.rows[0].cells.join(' | '));
check('Website row: 2h Mon, 1h Tue + 1h Wed (the entry across midnight), 2h Sat, 6h in total', JSON.stringify(g.rows[1].cells) === JSON.stringify(['2h', '1h', '1h', '—', '—', '2h', '—', '6h']), g.rows[1].cells.join(' | '));
check('Brand row: 1h on Fri', JSON.stringify(g.rows[2].cells) === JSON.stringify(['—', '—', '—', '—', '1h', '—', '—', '1h']), g.rows[2].cells.join(' | '));
check('bottom row: daily totals and the week total (9h)', JSON.stringify(g.footer) === JSON.stringify(['Daily total', '2h', '1h', '1h 30m', '—', '1h', '2h', '1h 30m', '9h']), g.footer.join(' | '));

const cards = await summary(A);
check('summary cards: total 9h, billable 7h 30m, billable amount $410.00', cards[0].includes('9h') && cards[1].includes('7h 30m') && cards[2].includes('$410.00'), cards.join(' | '));

const look = await A.evaluate(() => {
  const table = document.querySelector('[data-testid="timesheet-grid"]');
  const websiteRow = [...table.querySelectorAll('tbody tr')].find((tr) => tr.innerText.includes('Website'));
  const dot = websiteRow.querySelector('th span[aria-hidden="true"]');
  const link = websiteRow.querySelector('td a');
  const emptyCell = websiteRow.querySelectorAll('td')[3].querySelector('span');
  const headers = [...table.querySelectorAll('thead th')];
  const cs = (el, p) => getComputedStyle(el)[p];
  return {
    dot: cs(dot, 'backgroundColor'),
    cellFont: cs(link, 'fontFamily'),
    cellColor: cs(link, 'color'),
    emptyColor: cs(emptyCell, 'color'),
    clientIsSmall: parseFloat(cs(websiteRow.querySelector('th p:nth-of-type(2)'), 'fontSize')) < parseFloat(cs(websiteRow.querySelector('th p:nth-of-type(1)'), 'fontSize')),
    weekendHeaderBg: [cs(headers[6], 'backgroundColor'), cs(headers[7], 'backgroundColor')],
    weekdayHeaderBg: cs(headers[1], 'backgroundColor'),
    weekendHeaderColor: cs(headers[6], 'color'),
    weekdayHeaderColor: cs(headers[1], 'color'),
    todayMarked: headers.filter((h) => h.dataset.today === 'true').length,
    cardsHidden: getComputedStyle(document.querySelector('[data-testid="timesheet-days"]')).display === 'none',
  };
});
const slate50 = await colorOf(A, 'bg-slate-50');
check('project cell: color dot, project name, client name below in smaller text', look.dot === 'rgb(16, 185, 129)' && look.clientIsSmall, look.dot);
check('cells use JetBrains Mono, empty cells a light "—"', look.cellFont.includes('JetBrains') && look.emptyColor !== look.cellColor, `${look.cellColor} vs ${look.emptyColor}`);
check('weekend columns (Sat, Sun) are slightly muted', look.weekendHeaderBg.every((c) => c === slate50) && look.weekdayHeaderBg !== slate50 && look.weekendHeaderColor !== look.weekdayHeaderColor, JSON.stringify(look.weekendHeaderBg));
check('no "today" highlight in a past week', look.todayMarked === 0);
check('the day cards are hidden on a wide screen', look.cardsHidden);
await shot(A, '01-timesheet-desktop');

// =====================================================================
// 2. The week in the URL and the navigator
// =====================================================================
await A.click('button[aria-label="Previous week"]');
await waitUrl(A, "() => new URLSearchParams(location.search).get('week') === '2026-03-02'");
await settled(A);
check('Previous: URL becomes ?week=2026-03-02 and the label "2 – 8 Mar 2026"', (await weekInUrl(A)) === '2026-03-02' && (await label(A)) === '2 – 8 Mar 2026', `${await weekInUrl(A)} / ${await label(A)}`);
check('a week without time shows "No time tracked this week" and a "Go to Dashboard" button', (await hasText(A, 'No time tracked this week')) && (await hasText(A, 'Go to Dashboard')));
await shot(A, '02-timesheet-empty-week-desktop');
await A.click('button[aria-label="Next week"]');
await waitUrl(A, "() => new URLSearchParams(location.search).get('week') === '2026-03-09'");
await settled(A);
check('Next: back to 9 – 15 Mar 2026 with its data', (await label(A)) === '9 – 15 Mar 2026' && (await waitSel(A, '[data-testid="timesheet-grid"]')));

await A.reload();
await settled(A);
check('a refresh keeps the week from the URL', (await weekInUrl(A)) === '2026-03-09' && (await label(A)) === '9 – 15 Mar 2026' && (await waitSel(A, '[data-testid="timesheet-grid"]')));

const beforeCount = A.timesheetRequests.length;
await clickButton(A, 'This week');
await waitUrl(A, `() => new URLSearchParams(location.search).get('week') === '${THIS_WEEK}'`);
await settled(A);
check('"This week" jumps to the current week (Monday in India time)', (await weekInUrl(A)) === THIS_WEEK && A.timesheetRequests.length > beforeCount, `${await weekInUrl(A)} (expected ${THIS_WEEK})`);
const nav = await A.evaluate(() => ({
  nextDisabled: document.querySelector('button[aria-label="Next week"]').disabled,
  thisWeekDisabled: [...document.querySelectorAll('main button')].find((b) => b.innerText.trim() === 'This week').disabled,
  prevDisabled: document.querySelector('button[aria-label="Previous week"]').disabled,
}));
check('on the current week "Next" and "This week" are disabled, "Previous" is not', nav.nextDisabled && nav.thisWeekDisabled && !nav.prevDisabled, JSON.stringify(nav));

// today's column
const todayInfo = await A.evaluate(() => {
  const table = document.querySelector('[data-testid="timesheet-grid"]');
  const headers = [...table.querySelectorAll('thead th')];
  const marked = headers.filter((h) => h.dataset.today === 'true');
  const index = headers.indexOf(marked[0]);
  const websiteRow = [...table.querySelectorAll('tbody tr')].find((tr) => tr.innerText.includes('Website'));
  return {
    count: marked.length,
    text: marked[0]?.innerText.trim(),
    headerBg: marked[0] && getComputedStyle(marked[0]).backgroundColor,
    cellBg: getComputedStyle(websiteRow.querySelectorAll('td')[index - 1]).backgroundColor,
    cellText: websiteRow.querySelectorAll('td')[index - 1].innerText.trim(),
    otherCellBg: getComputedStyle(websiteRow.querySelectorAll('td')[index === 1 ? 1 : 0]).backgroundColor,
  };
});
const indigo50 = await colorOf(A, 'bg-indigo-50');
check('today\'s column is highlighted in light indigo (header and cells)', todayInfo.count === 1 && todayInfo.text === todayLabel && todayInfo.headerBg === indigo50 && todayInfo.cellBg === indigo50, JSON.stringify(todayInfo));
check('...and today\'s 15 minutes show in it', todayInfo.cellText === '15m', todayInfo.cellText);
await shot(A, '03-timesheet-current-week-desktop');

// bad links fall back to the current week and the URL is repaired
for (const [bad, why] of [['2026-03-10', 'not a Monday'], ['2099-01-05', 'in the future'], ['banana', 'not a date']]) {
  await A.goto(BASE + `/timesheet?week=${bad}`);
  await waitUrl(A, `() => new URLSearchParams(location.search).get('week') === '${THIS_WEEK}'`);
  await settled(A);
  check(`a link with ?week=${bad} (${why}) shows the current week and fixes the URL`, (await weekInUrl(A)) === THIS_WEEK, await weekInUrl(A));
}

// =====================================================================
// 3. Clicking a cell opens Time entries for that project and day
// =====================================================================
await A.goto(BASE + '/timesheet?week=2026-03-09');
await settled(A);
await waitSel(A, '[data-testid="timesheet-grid"]');
const clickCell = async (project, dayIndex) => {
  const handle = await A.evaluateHandle((p, i) => {
    const row = [...document.querySelectorAll('[data-testid="timesheet-grid"] tbody tr')].find((tr) => tr.querySelector('th p')?.innerText.trim() === p);
    return row.querySelectorAll('td')[i].querySelector('a');
  }, project, dayIndex);
  await handle.asElement().click();
};

await clickCell('Website', 0); // Monday, 2h
await A.waitForFunction(() => location.pathname === '/time-entries');
await settled(A);
const q1 = await search(A);
check('clicking a cell opens /time-entries with the project and the day in the URL', q1 === `?projectId=${website._id}&from=2026-03-09&to=2026-03-09&overlap=1`, q1);
await A.waitForFunction(() => document.querySelectorAll('#filter-project option').length > 1, { timeout: 6000 }); // the project list loads separately
const filters1 = await A.evaluate(() => ({
  preset: document.querySelector('#filter-preset').value,
  from: document.querySelector('#filter-from')?.value,
  to: document.querySelector('#filter-to')?.value,
  project: document.querySelector('#filter-project').selectedOptions[0]?.innerText,
}));
check('Time entries starts with those filters already set (Custom range, that day, that project)', filters1.preset === 'custom' && filters1.from === '2026-03-09' && filters1.to === '2026-03-09' && filters1.project === 'Website', JSON.stringify(filters1));
const query1 = Object.fromEntries(new URL(A.entryRequests.at(-1)).searchParams);
check('...and asks for that day in India time, for that project', query1.from === '2026-03-08T18:30:00.000Z' && query1.to === '2026-03-09T18:30:00.000Z' && query1.projectId === website._id, JSON.stringify(query1));
const rows1 = await A.$$eval('main li', (lis) => lis.map((li) => li.innerText.replace(/\s+/g, ' ').trim()));
check('the list shows exactly that entry (Homepage, 09:00–11:00, 2h)', rows1.length === 1 && rows1[0].includes('Homepage') && rows1[0].includes('09:00–11:00') && rows1[0].includes('2h'), rows1.join(' | '));

// the entry across midnight appears under BOTH of its days
for (const [dayIndex, day] of [[1, 'Tuesday'], [2, 'Wednesday']]) {
  await A.goto(BASE + '/timesheet?week=2026-03-09');
  await waitSel(A, '[data-testid="timesheet-grid"]');
  await clickCell('Website', dayIndex);
  await A.waitForFunction(() => location.pathname === '/time-entries');
  await settled(A);
  const rows = await A.$$eval('main li', (lis) => lis.map((li) => li.innerText.replace(/\s+/g, ' ').trim()));
  check(`${day}'s cell (1h): the list shows the entry that crosses midnight (23:00–01:00)`, rows.length === 1 && rows[0].includes('Late night deploy') && rows[0].includes('23:00–01:00 (+1 day)'), rows.join(' | '));
  if (dayIndex === 2) await shot(A, '04-cell-click-time-entries-desktop');
}

// choosing another date range there goes back to matching by start day
const before = A.entryRequests.length;
await A.select('#filter-preset', 'this-month');
for (let i = 0; i < 60 && A.entryRequests.length === before; i++) await sleep(50);
check('changing the date range on that page drops the "overlap" matching', !new URL(A.entryRequests.at(-1)).searchParams.has('overlap'));

// malformed filter links are ignored
await A.goto(BASE + '/time-entries?projectId=abc&from=zzz&status=weird&overlap=1');
await settled(A);
const ignored = await A.evaluate(() => ({ preset: document.querySelector('#filter-preset').value, project: document.querySelector('#filter-project').value, status: document.querySelector('#filter-status').value }));
check('Time entries ignores malformed filter parameters in the URL', ignored.preset === 'this-week' && ignored.project === '' && ignored.status === 'all', JSON.stringify(ignored));

// =====================================================================
// 4. Dashboard "This week" card
// =====================================================================
await A.goto(BASE + '/');
await A.waitForSelector('[data-testid="week-total"]');
await A.waitForFunction(() => document.querySelector('[data-testid="week-total"]').innerText.trim() !== '—', { timeout: 6000 }).catch(() => {});
const weekCard = await A.evaluate(() => {
  const section = document.querySelector('section[aria-labelledby="week-heading"]');
  const today = document.querySelector('section[aria-labelledby="today-heading"]');
  return {
    title: section.querySelector('h2').innerText.trim(),
    total: section.querySelector('[data-testid="week-total"]').innerText.trim(),
    link: section.querySelector('a')?.innerText.trim(),
    href: section.querySelector('a')?.getAttribute('href'),
    side: section.getBoundingClientRect().left > today.getBoundingClientRect().left,
    sameRow: Math.abs(section.getBoundingClientRect().top - today.getBoundingClientRect().top) < 40,
  };
});
check('Dashboard: a "This week" card with the week\'s total hours (15m) and a "View timesheet" link', weekCard.title === 'This week' && weekCard.total === '15m' && weekCard.link === 'View timesheet' && weekCard.href === '/timesheet', JSON.stringify(weekCard));
check('...placed next to the Today list on a wide screen', weekCard.side && weekCard.sameRow, JSON.stringify([weekCard.side, weekCard.sameRow]));
await shot(A, '05-dashboard-this-week-card-desktop');
await A.click('section[aria-labelledby="week-heading"] a');
check('"View timesheet" opens the timesheet', await waitUrl(A, "() => location.pathname === '/timesheet'"));

// =====================================================================
// 5. Empty week and "Go to Dashboard"
// =====================================================================
await A.goto(BASE + '/timesheet?week=2020-01-06');
await settled(A);
check('an empty week hides the grid and the summary cards', (await hasText(A, 'No time tracked this week')) && !(await A.$('[data-testid="timesheet-grid"]')) && !(await A.$('[data-testid="summary"]')));
await clickButton(A, 'Go to Dashboard');
check('"Go to Dashboard" opens the dashboard', await waitUrl(A, "() => location.pathname === '/'"));

// =====================================================================
// 6. Days are counted in the user's time zone (a device in New York, daylight saving week)
// =====================================================================
const nick = await register('Nick');
const nickClient = (await call('POST', '/clients', nick.token, { name: 'NY Client' })).body.client;
const nickProject = (await call('POST', '/projects', nick.token, { name: 'NY Project', clientId: nickClient._id, hourlyRate: 100, color: '#8B5CF6' })).body.project;
// 24 hours from Sunday 8 March 00:00 EST to Monday 9 March 00:00 EDT + 1h. Clocks jump forward that night, so Sunday has only 23 hours.
await addEntry(nick.token, nickProject._id, 'Long Sunday', '2026-03-08T05:00:00Z', '2026-03-09T05:00:00Z');

const N = await openDevice('N-new-york', nick.token, { timezone: 'America/New_York', path: '/timesheet?week=2026-03-02' });
await waitUrl(N, "() => document.body.innerText.includes('Times shown in America/New_York')");
await settled(N);
await N.waitForFunction(() => document.querySelector('[data-testid="timesheet-grid"]'), { timeout: 8000 }).catch(() => {});
const ny = await grid(N);
check('a device in New York: the page shows "Times shown in America/New_York"', await hasText(N, 'Times shown in America/New_York'));
check('the DST week (2 – 8 Mar 2026): Sunday 8 March has 23 hours, not 24', ny.rows.length === 1 && ny.rows[0].cells[6] === '23h' && ny.rows[0].cells[7] === '23h' && (await label(N)) === '2 – 8 Mar 2026', JSON.stringify(ny.rows[0]?.cells));
await shot(N, '06-timesheet-dst-week-new-york-desktop');
await N.click('button[aria-label="Next week"]');
await waitUrl(N, "() => new URLSearchParams(location.search).get('week') === '2026-03-09'");
await settled(N);
const ny2 = await grid(N);
check('...and the 24th hour is Monday 00:00-01:00 in the next week', ny2.rows[0].cells[0] === '1h' && ny2.rows[0].cells[7] === '1h', JSON.stringify(ny2.rows[0]?.cells));
await N.browserContext().close();

// =====================================================================
// 7. Phone and tablet layouts
// =====================================================================
const M = await openDevice('M-phone', T, { width: 375, height: 667, mobile: true, path: '/timesheet?week=2026-03-09' });
await waitSel(M, '[data-testid="timesheet-days"]');
await sleep(500);
const phone = await M.evaluate(() => {
  const days = [...document.querySelectorAll('[data-testid="timesheet-days"] > li')];
  const text = (i) => days[i].innerText.replace(/\s+/g, ' ').trim();
  const nav = document.querySelector('[data-testid="week-label"]').closest('div').parentElement.getBoundingClientRect();
  return {
    tableHidden: getComputedStyle(document.querySelector('[data-testid="timesheet-grid"]').parentElement).display === 'none',
    count: days.length,
    mon: text(0), wed: text(2), thu: text(3), sat: text(5), sun: text(6),
    navRight: nav.right,
    cardsRight: Math.max(...days.map((d) => d.getBoundingClientRect().right)),
  };
});
check('phone: no wide table, one card per day (7)', phone.tableHidden && phone.count === 7);
check('phone: Wednesday card shows its total and the projects with their hours', phone.wed.includes('Wed 11') && phone.wed.includes('1h 30m') && phone.wed.includes('Website') && phone.wed.includes('1h') && phone.wed.includes('App') && phone.wed.includes('30m'), phone.wed);
check('phone: a day without time says "No time tracked"', phone.thu.includes('Thu 12') && phone.thu.includes('No time tracked'), phone.thu);
check('phone: the entry across midnight shows on both Tuesday and Wednesday', (await M.evaluate(() => document.querySelectorAll('[data-testid="timesheet-days"] > li')[1].innerText.includes('Website'))) && phone.wed.includes('Website'));
check('phone: no horizontal scroll, the navigator and cards fit in 375px', (await overflow(M)) <= 0 && phone.navRight <= 375 && phone.cardsRight <= 375, `overflow=${await overflow(M)} navRight=${phone.navRight}`);
await shot(M, '07-timesheet-mobile-top');
await shot(M, '08-timesheet-mobile-full', { fullPage: true });
const cardsM = await summary(M);
check('phone: the summary cards are there (9h, 7h 30m, $410.00)', cardsM[0].includes('9h') && cardsM[1].includes('7h 30m') && cardsM[2].includes('$410.00'), cardsM.join(' | '));
const mobileLink = await M.evaluateHandle(() => [...document.querySelectorAll('[data-testid="timesheet-days"] > li')][2].querySelector('a'));
await mobileLink.asElement().click();
check('phone: tapping a project in a day card also opens Time entries for that day', await waitUrl(M, "() => location.pathname === '/time-entries' && location.search.includes('from=2026-03-11')"));
await M.goto(BASE + '/');
await M.waitForSelector('[data-testid="week-total"]');
check('phone: the dashboard "This week" card shows and nothing scrolls sideways', (await overflow(M)) <= 0 && (await M.$eval('section[aria-labelledby="week-heading"]', (s) => s.getBoundingClientRect().right <= 375)));
await M.browserContext().close();

// tablet (the sidebar leaves only ~450px for content): cards, not a cramped table
const Tab = await openDevice('Tablet', T, { width: 768, height: 900, path: '/timesheet?week=2026-03-09' });
await waitSel(Tab, '[data-testid="timesheet-days"]');
check('tablet (768px): day cards, no sideways scroll', (await Tab.$eval('[data-testid="timesheet-days"]', (e) => getComputedStyle(e).display !== 'none')) && (await overflow(Tab)) <= 0);
await shot(Tab, '09-timesheet-tablet');
await Tab.setViewport({ width: 1024, height: 800 });
await sleep(400);
const small = await Tab.evaluate(() => {
  const table = document.querySelector('[data-testid="timesheet-grid"]');
  const wrapper = table.parentElement;
  return { visible: getComputedStyle(wrapper).display !== 'none', fits: table.getBoundingClientRect().right <= window.innerWidth && table.scrollWidth <= wrapper.clientWidth + 1 };
});
check('small laptop (1024px): the grid shows and fits without sideways scroll', small.visible && small.fits && (await overflow(Tab)) <= 0, JSON.stringify(small));
await Tab.browserContext().close();

// =====================================================================
check('isolated: no request went to the dev servers on 5000/5173', blocked.length === 0, blocked.join(' | '));
check('no unexpected console/page errors', consoleErrors.length === 0, consoleErrors.join(' | '));

await browser.close();
console.log(failures === 0 ? '\nALL STEP 6 BROWSER CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
