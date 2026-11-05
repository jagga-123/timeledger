// puppeteer.launch() makes Edge 156 exit straight away on this machine ("Failed to launch the browser process: Code: 0").
// Starting Edge ourselves with a fixed debugging port and connecting to it works, so every script uses this instead.
// Only the Edge process started here (and its children) is ever stopped; the user's own Edge windows are never touched.
import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

export async function launchEdge() {
  const userDataDir = mkdtempSync(join(tmpdir(), 'edge-p1b-'));
  const port = await freePort();
  const child = spawn(
    EDGE,
    ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank'],
    { stdio: 'ignore', windowsHide: true },
  );

  let browser;
  const deadline = Date.now() + 30000;
  while (!browser) {
    try {
      browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport: null });
    } catch (e) {
      if (Date.now() > deadline) {
        stop();
        throw new Error(`Edge did not open its debugging port: ${e.message}`);
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  function stop() {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* already gone */ }
    try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* still in use: harmless temp folder */ }
  }

  // browser.close() on a connected browser tells Edge to quit; then make sure the whole tree is gone
  const close = browser.close.bind(browser);
  browser.close = async () => {
    await close().catch(() => {});
    stop();
  };
  return browser;
}
