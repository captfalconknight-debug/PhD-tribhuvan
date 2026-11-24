/**
 * inputs/handmath.js — pure functions for webcam hand tracking (no DOM).
 *
 * MediaPipe hand landmark indices used here:
 *   0 = wrist, 4 = thumb tip, 8 = index finger tip, 9 = middle finger MCP.
 */

export const LM = { WRIST: 0, THUMB_TIP: 4, INDEX_TIP: 8, MIDDLE_MCP: 9 };

function dist3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
}

/**
 * Pinch ratio = thumb-tip to index-tip distance / wrist to middle-MCP distance.
 * Dividing by a hand-size reference makes it independent of hand size and of
 * distance from the camera. Uses MediaPipe "world" landmarks (metres, 3D)
 * when available, which are less sensitive to hand rotation; otherwise uses
 * image landmarks corrected for the image aspect ratio.
 */
export function pinchRatio(world, image, aspect = 4 / 3) {
  if (world && world.length > 9) {
    return dist3(world[LM.THUMB_TIP], world[LM.INDEX_TIP]) / Math.max(1e-6, dist3(world[LM.WRIST], world[LM.MIDDLE_MCP]));
  }
  const sc = (p) => ({ x: p.x * aspect, y: p.y, z: (p.z || 0) * aspect });
  const L = image.map(sc);
  return dist3(L[LM.THUMB_TIP], L[LM.INDEX_TIP]) / Math.max(1e-6, dist3(L[LM.WRIST], L[LM.MIDDLE_MCP]));
}

/** Cursor = midpoint of thumb tip and index tip, mirrored horizontally (u = 1 - x). */
export function cursorFromLandmarks(image) {
  const a = image[LM.THUMB_TIP]; const b = image[LM.INDEX_TIP];
  return { u: 1 - (a.x + b.x) / 2, v: (a.y + b.y) / 2 };
}

/** Palm length (wrist to middle MCP) as a fraction of the image width — a rough distance cue. */
export function palmSize(image, aspect = 4 / 3) {
  const a = image[LM.WRIST]; const b = image[LM.MIDDLE_MCP];
  return Math.hypot((a.x - b.x), (a.y - b.y) / aspect);
}

/** Default thresholds used before a participant is calibrated. */
export const DEFAULT_PINCH = { close: 0.30, open: 0.45 };

/**
 * Pinch thresholds from a per-participant calibration and the 1–10 sensitivity slider.
 *   calib = { open: median ratio with an open hand, pinch: median ratio while pinching }
 * Close threshold at 35 % and open threshold at 55 % of the way from pinch to open
 * (the gap between them is the hysteresis). Sensitivity 5 = neutral; each step
 * scales both thresholds by 8 % (higher = a pinch is detected more easily).
 */
export function pinchThresholds(calib, sensitivity = 5) {
  let close; let open;
  if (calib && calib.open > calib.pinch) {
    const r = calib.open - calib.pinch;
    close = calib.pinch + 0.35 * r;
    open = calib.pinch + 0.55 * r;
  } else {
    ({ close, open } = DEFAULT_PINCH);
  }
  const k = 1 + (Math.max(1, Math.min(10, sensitivity)) - 5) * 0.08;
  return { close: close * k, open: open * k };
}

/** Pinch state with hysteresis: closes below `close`, opens above `open`. */
export class PinchDetector {
  constructor(th = DEFAULT_PINCH) { this.th = th; this.state = false; }
  setThresholds(th) { this.th = th; }
  update(ratio) {
    if (ratio == null || Number.isNaN(ratio)) return this.state;
    if (!this.state && ratio < this.th.close) this.state = true;
    else if (this.state && ratio > this.th.open) this.state = false;
    return this.state;
  }
  reset() { this.state = false; }
}

/**
 * Pick the landmarks of the tested hand from a MediaPipe HandLandmarker result.
 * MediaPipe labels each hand "Left" or "Right". Whether the label refers to the
 * participant's own hand depends on whether the image is mirrored, so the
 * camera check measures this once per laptop (`invert`).
 * `allowSingle`: before that check, if only ONE hand is visible, use it even
 * if its label does not match.
 */
export function selectHand(result, testedHand, invert = false, allowSingle = false) {
  const hands = [];
  const n = result?.landmarks?.length || 0;
  for (let i = 0; i < n; i++) {
    const cat = (result.handedness || result.handednesses || [])[i]?.[0];
    let label = (cat?.categoryName || '').toLowerCase();
    if (invert) label = label === 'left' ? 'right' : label === 'right' ? 'left' : label;
    hands.push({ index: i, label, score: cat?.score ?? 0, image: result.landmarks[i], world: result.worldLandmarks?.[i] });
  }
  let match = hands.filter((h) => h.label === testedHand).sort((a, b) => b.score - a.score)[0] || null;
  if (!match && allowSingle && hands.length === 1) match = { ...hands[0], assumed: true };
  return { hand: match, all: hands };
}

/** Median of an array of numbers. */
export function median(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** p-th percentile (0..1) of an array, linear interpolation. */
export function percentile(a, p) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const i = (s.length - 1) * p; const lo = Math.floor(i); const hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
