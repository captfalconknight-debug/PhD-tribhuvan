/**
 * tests/smoke.mjs — browser smoke test (Playwright + Chromium).
 *
 * Serves the app on a local port, opens it in headless Chromium, fills in the
 * participant form, runs a full 60 s trial in MOUSE mode with a scripted
 * "participant" moving blocks, and checks: no console errors, the result is
 * shown, the session is saved, and CSV/JSON downloads work.
 *
 * Also checks that the webcam pipeline loads MediaPipe from the local vendor/
 * folder using Chromium's fake camera (no real hand, so no tracking expected).
 *
 * Set VBBT_VIEW=2d to test the 2D view (default 3d).
 * Usage:  node tests/smoke.mjs [path-to-html | https://live-site/]   (default: index.html)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch {
  console.log('SKIP: Playwright is not installed (npm i -D playwright && npx playwright install chromium).');
  process.exit(0);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const page0 = process.argv[2] || 'index.html';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.task': 'application/octet-stream' };

const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true, permissions: ['camera'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(/^https?:/.test(page0) ? page0 : base + page0);
  await page.fill('#pid', 'SMOKE01');
  await page.fill('#age', '45');
  await page.selectOption('#sex', 'Female');
  await page.selectOption('#dominant', 'right');
  await page.selectOption('#device', 'mouse');
  const VIEW = process.env.VBBT_VIEW || '3d';
  await page.selectOption('#view', VIEW);
  console.log('View:', VIEW);
  await page.click('#connect');

  // Practice trial first (must NOT be saved).
  await page.check('#practice');
  await page.click('#start');
  await page.waitForSelector('#consent[open]');
  await page.click('#consentAgree');

  await page.waitForTimeout(300);
  const stage = await page.$('#stage');
  const box = await stage.boundingBox();
  // world (cm) -> page pixels using the app's renderer
  const toPage = async (x, y) => page.evaluate(([x, y]) => {
    const r = window.vbbt.renderer; const c = r.canvas.getBoundingClientRect();
    const [sx, sy] = r.toScreen(x, y);
    return [c.left + sx / r.canvas.width * c.width, c.top + sy / r.canvas.height * c.height];
  }, [x, y]);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  /** Scripted participant: move one block from the right (source) to the left (target). */
  async function moveOneBlock(i) {
    const b = await page.evaluate(() => {
      const e = window.vbbt.state.engine;
      if (!e || e.finished) return null;
      const c = e.blocks.filter((k) => k.state === 'rest' && e.sideOf(k) === e.sourceSide && !e.isCovered(k))
        .sort((a, b) => b.y - a.y || a.x - b.x)[0];
      return c ? { x: c.x + 1.25, y: c.y + 1.25 } : null;
    });
    if (!b) return false;
    const tx = 4 + (i % 9) * 2.5;
    const steps = [[b.x, b.y], [b.x, 22], [tx, 22], [tx, 12]];
    let [px, py] = await toPage(...steps[0]);
    await page.mouse.move(px, py, { steps: 3 });
    await page.waitForTimeout(40);
    await page.mouse.down();
    await page.waitForTimeout(60);   // a real pinch lasts several frames
    for (const s of steps.slice(1)) {
      [px, py] = await toPage(...s);
      await page.mouse.move(px, py, { steps: 5 });
      await page.waitForTimeout(40);
    }
    await page.mouse.up();
    await page.waitForTimeout(40);
    return true;
  }

  const runUntilDone = async () => {
    let i = 0;
    const tEnd = Date.now() + 120000;
    while (Date.now() < tEnd) {
      const phase = await page.evaluate(() => window.vbbt.state.phase);
      if (phase === 'done' || phase === 'idle') break;
      if (phase === 'running') await moveOneBlock(i++); else await page.waitForTimeout(100);
    }
    return i;
  };
  await runUntilDone();
  const practiceTitle = await page.textContent('#resultsTitle');
  if (!/Practice/.test(practiceTitle)) fail('practice result title: ' + practiceTitle);
  if ((await page.$$('#sessions tbody tr td[colspan]')).length !== 1) fail('practice should not be saved');

  // Full 60 s test trial.
  await page.uncheck('#practice');
  await page.click('#start');
  await page.waitForTimeout(300);
  { const bb = await stage.boundingBox(); await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 2 }); }
  const t0 = Date.now();
  await runUntilDone();
  const secs = (Date.now() - t0) / 1000;
  const score = +(await page.textContent('#resScore'));
  console.log(`Test trial finished in ${secs.toFixed(1)} s, score ${score}`);
  if (secs < 59) fail('trial ended too early');
  if (!(score > 5)) fail('score too low: ' + score);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('vbbt.sessions.v1')));
  if (saved?.length !== 1) fail('expected 1 saved session');
  if (saved?.[0].score !== score) fail('saved score mismatch');
  if (saved?.[0].transfers - saved?.[0].returns !== score) fail('score != transfers - returns');
  if (!saved?.[0].consentTimestamp) fail('consent timestamp missing');
  const rows = await page.$$('#sessions tbody tr');
  if (rows.length !== 1) fail('sessions table should have 1 row');
  await page.screenshot({ path: path.join(root, 'test-results', 'smoke-results.png'), fullPage: true }).catch(() => {});

  // Downloads
  const [csv] = await Promise.all([page.waitForEvent('download'), page.click('#dlCsv')]);
  const csvText = fs.readFileSync(await csv.path(), 'utf8');
  if (!csvText.includes('SMOKE01') || !csvText.split('\r\n')[0].includes('score')) fail('CSV content');
  const [js] = await Promise.all([page.waitForEvent('download'), page.click('#dlJson')]);
  const j = JSON.parse(fs.readFileSync(await js.path(), 'utf8'));
  if (!(j.samples.length > 100 && j.events.length > 5)) fail('JSON detail missing');
  console.log(`CSV ${csvText.length} bytes; JSON ${j.samples.length} samples, ${j.events.length} events`);

  // Webcam pipeline with Chromium's fake camera: model must load from vendor/.
  await page.selectOption('#device', 'camera');
  const vendorReqs = [];
  page.on('request', (r) => { if (r.url().includes('/vendor/mediapipe/')) vendorReqs.push(r.url()); });
  page.on('request', (r) => { if (/jsdelivr|googleapis/.test(r.url())) fail('CDN used at runtime: ' + r.url()); });
  await page.click('#connect');
  await page.waitForFunction(() => /Camera ready|refused|not|Could not/i.test(document.querySelector('#devStatus').textContent), null, { timeout: 120000 });
  const status = await page.textContent('#devStatus');
  console.log('Camera status:', status);
  if (!/Camera ready/.test(status)) fail('camera pipeline did not start: ' + status);
  await page.waitForTimeout(1500);
  const camFps = await page.evaluate(() => window.vbbt.state.input.fps());
  console.log(`Fake-camera detection rate: ${camFps.toFixed(1)} fps; vendor files requested: ${vendorReqs.length}`);
  if (!(camFps > 1)) fail('hand detection is not running on camera frames');

  // Camera check wizard: step 1 measures the camera, step 2 waits for a hand
  // (the fake camera shows no hand), Escape cancels it.
  await page.click('#setupBtn');
  await page.waitForFunction(() => /Step 2 of 4/.test(document.querySelector('#overlay').textContent), null, { timeout: 20000 });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => /cancelled/.test(document.querySelector('#calibStatus').textContent), null, { timeout: 5000 });
  console.log('Camera check wizard: started, waited for hand, cancelled OK');

  // MediaPipe prints harmless info lines on the error channel.
  const real = errors.filter((e) => !/favicon|^INFO:|^W\d{4}|XNNPACK|TensorFlow Lite/.test(e));
  if (real.length) fail('console errors:\n  ' + real.join('\n  '));
  if (!process.exitCode) console.log('SMOKE TEST PASSED');
} finally {
  await browser.close();
  server.close();
}
