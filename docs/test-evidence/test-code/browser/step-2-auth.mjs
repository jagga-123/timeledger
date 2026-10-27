import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.E2E_BASE || 'http://localhost:5273';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SHOTS = new URL('./shots/', import.meta.url).pathname.replace(/^\//, '');
mkdirSync(SHOTS, { recursive: true });

const EMAIL = `e2e-${Date.now()}@example.com`;
let failures = 0;
const check = (name, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
};

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
  // 4xx responses from the API are expected in these tests
  if (m.type() === 'error' && !/status of (400|401|409)/.test(m.text())) consoleErrors.push(m.text());
});

const path = () => new URL(page.url()).pathname;
const text = () => page.evaluate(() => document.body.innerText);
const hasText = (t, timeout = 5000) =>
  page.waitForFunction((s) => document.body.innerText.includes(s), { timeout }, t).then(() => true, () => false);
const waitPath = (p, timeout = 5000) =>
  page.waitForFunction((s) => location.pathname === s, { timeout }, p).then(() => true, () => false);
const token = () => page.evaluate(() => localStorage.getItem('token'));
const shot = (name) => page.screenshot({ path: SHOTS + name + '.png' });
const clearAndType = async (sel, value) => {
  await page.focus(sel);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  if (value) await page.type(sel, value);
};
// log API statuses so a failing step can be explained
const apiLog = [];
page.on('response', (r) => r.status() === 404 && console.log('INFO 404 url:', r.url()));
page.on('response', (r) => {
  if (r.url().includes('/api/auth/') && r.request().method() !== 'OPTIONS') {
    apiLog.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`);
  }
});
const submit = () => page.click('button[type=submit]');

// 1. Logged out: "/" redirects to /login
await page.goto(BASE + '/');
check('/ redirects to /login when logged out', await waitPath('/login'));
check('login page shows brand + demo hint', (await text()).includes('TimeLedger') && (await text()).includes('demo@timeledger.app / Demo@1234'));
await shot('01-login-desktop');

// 2. Empty login -> field errors from the server
await submit();
check('empty login shows server field errors', await hasText('Enter a valid email address') && await hasText('Password is required'));

// 3. Register page: empty submit -> field-wise errors
await page.click('a[href="/register"]');
check('link goes to /register', await waitPath('/register'));
await submit();
check(
  'empty register shows errors under each field',
  (await hasText('Name must be at least 2 characters')) &&
    (await hasText('Enter a valid email address')) &&
    (await hasText('Password must be at least 8 characters'))
);
const errorCount = await page.$$eval('p[id$="-error"]', (els) => els.length);
check('3 inline field errors rendered', errorCount === 3, String(errorCount));
await shot('02-register-errors-desktop');

// typing into a field clears that field's error
await page.type('#name', 'E2E User');
const afterTyping = await page.$$eval('p[id$="-error"]', (els) => els.length);
check('typing clears that field\'s error', afterTyping === 2, String(afterTyping));

// 4. Successful register -> dashboard
await page.type('#email', EMAIL);
await page.type('#password', 'Passw0rd!');
await submit();
check('register redirects to dashboard', await waitPath('/'));
check('dashboard greets the user', await hasText('Welcome, E2E User'));
check('token saved in localStorage', Boolean(await token()));
await shot('03-dashboard-desktop');

// 5. Reload keeps the session (calls /auth/me)
await page.reload();
check('reload keeps user logged in', (await hasText('Welcome, E2E User')) && path() === '/');

// 6. Logged-in user visiting /login or /register goes to /
await page.goto(BASE + '/login');
check('logged-in user on /login is redirected to /', await waitPath('/'));
await page.goto(BASE + '/register');
check('logged-in user on /register is redirected to /', await waitPath('/'));

// 7. Logout
await page.click('aside button[aria-label="Log out"]');
check('logout goes to /login', await waitPath('/login'));
check('logout clears token', (await token()) === null);

// 8. Wrong password -> toast, stays on /login
await page.type('#email', EMAIL);
await page.type('#password', 'wrong-password');
await submit();
check('wrong password shows toast', await hasText('Invalid email or password'));
check('stays on /login after failed login', path() === '/login');
await shot('04-login-toast-desktop');

// 9. Button loading state (slow the network down a bit)
const cdp = await page.createCDPSession();
await cdp.send('Network.enable');
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 1500, downloadThroughput: -1, uploadThroughput: -1 });
await clearAndType('#password', 'Passw0rd!');
await submit();
const loading = await page.waitForFunction(
  () => {
    const b = document.querySelector('button[type=submit]');
    return b && b.disabled && b.innerText.includes('Logging in...') && b.querySelector('svg.animate-spin');
  },
  { timeout: 3000 }
).then(() => true, () => false);
check('submit button shows spinner + disabled while loading', loading);
await shot('05-login-loading-desktop');
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

// 10. Correct login -> dashboard
const reachedDashboard = (await waitPath('/', 10000)) && (await hasText('Welcome, E2E User'));
check('correct login reaches dashboard', reachedDashboard);
if (!reachedDashboard) {
  console.log('DEBUG path:', path(), '| body text:', JSON.stringify(await text()));
  console.log('DEBUG api calls so far:', apiLog.join(' , '));
  console.log('DEBUG password field length:', await page.$eval('#password', (el) => el.value.length));
  await shot('debug-after-throttled-login');
}
const atClickPoint = await page.evaluate(() => {
  const r = document.querySelector('aside button[aria-label="Log out"]').getBoundingClientRect();
  const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return `${el.tagName} insideLogoutButton=${Boolean(el.closest('button[aria-label="Log out"]'))} insideToast=${Boolean(el.closest('[role=status]'))}`;
});
console.log('INFO element at Log-out click point:', atClickPoint);
await shot('08-dashboard-before-second-logout');
await page.click('aside button[aria-label="Log out"]');
check('second logout goes to /login', await waitPath('/login'));

// 11. Duplicate email on register -> toast
await page.goto(BASE + '/register');
const nameField = await page.waitForSelector('#name', { timeout: 5000 }).catch(() => null);
if (!nameField) {
  console.log('DEBUG path:', path(), '| token:', await token(), '| body:', JSON.stringify(await text()));
  await shot('debug-register');
}
check('register form renders after logout + reload', Boolean(nameField));
await page.type('#name', 'Someone Else');
await page.type('#email', EMAIL.toUpperCase());
await page.type('#password', 'Passw0rd!');
await submit();
check('duplicate email shows toast', await hasText('Email is already registered'));
check('stays on /register after duplicate', path() === '/register');

// 12. Invalid token in storage -> cleared on load, back to /login
await page.evaluate(() => localStorage.setItem('token', 'garbage'));
await page.goto(BASE + '/');
check('invalid token redirects to /login', await waitPath('/login'));
check('invalid token is cleared (401 handling)', (await token()) === null);

// 13. Mobile layout
await page.setViewport({ width: 375, height: 667, isMobile: true, hasTouch: true });
await page.goto(BASE + '/login');
await hasText('Welcome back');
const overflowLogin = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check('login: no horizontal overflow at 375px', overflowLogin <= 0, `overflow=${overflowLogin}`);
await shot('06-login-mobile');
await page.goto(BASE + '/register');
await hasText('Create your account');
await submit();
await hasText('Name must be at least 2 characters');
const overflowReg = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check('register: no horizontal overflow at 375px', overflowReg <= 0, `overflow=${overflowReg}`);
await shot('07-register-errors-mobile');

check('isolated: no request went to the dev servers on 5000/5173', blocked.length === 0, blocked.join(' | '));
check('no unexpected console/page errors', consoleErrors.length === 0, consoleErrors.join(' | '));

await browser.close();
console.log(failures === 0 ? '\nALL BROWSER CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
