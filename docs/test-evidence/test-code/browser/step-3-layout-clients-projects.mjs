import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.E2E_BASE || 'http://localhost:5273';
const API = process.env.E2E_API || 'http://localhost:5100/api';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SHOTS = new URL('./shots3/', import.meta.url).pathname.replace(/^\//, '');
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const check = (name, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
};

// Create the user through the API, then start the browser already logged in
const email = `s3-${Date.now()}@example.com`;
const reg = await (await fetch(`${API}/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Priya Sharma', email, password: 'Passw0rd!' }),
})).json();

const browser = await puppeteer.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });

// Safety net: never let a test request reach the developer's own servers (5000 = backend with the real DB, 5173 = dev server)
const blocked = [];
await page.setRequestInterception(true);
page.on('request', (r) => {
  if (/localhost:(5000|5173)\b/.test(r.url())) { blocked.push(r.url()); r.abort(); } else { r.continue(); }
});

const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !/status of (400|401|409)/.test(m.text())) consoleErrors.push(m.text());
});

const path = () => new URL(page.url()).pathname;
const text = () => page.evaluate(() => document.body.innerText);
const hasText = (t, timeout = 5000) =>
  page.waitForFunction((s) => document.body.innerText.includes(s), { timeout }, t).then(() => true, () => false);
const gone = (t, timeout = 5000) =>
  page.waitForFunction((s) => !document.body.innerText.includes(s), { timeout }, t).then(() => true, () => false);
const waitPath = (p, timeout = 5000) =>
  page.waitForFunction((s) => location.pathname === s, { timeout }, p).then(() => true, () => false);
const shot = (name) => page.screenshot({ path: SHOTS + name + '.png' });
const modalOpen = () => page.$('[role=dialog]').then(Boolean);
const modalClosed = () => page.waitForSelector('[role=dialog]', { hidden: true, timeout: 5000 }).then(() => true, () => false);
const rows = () => page.$$eval('main li', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
// the toast shows as soon as the API answers, but the list refetches a moment later
const waitRows = (n) =>
  page.waitForFunction((n) => document.querySelectorAll('main li').length === n, { timeout: 5000 }, n).then(() => true, () => false);
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

// click the first visible <button> whose text matches, optionally inside a container selector
const clickButton = async (label, within = 'body') => {
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
const clickLabel = (label) => page.click(`button[aria-label="${label}"]`);
const setField = async (sel, value) => {
  await page.focus(sel);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  if (value !== '') await page.type(sel, value);
};
const selectByText = async (sel, label) => {
  const value = await page.$eval(sel, (s, label) => [...s.options].find((o) => o.text === label)?.value, label);
  await page.select(sel, value);
};
// waits for the inline error under a field to show exactly this message
const fieldErrorIs = (id, message) =>
  page
    .waitForFunction((id, m) => document.getElementById(`${id}-error`)?.innerText === m, { timeout: 4000 }, id, message)
    .then(() => true, () => false);

// ---------- start logged in ----------
await page.goto(BASE + '/login');
await page.evaluate((t) => localStorage.setItem('token', t), reg.token);
await page.goto(BASE + '/');
await hasText('Welcome, Priya Sharma');

// ===== 1. Desktop layout =====
const desktop = await page.evaluate(() => {
  const aside = document.querySelector('aside');
  const bottomNav = document.querySelector('nav.fixed.bottom-0');
  const header = document.querySelector('header');
  return {
    asideShown: getComputedStyle(aside).display !== 'none',
    asideBg: getComputedStyle(aside).backgroundColor,
    asideWidth: aside.getBoundingClientRect().width,
    links: [...aside.querySelectorAll('nav a')].map((a) => a.innerText.trim()),
    bottomNavHidden: getComputedStyle(bottomNav).display === 'none',
    topBarHidden: getComputedStyle(header).display === 'none',
    userInSidebar: aside.innerText.includes('Priya Sharma'),
    logoutInSidebar: Boolean(aside.querySelector('button[aria-label="Log out"]')),
    activeClass: aside.querySelector('a[href="/"]').className.includes('bg-indigo-800'),
  };
});
// indigo-950 is reported as oklch(0.257 0.09 281.288) (same as rgb(30, 27, 75))
const isIndigo950 = desktop.asideBg === 'rgb(30, 27, 75)' || /^oklch\(0\.257 0\.09 281/.test(desktop.asideBg);
check('desktop: sidebar visible, 256px wide, indigo-950 background', desktop.asideShown && desktop.asideWidth === 256 && isIndigo950, `${desktop.asideWidth}px ${desktop.asideBg}`);
check('desktop: 6 nav items in order', JSON.stringify(desktop.links) === JSON.stringify(['Dashboard', 'Clients', 'Projects', 'Time Entries', 'Timesheet', 'Invoices']), desktop.links.join(', '));
check('desktop: active item has indigo-800 background', desktop.activeClass);
check('desktop: user name + logout at bottom of sidebar', desktop.userInSidebar && desktop.logoutInSidebar);
check('desktop: mobile top bar and bottom tabs are hidden', desktop.bottomNavHidden && desktop.topBarHidden);
await shot('01-dashboard-desktop');

// ===== 2. Clients: empty state + add flow =====
await page.click('aside a[href="/clients"]');
check('sidebar link goes to /clients', await waitPath('/clients'));
check('clients: empty state with "Add your first client"', await hasText('Add your first client'));
await shot('02-clients-empty-desktop');
check('clients: active item moves to Clients', await page.$eval('aside a[href="/clients"]', (a) => a.className.includes('bg-indigo-800')));

await clickButton('Add client');
check('add client opens a modal', await modalOpen());
await clickButton('Add client', '[role=dialog]');
check('empty client form shows name error', (await hasText('Name must be at least 2 characters')));

await page.type('#name', 'Acme Corp');
await page.type('#company', 'Acme Inc');
await page.type('#email', 'not-an-email');
await clickButton('Add client', '[role=dialog]');
check('bad email shows error under the email field', await fieldErrorIs('email', 'Enter a valid email address'));
await shot('03-client-modal-errors-desktop');

await setField('#email', 'billing@acme.com');
await clickButton('Add client', '[role=dialog]');
check('valid client closes modal + toast', (await modalClosed()) && (await hasText('Client added')));
await waitRows(1);
let list = await rows();
check('client row shows name, company, email and project count', list.length === 1 && ['Acme Corp', 'Acme Inc', 'billing@acme.com', '0 projects'].every((s) => list[0].includes(s)), list[0]);

// success toast must not cover the "Add client" button
const btnCovered = await page.evaluate(() => {
  const b = [...document.querySelectorAll('main button')].find((x) => x.innerText.trim() === 'Add client');
  const r = b.getBoundingClientRect();
  return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) !== b && !b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
});
check('toast does not cover the Add client button', !btnCovered);
await shot('04-clients-list-desktop');

// duplicate (case-insensitive) -> inline error under name, modal stays open
await clickButton('Add client');
await page.type('#name', 'acme corp');
await clickButton('Add client', '[role=dialog]');
check('duplicate client name shows error under name', await fieldErrorIs('name', 'You already have a client with this name'));
check('modal stays open after duplicate', await modalOpen());
await page.keyboard.press('Escape');
check('Escape closes the modal', await modalClosed());

// backdrop click closes
await clickButton('Add client');
await page.mouse.click(5, 5);
check('clicking the backdrop closes the modal', await modalClosed());

// add more clients
for (const name of ['Globex', 'Initech']) {
  await clickButton('Add client');
  await page.type('#name', name);
  await clickButton('Add client', '[role=dialog]');
  await modalClosed();
}
await waitRows(3);
// each row starts with the avatar initial, so drop it before reading the name
const clientNames = (await rows()).map((r) => r.replace(/^\S+\s/, '').split(' ')[0]);
check('3 clients listed alphabetically', JSON.stringify(clientNames) === JSON.stringify(['Acme', 'Globex', 'Initech']), clientNames.join(', '));

// edit client
await clickLabel('Edit Globex');
check('edit modal is prefilled', (await page.$eval('#name', (e) => e.value)) === 'Globex');
await setField('#name', 'Globex Ltd');
await clickButton('Save changes');
check('editing a client updates the row', (await modalClosed()) && (await hasText('Globex Ltd')));

// ===== 3. Projects =====
await page.click('aside a[href="/projects"]');
check('projects: empty state', (await waitPath('/projects')) && (await hasText('Add your first project')));
await shot('05-projects-empty-desktop');

await clickButton('Add project');
check('project modal has 6 color presets', (await page.$$('[role=dialog] button[aria-pressed]')).length === 6);
await clickButton('Add project', '[role=dialog]');
check(
  'empty project form shows name/client/rate errors',
  (await fieldErrorIs('name', 'Name must be at least 2 characters')) &&
    (await fieldErrorIs('clientId', 'Client is required')) &&
    (await fieldErrorIs('hourlyRate', 'Hourly rate is required'))
);

await page.type('#name', 'Website redesign');
await selectByText('#clientId', 'Acme Corp');
await page.type('#hourlyRate', '-5');
await clickButton('Add project', '[role=dialog]');
check('negative rate shows server error', await fieldErrorIs('hourlyRate', 'Hourly rate cannot be negative'));
await setField('#hourlyRate', '20000');
await clickButton('Add project', '[role=dialog]');
check('rate above 10000 shows server error', await fieldErrorIs('hourlyRate', 'Hourly rate cannot be more than 10000'));

await setField('#hourlyRate', '45.678');
await page.click('[role=dialog] button[aria-label="Emerald"]');
await shot('06-project-modal-desktop');
await clickButton('Add project', '[role=dialog]');
check('valid project saves + toast', (await modalClosed()) && (await hasText('Project added')));
await waitRows(1);
list = await rows();
check('project row: name, client name, rate rounded + formatted as $45.68/hr', list.length === 1 && list[0].includes('Website redesign') && list[0].includes('Acme Corp') && list[0].includes('$45.68/hr'), list[0]);
const dot = await page.$eval('main li span[aria-hidden]', (s) => getComputedStyle(s).backgroundColor);
check('project shows its color dot (Emerald)', dot === 'rgb(16, 185, 129)', dot);
const rateFont = await page.evaluate(() => [...document.querySelectorAll('main li .font-mono')].some((e) => getComputedStyle(e).fontFamily.includes('JetBrains')));
check('rate uses JetBrains Mono', rateFont);

// second + third project
await clickButton('Add project');
await page.type('#name', 'Mobile app');
await selectByText('#clientId', 'Globex Ltd');
await page.type('#hourlyRate', '60');
await clickButton('Add project', '[role=dialog]');
await modalClosed();
await clickButton('Add project');
await page.type('#name', 'Website redesign');
await selectByText('#clientId', 'Globex Ltd');
await page.type('#hourlyRate', '30');
await clickButton('Add project', '[role=dialog]');
check('same project name under a different client is allowed', await modalClosed());
check('3 projects listed', await waitRows(3));

// duplicate project under same client
await clickButton('Add project');
await page.type('#name', 'mobile APP');
await selectByText('#clientId', 'Globex Ltd');
await page.type('#hourlyRate', '10');
await clickButton('Add project', '[role=dialog]');
check('duplicate project name shows inline error', await fieldErrorIs('name', 'This client already has a project with this name'));
await clickButton('Cancel', '[role=dialog]');
await modalClosed();

// filter by client
await selectByText('#clientFilter', 'Globex Ltd');
await page.waitForFunction(() => document.querySelectorAll('main li').length === 2, { timeout: 5000 }).catch(() => {});
list = await rows();
check('filter by client shows only that client\'s projects', list.length === 2 && list.every((r) => r.includes('Globex Ltd')), list.join(' | '));
await shot('07-projects-filtered-desktop');

await selectByText('#clientFilter', 'Initech');
check('filter with no projects shows its own empty state', await hasText('No projects for this client'));
await clickButton('Add project', 'main');
check('add project from a filtered view preselects the client', (await page.$eval('#clientId', (s) => s.options[s.selectedIndex].text)) === 'Initech');
await page.keyboard.press('Escape');
await modalClosed();
await selectByText('#clientFilter', 'All clients');
await page.waitForFunction(() => document.querySelectorAll('main li').length === 3, { timeout: 5000 }).catch(() => {});

// edit project
await clickLabel('Edit Mobile app');
check('edit project modal is prefilled', (await page.$eval('#hourlyRate', (e) => e.value)) === '60' && (await page.$eval('#clientId', (s) => s.options[s.selectedIndex].text)) === 'Globex Ltd');
await setField('#hourlyRate', '75.5');
await page.click('[role=dialog] button[aria-label="Violet"]');
await clickButton('Save changes');
check('editing a project updates the rate', (await modalClosed()) && (await hasText('$75.50/hr')));

// ===== 4. Clients page: project counts + delete rules =====
await page.click('aside a[href="/clients"]');
await waitPath('/clients');
await page.waitForFunction(() => document.querySelectorAll('main li').length === 3, { timeout: 5000 }).catch(() => {});
list = await rows();
check('clients show project counts (1 / 2 / 0)', list[0].includes('1 project') && !list[0].includes('1 projects') && list[1].includes('2 projects') && list[2].includes('0 projects'), list.map((r) => r.match(/\d+ projects?/)?.[0]).join(', '));

await clickLabel('Delete Acme Corp');
check('delete shows a confirm dialog', (await hasText('Delete client?')) && (await text()).includes('"Acme Corp" will be permanently deleted'));
await shot('08-confirm-dialog-desktop');
await clickButton('Cancel', '[role=dialog]');
check('Cancel keeps the client', (await modalClosed()) && (await rows()).length === 3);

await clickLabel('Delete Acme Corp');
await clickButton('Delete', '[role=dialog]');
check('deleting a client with projects shows the 409 message', await hasText("Delete or move this client's projects first"));
check('client with projects is still listed', (await rows()).length === 3);

await clickLabel('Delete Initech');
await clickButton('Delete', '[role=dialog]');
check('client without projects is deleted', (await hasText('Client deleted')) && (await gone('Initech')) && (await rows()).length === 2);

// delete a project, then its client
await page.click('aside a[href="/projects"]');
await waitPath('/projects');
await page.waitForFunction(() => document.querySelectorAll('main li').length === 3, { timeout: 5000 }).catch(() => {});
await clickLabel('Delete Mobile app');
await clickButton('Delete', '[role=dialog]');
check('project is deleted after confirming', (await hasText('Project deleted')) && (await waitRows(2)));

// ===== 5. The sidebar pages that were "Coming soon" in this step =====
// (Time Entries, Timesheet and Invoices became real pages in Steps 5 to 7; Invoices shows its empty state here)
await page.click('aside a[href="/invoices"]');
await waitPath('/invoices');
check('Invoices: the real page with "Create your first invoice" (no more "Coming soon")', (await hasText('Create your first invoice')) && !(await text()).includes('Coming soon') && (await page.$eval('main h1', (h) => h.innerText)) === 'Invoices');
await shot('09-invoices-empty-desktop');

// ===== 6. Mobile (375px) =====
await page.setViewport({ width: 375, height: 667, isMobile: true, hasTouch: true });
await page.goto(BASE + '/');
await hasText('Welcome, Priya Sharma');
const mobile = await page.evaluate(() => {
  const aside = document.querySelector('aside');
  const header = document.querySelector('header');
  const tabs = [...document.querySelectorAll('nav.fixed.bottom-0 a')];
  return {
    asideHidden: getComputedStyle(aside).display === 'none',
    topBar: getComputedStyle(header).display !== 'none' && header.innerText.includes('TimeLedger') && Boolean(header.querySelector('button[aria-label="Log out"]')),
    tabCount: tabs.length,
    tabsInView: tabs.every((t) => { const r = t.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth + 0.5; }),
    tabsPinnedToBottom: Math.round(document.querySelector('nav.fixed.bottom-0').getBoundingClientRect().bottom) === window.innerHeight,
    labelsClipped: tabs.some((t) => { const s = t.querySelector('span'); return s.scrollWidth > s.clientWidth; }),
  };
});
check('mobile: sidebar hidden, top bar with logo + logout shown', mobile.asideHidden && mobile.topBar);
check('mobile: bottom tab bar has 6 tabs, all inside the screen, pinned to bottom', mobile.tabCount === 6 && mobile.tabsInView && mobile.tabsPinnedToBottom);
check('mobile: tab labels are not clipped', !mobile.labelsClipped);

for (const p of ['/', '/clients', '/projects', '/time-entries', '/timesheet', '/invoices']) {
  await page.goto(BASE + p);
  await page.waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 5000 }).catch(() => {});
  const o = await overflow();
  check(`mobile: no horizontal overflow on ${p}`, o <= 0, `overflow=${o}`);
}

await page.goto(BASE + '/projects');
await page.waitForFunction(() => document.querySelectorAll('main li').length === 2, { timeout: 5000 }).catch(() => {});
const mobileRate = await page.$eval('main li', (li) => ({ visible: [...li.querySelectorAll('p')].some((p) => p.offsetParent !== null && p.innerText.includes('/hr')) }));
check('mobile: project rate is visible', mobileRate.visible);
await shot('10-projects-mobile');

await page.goto(BASE + '/clients');
await page.waitForFunction(() => document.querySelectorAll('main li').length === 2, { timeout: 5000 }).catch(() => {});
await shot('11-clients-mobile');
await clickButton('Add client', 'main');
const box = await page.$eval('[role=dialog]', (d) => { const r = d.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
check('mobile: modal fits inside the screen', box.left >= 0 && box.right <= 375 && box.top >= 0 && box.bottom <= 667, JSON.stringify(box));
check('mobile: modal causes no horizontal overflow', (await overflow()) <= 0);
await shot('12-client-modal-mobile');
await page.keyboard.press('Escape');
await modalClosed();

await page.goto(BASE + '/projects');
await page.waitForFunction(() => document.querySelectorAll('main li').length === 2, { timeout: 5000 }).catch(() => {});
await clickButton('Add project', 'main');
await page.waitForSelector('#hourlyRate');
const pbox = await page.$eval('[role=dialog]', (d) => { const r = d.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, scrolls: d.scrollHeight > d.clientHeight }; });
check('mobile: project modal fits (scrolls internally if needed)', pbox.left >= 0 && pbox.right <= 375 && pbox.top >= 0 && pbox.bottom <= 667, JSON.stringify(pbox));
await shot('13-project-modal-mobile');
await page.keyboard.press('Escape');
await modalClosed();

// mobile logout + redirect to login
await page.click('header button[aria-label="Log out"]');
check('mobile: logout from the top bar goes to /login', await waitPath('/login'));

check('isolated: no request went to the dev servers on 5000/5173', blocked.length === 0, blocked.join(' | '));
check('no unexpected console/page errors', consoleErrors.length === 0, consoleErrors.join(' | '));

await browser.close();
console.log(failures === 0 ? '\nALL STEP 3 BROWSER CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
