/**
 * setup.js — camera setup check and per-participant calibration.
 *
 * Steps (shown full-size on the stage):
 *   1. Camera  — frame rate and image brightness (2 s)
 *   2. Open hand — tested hand held open and still for 3 s; records the open-hand
 *      pinch ratio and palm size (distance cue)
 *   3. Pinch   — thumb and index together for 2 s; records the pinched ratio
 *   4. Reach   — move the hand to the comfortable left/right/top/bottom limits
 *      for 8 s of tracked time; defines the reach area mapped onto the box
 *
 * Returns a plain object that is stored with every trial run afterwards.
 */
import { median, percentile } from './inputs/handmath.js';
import { FPS_WARNING } from './config.js';

const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11],
  [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];

const STEP_TIMEOUT = 45000;   // ms to wait for each hand step before giving up

/** Distance cue from palm length as a fraction of image width. */
export function distanceHint(palm) {
  if (palm == null) return 'unknown';
  if (palm < 0.09) return 'too far';
  if (palm > 0.24) return 'too close';
  return 'ok';
}

export function brightnessHint(b) {
  if (b == null) return 'unknown';
  if (b < 60) return 'too dark';
  if (b > 210) return 'too bright';
  return 'ok';
}

export async function runSetupCheck({ cam, canvas, overlay, testedHand, signal }) {
  const ctx = canvas.getContext('2d');
  const handName = testedHand === 'left' ? 'LEFT' : 'RIGHT';
  const result = { warnings: [] };

  function show(title, lines = [], progress = null) {
    overlay.hidden = false;
    overlay.className = 'overlay setup';
    overlay.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'setup-box';
    const h = document.createElement('div'); h.className = 'setup-title'; h.textContent = title; box.appendChild(h);
    for (const l of lines) {
      const p = document.createElement('div');
      p.className = 'setup-line' + (l.cls ? ' ' + l.cls : '');
      p.textContent = l.text ?? l;
      box.appendChild(p);
    }
    if (progress != null) {
      const bar = document.createElement('div'); bar.className = 'progress';
      const fill = document.createElement('div'); fill.style.width = `${Math.round(progress * 100)}%`;
      bar.appendChild(fill); box.appendChild(bar);
    }
    overlay.appendChild(box);
  }

  /** Draw the mirrored camera image filling the stage, with the hand skeleton. */
  function drawCamera(extra) {
    const W = canvas.width; const H = canvas.height;
    const v = cam.video;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    if (!v.videoWidth) return;
    const s = Math.min(W / v.videoWidth, H / v.videoHeight);
    const w = v.videoWidth * s; const h = v.videoHeight * s;
    const x0 = (W - w) / 2; const y0 = (H - h) / 2;
    ctx.save();
    ctx.translate(x0 + w, y0); ctx.scale(-1, 1);
    ctx.drawImage(v, 0, 0, w, h);
    ctx.restore();
    const l = cam.read();
    const lms = cam.lastLandmarks;
    if (lms && l.present) {
      ctx.strokeStyle = '#00e676'; ctx.lineWidth = 4;
      for (const [a, b] of BONES) {
        ctx.beginPath();
        ctx.moveTo(x0 + (1 - lms[a].x) * w, y0 + lms[a].y * h);
        ctx.lineTo(x0 + (1 - lms[b].x) * w, y0 + lms[b].y * h);
        ctx.stroke();
      }
    }
    if (extra) extra({ x0, y0, w, h });
  }

  /** Run a step until done() returns true; tick() is called every frame. */
  function step(tick, timeout = STEP_TIMEOUT) {
    return new Promise((resolve, reject) => {
      const t0 = performance.now();
      const frame = () => {
        if (signal?.aborted) { reject(new Error('cancelled')); return; }
        const now = performance.now();
        let r;
        try { r = tick(now - t0, now); } catch (e) { reject(e); return; }
        if (r) { resolve(r); return; }
        if (timeout && now - t0 > timeout) { reject(new Error('timeout')); return; }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  }

  // ---- Step 1: camera ---------------------------------------------------------
  const bright = [];
  await step((el) => {
    drawCamera();
    if (el > 300) bright.push(cam.brightness());
    show('Step 1 of 4 — Checking the camera', ['Please wait…'], Math.min(1, el / 2500));
    return el > 2500 ? true : null;
  });
  result.fps = Math.round(cam.fps() * 10) / 10;
  result.brightness = Math.round(median(bright.filter((b) => b != null)) ?? 0);
  result.brightnessHint = brightnessHint(result.brightness);
  if (result.fps < FPS_WARNING) result.warnings.push(`Low frame rate (${result.fps} fps). Close other programs and plug in the charger.`);
  if (result.brightnessHint === 'too dark') result.warnings.push('The image is dark. Turn on a light in front of the participant.');
  if (result.brightnessHint === 'too bright') result.warnings.push('The image is very bright. Avoid a window or lamp behind the participant.');

  // ---- Step 2: open hand, still for 3 s ------------------------------------------
  // Also checks MediaPipe's left/right labels on this laptop: the participant
  // shows only the tested hand, so if the single visible hand keeps getting the
  // opposite label for ~1 s, the labels are swapped (mirrored camera image).
  cam.allowSingle = false;
  let mismatch = 0; let swapped = false;
  let openRatios = []; let palms = []; let wrists = []; let stableSince = null;
  await step((el, now) => {
    drawCamera();
    const l = cam.read(now);
    const lines = [`Hold up your ${handName} hand only, fingers open, palm facing the screen.`, 'Keep it still.'];
    if (swapped) lines.push({ text: 'Note: left/right labels are swapped on this camera — corrected automatically.', cls: 'ok' });
    if (!l.present) {
      stableSince = null; openRatios = []; palms = []; wrists = [];
      if (l.others?.length === 1 && !swapped) {
        if (++mismatch > 30) { cam.invert = !cam.invert; swapped = true; mismatch = 0; }
      } else mismatch = 0;
      if (l.others?.length > 1) lines.push({ text: `Please show only your ${handName} hand.`, cls: 'warn' });
      else if (!l.others?.length) lines.push({ text: 'No hand seen yet.', cls: 'warn' });
      show('Step 2 of 4 — Show your open hand', lines, 0);
      return null;
    }
    wrists.push(l.wrist); openRatios.push(l.ratio); palms.push(l.palm);
    if (wrists.length > 20) { wrists.shift(); }
    const jitter = Math.max(...wrists.map((w) => Math.hypot(w.u - wrists[0].u, w.v - wrists[0].v)));
    const dist = distanceHint(l.palm);
    if (dist === 'too far') lines.push({ text: 'Move a little CLOSER to the camera.', cls: 'warn' });
    if (dist === 'too close') lines.push({ text: 'Move a little FURTHER from the camera.', cls: 'warn' });
    const open = l.ratio > 0.5;
    if (!open) lines.push({ text: 'Open your fingers.', cls: 'warn' });
    if (jitter < 0.04 && open && dist === 'ok') {
      if (stableSince == null) stableSince = now;
    } else { stableSince = null; openRatios = openRatios.slice(-5); palms = palms.slice(-5); }
    const prog = stableSince == null ? 0 : Math.min(1, (now - stableSince) / 3000);
    show('Step 2 of 4 — Show your open hand', lines, prog);
    return prog >= 1 ? true : null;
  });
  result.handednessInverted = cam.invert;
  result.openRatio = median(openRatios);
  result.palmSize = Math.round(median(palms) * 1000) / 1000;
  result.distanceHint = distanceHint(result.palmSize);

  // ---- Step 3: pinch for 2 s ----------------------------------------------------
  let pinchRatios = []; let pinchSince = null;
  await step((el, now) => {
    drawCamera();
    const l = cam.read(now);
    const lines = ['Now touch your THUMB and INDEX finger tips together, like picking up a small block.', 'Hold the pinch.'];
    const pinched = l.present && l.ratio < result.openRatio * 0.45;
    if (!l.present) lines.push({ text: 'Hand not seen — keep it in view.', cls: 'warn' });
    if (pinched) { if (pinchSince == null) pinchSince = now; pinchRatios.push(l.ratio); } else { pinchSince = null; pinchRatios = []; }
    const prog = pinchSince == null ? 0 : Math.min(1, (now - pinchSince) / 2000);
    show('Step 3 of 4 — Pinch', lines, prog);
    return prog >= 1 ? true : null;
  });
  result.pinchRatio = median(pinchRatios);

  // ---- Step 4: reach area (8 s of tracked movement) -------------------------------
  const us = []; const vs = []; let tracked = 0; let last = null;
  await step((el, now) => {
    const l = cam.read(now);
    if (l.present) {
      if (last != null) tracked += now - last;
      us.push(l.u); vs.push(l.v);
    }
    last = now;
    drawCamera(({ x0, y0, w, h }) => {
      ctx.fillStyle = 'rgba(255, 234, 0, 0.9)';
      for (let i = Math.max(0, us.length - 400); i < us.length; i++) {
        ctx.beginPath(); ctx.arc(x0 + us[i] * w, y0 + vs[i] * h, 4, 0, Math.PI * 2); ctx.fill();
      }
    });
    const prog = Math.min(1, tracked / 8000);
    show('Step 4 of 4 — Reach', [
      'Slowly move your hand as far LEFT and RIGHT, and as HIGH and LOW, as is comfortable.',
      'Stay seated. Keep your hand in view.',
      ...(l.present ? [] : [{ text: 'Hand not seen — keep it in view.', cls: 'warn' }]),
    ], prog);
    return prog >= 1 ? true : null;
  });
  const reach = { u0: percentile(us, 0.03), u1: percentile(us, 0.97), v0: percentile(vs, 0.03), v1: percentile(vs, 0.97) };
  if (reach.u1 - reach.u0 < 0.15 || reach.v1 - reach.v0 < 0.12) {
    result.warnings.push('The reach movement was very small, so the standard reach area is used.');
    result.reach = null;
  } else {
    // Round for storage/readability
    for (const k of Object.keys(reach)) reach[k] = Math.round(reach[k] * 1000) / 1000;
    result.reach = reach;
  }

  result.openRatio = Math.round(result.openRatio * 1000) / 1000;
  result.pinchRatio = Math.round(result.pinchRatio * 1000) / 1000;
  result.completedAt = new Date().toISOString();

  show('Camera check complete', [
    { text: `Frame rate: ${result.fps} fps ${result.fps < FPS_WARNING ? '(LOW)' : '(good)'}`, cls: result.fps < FPS_WARNING ? 'warn' : 'ok' },
    { text: `Lighting: ${result.brightnessHint}`, cls: result.brightnessHint === 'ok' ? 'ok' : 'warn' },
    { text: `Distance: ${result.distanceHint}`, cls: result.distanceHint === 'ok' ? 'ok' : 'warn' },
    ...result.warnings.map((w) => ({ text: w, cls: 'warn' })),
  ]);
  return result;
}
