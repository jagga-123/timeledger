import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.E2E_BASE || 'http://localhost:5273';
const API = process.env.E2E_API || 'http://localhost:5100/api';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SHOTS = new URL('./shots4/', import.meta.url).pathname.replace(/^\//, '');
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const check = (name, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- API helpers (used to set up data and to play "another device") ----------
const call = async (method, path, token, body) => {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const stamp = Date.now();
const register = async (name) => (await call('POST', '/auth/register', null, { name, email: `s4-${name.toLowerCase()}-${stamp}@example.com`, password: 'Passw0rd!' })).body;

const priya = await register('Priya');
const T = priya.token;
const acme = (await call('POST', '/clients', T, { name: 'Acme Corp' })).body.client;
const globex = (await call('POST', '/clients', T, { name: 'Globex' })).body.client;
const website = (await call('POST', '/projects', T, { name: 'Website redesign', clientId: acme._id, hourlyRate: 45, color: '#10B981' })).body.project;
const mobileApp = (await call('POST', '/projects', T, { name: 'Mobile app', clientId: acme._id, hourlyRate: 60 })).body.project;
const branding = (await call('POST', '/projects', T, { name: 'Branding', clientId: globex._id, hourlyRate: 80, color: '#F59E0B' })).body.project;

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

// A page in its own browser context (own localStorage, like another device), logged in with `token`
const openDevice = async (label, token, { skewMs = 0, width = 1280, height = 800 } = {}) => {
  const context = await newContext();
  const page = await context.newPage();
  await page.setViewport({ width, height });
  await guard(page, label);
  if (skewMs) {
    // Make this device's clock wrong by skewMs
    await page.evaluateOnNewDocument(`(() => {
      const D = Date, skew = ${skewMs};
      class SkewedDate extends D {
        constructor(...a) { if (a.length === 0) super(D.now() + skew); else super(...a); }
        static now() { return D.now() + skew; }
      }
      window.Date = SkewedDate;
    })();`);
  }
  await page.goto(BASE + '/login');
  await page.evaluate((t) => localStorage.setItem('token', t), token);
  await page.goto(BASE + '/');
  await page.waitForFunction(() => document.body.innerText.includes('Welcome,'), { timeout: 10000 });
  return page;
};

const hasText = (page, t, timeout = 6000) =>
  page.waitForFunction((s) => document.body.innerText.includes(s), { timeout }, t).then(() => true, () => false);
const waitSel = (page, sel, timeout = 6000) => page.waitForSelector(sel, { timeout }).then(() => true, () => false);
const waitGone = (page, sel, timeout = 6000) => page.waitForSelector(sel, { hidden: true, timeout }).then(() => true, () => false);
const waitPath = (page, p, timeout = 6000) =>
  page.waitForFunction((s) => location.pathname === s, { timeout }, p).then(() => true, () => false);
const shot = (page, name) => page.screenshot({ path: SHOTS + name + '.png' });
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const clickButton = async (page, label, within = 'body') => {
  const handle = await page.evaluateHandle(
    (label, within) =>
      [...document.querySelectorAll(`${within} button`)].find((b) => b.innerText.trim() === label && b.offsetParent !== null),
    label,
    within
  );
  const el = handle.asElement();
  if (!el) throw new Error(`No button "${label}" in ${within}`);
  await el.click();
};

// replace the text in an input (select all + type); puppeteer's clickCount no longer selects text
const replaceText = async (page, selector, text) => {
  await page.focus(selector);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  if (text) await page.type(selector, text);
};

const RUNNING = 'section[aria-label="Running timer"]';
const toSeconds = (t) => t.split(':').reduce((acc, n) => acc * 60 + Number(n), 0);
const elapsedOf = async (page) => toSeconds(await page.$eval(`${RUNNING} [data-testid="elapsed"]`, (e) => e.innerText));
const visibleMini = (page) =>
  page.evaluateHandle(() => [...document.querySelectorAll('[data-testid="mini-timer"]')].find((e) => e.offsetParent !== null) ?? null);
const apiTimer = async (token = T) => (await call('GET', '/timer', token)).body.timer;

// =====================================================================
// 1. Idle state
// =====================================================================
const A = await openDevice('A', T);
await waitSel(A, 'form#timer-form, form'); // idle card
check('idle: card asks "What are you working on?"', await hasText(A, 'What are you working on?'));
check('idle: description input is there', Boolean(await A.$('#timer-description')));
check('idle: Billable switch is on by default', (await A.$eval('[role=switch]', (s) => s.getAttribute('aria-checked'))) === 'true');
const startBtn = await A.$eval('form button[type=submit]', (b) => ({ text: b.innerText.trim(), size: parseFloat(getComputedStyle(b).fontSize), bg: getComputedStyle(b).backgroundColor }));
check('idle: big primary "Start" button', startBtn.text === 'Start' && startBtn.size >= 16, JSON.stringify(startBtn));
check('idle: tab title is plain "TimeLedger"', (await A.title()) === 'TimeLedger');
check('idle: no mini timer in the sidebar', (await (await visibleMini(A)).asElement()) === null);
check('idle: nothing running on the server', (await apiTimer()) === null);
await shot(A, '01-idle-desktop');

// Start without choosing a project
await A.click('form button[type=submit]');
check('start without a project shows an inline error', await hasText(A, 'Pick a project to track time on'));
check('...and does not start anything', (await apiTimer()) === null);

// Project dropdown: grouped by client, with color dots
await A.click('#projectId');
check('dropdown opens as a listbox', await waitSel(A, '[role=listbox]'));
const dropdown = await A.evaluate(() => {
  const list = document.querySelector('[role=listbox]');
  return {
    headings: [...list.querySelectorAll('li[role=presentation] > div')].map((d) => d.textContent.trim()),
    options: [...list.querySelectorAll('[role=option]')].map((o) => ({
      name: o.innerText.trim(),
      dot: getComputedStyle(o.querySelector('span')).backgroundColor,
    })),
  };
});
check('dropdown is grouped by client (alphabetical)', JSON.stringify(dropdown.headings) === JSON.stringify(['Acme Corp', 'Globex']), dropdown.headings.join(', '));
check('dropdown lists every project with its color dot',
  JSON.stringify(dropdown.options) === JSON.stringify([
    { name: 'Mobile app', dot: 'rgb(79, 70, 229)' },
    { name: 'Website redesign', dot: 'rgb(16, 185, 129)' },
    { name: 'Branding', dot: 'rgb(245, 158, 11)' },
  ]), JSON.stringify(dropdown.options));
await shot(A, '02-project-dropdown-desktop');

// keyboard: arrow down + Enter picks the highlighted project
await A.keyboard.press('ArrowDown');
await A.keyboard.press('Enter');
check('keyboard: ArrowDown + Enter selects a project and closes the list',
  (await waitGone(A, '[role=listbox]')) && (await A.$eval('#projectId', (b) => b.innerText)).includes('Website redesign'));
await A.type('#timer-description', 'Homepage hero section');

// Start the timer
const t0 = Date.now();
await A.click('form button[type=submit]');
check('Start switches the card to the running state', await waitSel(A, RUNNING));
const t1 = Date.now();
await A.mouse.move(5, 5); // keep the pointer off the buttons so no hover colors get measured
await sleep(500); // ...and let any hover transition finish

// =====================================================================
// 2. Running state
// =====================================================================
const running = await A.evaluate((sel) => {
  const card = document.querySelector(sel);
  // read the real colors of the Tailwind classes (the browser reports them as oklch/oklab, not rgb)
  const colorOf = (cls) => {
    const probe = document.createElement('div');
    probe.className = cls;
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  };
  const primary = colorOf('bg-primary');
  const white = colorOf('bg-white');
  const stop = [...card.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Stop');
  const elapsedEl = card.querySelector('[data-testid="elapsed"]');
  return {
    cardBg: getComputedStyle(card).backgroundColor,
    primary,
    white,
    label: card.querySelector('p').innerText.replace(/\s+/g, ' ').trim(),
    elapsed: elapsedEl.innerText,
    elapsedFont: getComputedStyle(elapsedEl).fontFamily,
    elapsedSize: parseFloat(getComputedStyle(elapsedEl).fontSize),
    stopBg: stop ? getComputedStyle(stop).backgroundColor : null,
    description: card.querySelector('input').value,
  };
}, RUNNING);
check('running: card is bg-primary (indigo-600)', running.cardBg === running.primary, running.cardBg);
check('running: shows "Running · Client / Project"', running.label === 'Running · Acme Corp / Website redesign', running.label);
check('running: big HH:MM:SS clock in JetBrains Mono', /^\d\d:\d\d:\d\d$/.test(running.elapsed) && running.elapsedFont.includes('JetBrains') && running.elapsedSize >= 48, `${running.elapsed} ${running.elapsedSize}px`);
check('running: description is editable and holds what I typed', running.description === 'Homepage hero section');
check('running: white Stop button', running.stopBg === running.white, running.stopBg);
check('running: clock starts at (almost) zero', toSeconds(running.elapsed) <= 2, running.elapsed);

const title1 = await A.title();
check('running: tab title is "HH:MM:SS · TimeLedger"', /^\d\d:\d\d:\d\d · TimeLedger$/.test(title1), title1);
await shot(A, '03-running-desktop');

// the server owns the start time, and it is "now" on the server
const serverTimer = await apiTimer();
const serverStartedAt = Date.parse(serverTimer.startedAt);
check('server: timer exists with the server-side start time (between click and response)', serverStartedAt >= t0 - 50 && serverStartedAt <= t1 + 50, `${serverStartedAt - t0}ms after the click`);
check('server: description and project saved', serverTimer.description === 'Homepage hero section' && serverTimer.projectId === website._id && serverTimer.clientId === acme._id);

// the clock keeps ticking, derived from startedAt
await A.bringToFront();
const e1 = await elapsedOf(A);
await sleep(2300);
const e2 = await elapsedOf(A);
check('clock ticks every second', e2 >= e1 + 2 && e2 <= e1 + 3, `${e1}s -> ${e2}s`);

// mini timer in the sidebar
const mini = await A.evaluate(() => {
  const el = [...document.querySelectorAll('[data-testid="mini-timer"]')].find((e) => e.offsetParent !== null);
  return el
    ? {
        inSidebar: Boolean(el.closest('aside')),
        time: el.innerText.trim(),
        pulsing: Boolean(el.querySelector('.animate-ping')),
        stopButton: Boolean(el.querySelector('button[aria-label="Stop timer"]')),
        linkTo: el.querySelector('a')?.getAttribute('href'),
      }
    : null;
}, RUNNING);
check('mini timer in the sidebar: pulsing dot + time + stop icon', mini && mini.inSidebar && mini.pulsing && mini.stopButton && /^\d\d:\d\d:\d\d$/.test(mini.time), JSON.stringify(mini));

// ...on every page
await A.click('aside a[href="/clients"]');
await waitPath(A, '/clients');
const miniOnClients = await (await visibleMini(A)).asElement();
check('mini timer stays visible on other pages', Boolean(miniOnClients));
check('tab title keeps showing the time on other pages', /^\d\d:\d\d:\d\d · TimeLedger$/.test(await A.title()));
await shot(A, '04-mini-timer-on-clients-desktop');
await (await visibleMini(A)).asElement().$eval('a', (a) => a.click());
check('clicking the mini timer goes to the dashboard', await waitPath(A, '/'));
check('...and the running card shows straight away', await waitSel(A, RUNNING, 1500));

// =====================================================================
// 3. Edit the description while running
// =====================================================================
await replaceText(A, `${RUNNING} input`, 'Hero section v2');
await A.keyboard.press('Enter');
await sleep(600);
check('description saved to the server (Enter)', (await apiTimer()).description === 'Hero section v2');

await replaceText(A, `${RUNNING} input`, 'throwaway text');
await A.keyboard.press('Escape');
await sleep(400);
check('Escape reverts the edit and saves nothing', (await A.$eval(`${RUNNING} input`, (i) => i.value)) === 'Hero section v2' && (await apiTimer()).description === 'Hero section v2');

// =====================================================================
// 4. Refresh, reopen, other devices, wrong device clocks
// =====================================================================
const beforeReload = await elapsedOf(A);
await A.reload();
check('after a page refresh the timer is still running', await waitSel(A, RUNNING));
const afterReload = await elapsedOf(A);
check('...and the clock did not reset (it continues from the server start time)', afterReload >= beforeReload && afterReload <= beforeReload + 5, `${beforeReload}s -> ${afterReload}s`);
check('...description survived too', (await A.$eval(`${RUNNING} input`, (i) => i.value)) === 'Hero section v2');

// "close the browser and open it again" = a brand-new browser context, logged in with the saved token
const B = await openDevice('B', T);
check('a freshly opened browser shows the same running timer', await waitSel(B, RUNNING));
const [ea, eb] = [await elapsedOf(A), await elapsedOf(B)];
check('...with the same elapsed time (within 2s)', Math.abs(ea - eb) <= 2, `A=${ea}s B=${eb}s`);
check('...and the title shows the time there too', /^\d\d:\d\d:\d\d · TimeLedger$/.test(await B.title()));

// devices whose own clocks are wrong must still show the right time
const C = await openDevice('C-clock+10min', T, { skewMs: 10 * 60 * 1000 });
await waitSel(C, RUNNING);
const D = await openDevice('D-clock-2h', T, { skewMs: -2 * 60 * 60 * 1000 });
await waitSel(D, RUNNING);
const [ea2, ec, ed] = [await elapsedOf(A), await elapsedOf(C), await elapsedOf(D)];
check('device clock 10 minutes AHEAD still shows the correct elapsed time', Math.abs(ea2 - ec) <= 3, `A=${ea2}s C=${ec}s`);
check('device clock 2 hours BEHIND still shows the correct elapsed time', Math.abs(ea2 - ed) <= 3, `A=${ea2}s D=${ed}s`);
await C.browserContext().close();
await D.browserContext().close();
await B.browserContext().close();

// =====================================================================
// 5. Stop from the card, and the "Today" list
// =====================================================================
await A.bringToFront();
const elapsedAtStop = await elapsedOf(A);
await clickButton(A, 'Stop', RUNNING);
check('Stop shows a toast with the logged time', await hasText(A, 'Timer stopped · 00:'));
check('...the card goes back to the start form', await waitSel(A, '#timer-description'));
check('...the tab title goes back to "TimeLedger"', (await A.title()) === 'TimeLedger');
check('...the mini timer disappears', (await (await visibleMini(A)).asElement()) === null);
check('...the server has no running timer', (await apiTimer()) === null);

const today1 = await A.evaluate(() => [...document.querySelectorAll('#today-heading ~ ul li, section[aria-labelledby="today-heading"] li')].map((li) => li.innerText.replace(/\s+/g, ' ').trim()));
check('"Today" lists the stopped entry with project, client, description and duration', today1.length === 1 && today1[0].includes('Website redesign') && today1[0].includes('Acme Corp') && today1[0].includes('Hero section v2') && /\d\d:\d\d:\d\d/.test(today1[0]), today1[0]);
const listedSeconds = toSeconds(today1[0].match(/\d\d:\d\d:\d\d/)[0]);
check('...and its duration matches what the clock showed (within 2s)', Math.abs(listedSeconds - elapsedAtStop) <= 2, `clock=${elapsedAtStop}s list=${listedSeconds}s`);
check('...Today shows a total', await hasText(A, 'Total 00:'));
await shot(A, '05-after-stop-today-desktop');

// the entry is saved properly on the server
const entries = (await call('GET', `/entries?from=${new Date(Date.now() - 86400000).toISOString()}&to=${new Date(Date.now() + 86400000).toISOString()}`, T)).body.entries;
check('server: stopped entry has endedAt and durationSeconds', entries.length === 1 && entries[0].endedAt && entries[0].durationSeconds === listedSeconds, `${entries[0]?.durationSeconds}s`);

// =====================================================================
// 6. A second device tries to start while a timer is already running
// =====================================================================
const E = await openDevice('E-stale-tab', T); // loaded while idle, so it doesn't know what happens next
check('E: second tab loads idle', await waitSel(E, '#timer-description'));

const started = await call('POST', '/timer/start', T, { projectId: mobileApp._id, description: 'Started on my phone' }); // the "other device"
check('another device starts a timer (API)', started.status === 201);

// E still shows the idle form: pick a project and press Start
await E.click('#projectId');
await E.keyboard.press('Enter'); // first option: Mobile app
await E.click('form button[type=submit]');
check('starting a second timer shows the 409 message as is', await hasText(E, 'A timer is already running. Stop it first.'));
await shot(E, '06-second-timer-409-desktop');
check('...and E now shows the timer that is running elsewhere', await waitSel(E, RUNNING));
check('...with the other device\'s description', (await E.$eval(`${RUNNING} input`, (i) => i.value)) === 'Started on my phone');
check('server still has exactly one running timer', (await apiTimer()).description === 'Started on my phone');

// the first tab learns about it when it becomes visible again
await A.bringToFront();
await A.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
check('tab A shows the timer started elsewhere after becoming visible', await waitSel(A, RUNNING));
check('...with the same time as E (within 2s)', Math.abs((await elapsedOf(A)) - (await elapsedOf(E))) <= 2);

// stopping on E shows up on A, and Today reloads
await E.bringToFront();
await clickButton(E, 'Stop', RUNNING);
await hasText(E, 'Timer stopped');
await A.bringToFront();
await A.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
check('tab A goes idle after the timer is stopped elsewhere', await waitSel(A, '#timer-description'));
check('...and "Today" now has both entries', await A.waitForFunction(() => document.querySelectorAll('section[aria-labelledby="today-heading"] li').length === 2, { timeout: 6000 }).then(() => true, () => false));
await E.browserContext().close();

// =====================================================================
// 7. Syncing without any interaction (every 30 seconds)
// =====================================================================
await A.bringToFront();
const startedAtPoll = Date.now();
await call('POST', '/timer/start', T, { projectId: branding._id, description: 'Polled in' });
const polled = await A.waitForSelector(RUNNING, { timeout: 40000 }).then(() => true, () => false);
const waitedSeconds = Math.round((Date.now() - startedAtPoll) / 1000);
check('a timer started elsewhere appears on its own within ~30 seconds (no click, no refresh)', polled && waitedSeconds <= 35, `${waitedSeconds}s`);

// stop with the small stop icon in the sidebar
await (await visibleMini(A)).asElement().$eval('button[aria-label="Stop timer"]', (b) => b.click());
check('the stop icon in the mini timer stops the timer', (await hasText(A, 'Timer stopped')) && (await waitSel(A, '#timer-description')));
check('...and "Today" now has 3 entries', await A.waitForFunction(() => document.querySelectorAll('section[aria-labelledby="today-heading"] li').length === 3, { timeout: 6000 }).then(() => true, () => false));

// =====================================================================
// 8. No projects yet
// =====================================================================
const newbie = await register('Newbie');
const F = await openDevice('F-no-projects', newbie.token);
check('no projects: "Create a project first" with a link', (await hasText(F, 'Create a project first')) && Boolean(await F.$('a[href="/projects"]')));
await shot(F, '07-no-projects-desktop');
await F.click('a[href="/projects"]');
check('...the link goes to /projects', await waitPath(F, '/projects'));
await F.browserContext().close();

// =====================================================================
// 9. Phone (375px)
// =====================================================================
await A.setViewport({ width: 375, height: 667, isMobile: true, hasTouch: true });
await A.goto(BASE + '/');
await waitSel(A, '#timer-description');
check('mobile idle: no horizontal scroll', (await overflow(A)) <= 0, `overflow=${await overflow(A)}`);
await shot(A, '08-idle-mobile');

await A.click('#projectId');
await waitSel(A, '[role=listbox]');
const listBox = await A.$eval('[role=listbox]', (l) => { const r = l.getBoundingClientRect(); return { left: r.left, right: r.right }; });
check('mobile: project dropdown fits the screen', listBox.left >= 0 && listBox.right <= 375, JSON.stringify(listBox));
await shot(A, '09-dropdown-mobile');
await A.keyboard.press('Enter');
await A.click('form button[type=submit]');
check('mobile: timer starts', await waitSel(A, RUNNING));
await sleep(1200);
const mobileInfo = await A.evaluate(() => {
  const header = document.querySelector('header');
  const mini = header.querySelector('[data-testid="mini-timer"]');
  const r = mini?.getBoundingClientRect();
  const logout = header.querySelector('button[aria-label="Log out"]').getBoundingClientRect();
  return { miniInTopBar: Boolean(mini), miniVisible: Boolean(mini && mini.offsetParent !== null), miniRight: r?.right, logoutLeft: logout.left, logoutRight: logout.right, time: mini?.innerText.trim() };
});
check('mobile: mini timer shows in the top bar next to the logo and log out', mobileInfo.miniInTopBar && mobileInfo.miniVisible && /^\d\d:\d\d:\d\d$/.test(mobileInfo.time), JSON.stringify(mobileInfo));
check('mobile: top bar contents fit (nothing pushed off screen)', mobileInfo.logoutRight <= 375 && mobileInfo.miniRight <= mobileInfo.logoutLeft + 1, JSON.stringify(mobileInfo));
check('mobile running: no horizontal scroll', (await overflow(A)) <= 0, `overflow=${await overflow(A)}`);
await shot(A, '10-running-mobile');
await A.goto(BASE + '/clients');
await waitSel(A, 'main h1');
check('mobile: other pages have no horizontal scroll while a timer runs', (await overflow(A)) <= 0);
await A.goto(BASE + '/');
await waitSel(A, RUNNING);
await clickButton(A, 'Stop', RUNNING);
check('mobile: stop works', await waitSel(A, '#timer-description'));

// =====================================================================
check('isolated: no request went to the dev servers on 5000/5173', blocked.length === 0, blocked.join(' | '));
check('no unexpected console/page errors', consoleErrors.length === 0, consoleErrors.join(' | '));

await browser.close();
console.log(failures === 0 ? '\nALL STEP 4 BROWSER CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
