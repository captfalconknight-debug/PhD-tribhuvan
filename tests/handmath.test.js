// Unit tests for the webcam hand-tracking maths and the One Euro filter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pinchRatio, cursorFromLandmarks, PinchDetector, pinchThresholds, selectHand, nearestHand, DEFAULT_PINCH, median, percentile,
} from '../inputs/handmath.js';
import { OneEuroFilter } from '../filters.js';

/** A synthetic 21-point hand: wrist at origin, middle MCP 9 cm up, thumb/index tips `gap` apart. */
function hand(gap, { scale = 1, ox = 0.5, oy = 0.5 } = {}) {
  const p = Array.from({ length: 21 }, () => ({ x: ox, y: oy, z: 0 }));
  p[0] = { x: ox, y: oy, z: 0 };                       // wrist
  p[9] = { x: ox, y: oy - 0.09 * scale, z: 0 };        // middle MCP
  p[4] = { x: ox - gap / 2 * scale, y: oy - 0.12 * scale, z: 0 };  // thumb tip
  p[8] = { x: ox + gap / 2 * scale, y: oy - 0.12 * scale, z: 0 };  // index tip
  return p;
}

test('pinch ratio is independent of hand size / distance', () => {
  const a = pinchRatio(hand(0.09), null);
  const b = pinchRatio(hand(0.09, { scale: 0.5 }), null);
  assert.ok(Math.abs(a - b) < 1e-9);
  // with both world (3D) and image (2D) landmarks, the two ratios are averaged
  assert.ok(Math.abs(pinchRatio(hand(0.9), hand(0.045), 1) - (10 + 0.5) / 2) < 1e-9);
  // image landmarks only
  assert.ok(Math.abs(pinchRatio(null, hand(0.045), 1) - 0.5) < 1e-9);
});

test('pinch detector: fast close, hysteresis, release only after 4 clearly-open frames', () => {
  const d = new PinchDetector({ close: 0.3, open: 0.45 });
  assert.equal(d.update(0.8), false);
  assert.equal(d.update(0.35), false);  // between thresholds, stays open
  d.reset();
  assert.equal(d.update(0.25), true);   // closes on the first frame below "close"
  assert.equal(d.update(0.40), true);   // between thresholds, stays closed
  assert.equal(d.update(0.9), true);    // a single open-looking frame (flicker) does not release
  assert.equal(d.update(0.2), true);
  assert.equal(d.update(0.9), true);    // open frame 1
  assert.equal(d.update(0.9), true);    // open frame 2
  assert.equal(d.update(0.9), true);    // open frame 3
  assert.equal(d.update(0.9), false);   // open frame 4 -> released
  assert.equal(d.update(null), false);  // missing value keeps state
});

test('calibrated thresholds sit between pinch and open; sensitivity scales them', () => {
  const t = pinchThresholds({ open: 1.0, pinch: 0.1 }, 5);
  assert.ok(Math.abs(t.close - 0.55) < 1e-9 && Math.abs(t.open - 0.775) < 1e-9);
  const hi = pinchThresholds({ open: 1.0, pinch: 0.1 }, 10);
  const lo = pinchThresholds({ open: 1.0, pinch: 0.1 }, 1);
  assert.ok(hi.close > t.close && lo.close < t.close);
  assert.deepEqual(pinchThresholds(null, 5), DEFAULT_PINCH);
});

test('pointer is the palm centre, mirrored, and does not move when the fingers pinch', () => {
  const open = cursorFromLandmarks(hand(0.1, { ox: 0.2, oy: 0.6 }));
  assert.ok(Math.abs(open.u - 0.8) < 1e-9);                    // mirrored
  assert.ok(Math.abs(open.v - (0.6 - 0.09 / 5)) < 1e-9);       // mean of wrist + 4 knuckles
  const pinched = cursorFromLandmarks(hand(0.0, { ox: 0.2, oy: 0.6 }));
  assert.deepEqual(pinched, open, 'closing the fingers does not move the pointer');
});

test('selectHand picks the tested hand and can invert labels', () => {
  const res = {
    landmarks: [hand(0.1), hand(0.02)],
    worldLandmarks: [null, null],
    handedness: [[{ categoryName: 'Left', score: 0.9 }], [{ categoryName: 'Right', score: 0.8 }]],
  };
  assert.equal(selectHand(res, 'right').hand.index, 1);
  assert.equal(selectHand(res, 'left').hand.index, 0);
  assert.equal(selectHand(res, 'right', true).hand.index, 0);
  assert.equal(selectHand({ landmarks: [] }, 'right').hand, null);
  // A single hand with the "wrong" label is used only when allowSingle is on.
  const one = { landmarks: [hand(0.1)], handedness: [[{ categoryName: 'Left', score: 0.9 }]] };
  assert.equal(selectHand(one, 'right').hand, null);
  assert.equal(selectHand(one, 'right', false, true).hand.assumed, true);
});

test('hand continuity follows the hand near the last wrist position', () => {
  const near = { image: hand(0.1, { ox: 0.30, oy: 0.5 }) };   // mirrored wrist u = 0.70
  const far = { image: hand(0.1, { ox: 0.80, oy: 0.5 }) };    // mirrored wrist u = 0.20
  assert.equal(nearestHand([far, near], { u: 0.68, v: 0.52 }), near);
  assert.equal(nearestHand([far], { u: 0.68, v: 0.52 }), null, 'too far away: not the same hand');
});

test('median and percentile', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(percentile([0, 10], 0.5), 5);
  assert.equal(median([]), null);
});

test('One Euro filter smooths jitter but follows real movement', () => {
  const f = new OneEuroFilter(1.0, 4.0);
  let out; let maxDev = 0;
  for (let i = 0; i < 60; i++) {           // still hand + 1 % jitter at 30 fps
    out = f.filter(0.5 + (i % 2 ? 0.01 : -0.01), i / 30);
    if (i > 10) maxDev = Math.max(maxDev, Math.abs(out - 0.5));
  }
  assert.ok(maxDev < 0.006, `jitter reduced (max deviation ${maxDev})`);
  for (let i = 60; i < 75; i++) out = f.filter(0.5 + (i - 59) * 0.02, i / 30);  // fast move
  const target = 0.5 + 15 * 0.02;
  assert.ok(target - out < 0.08, `lag stays small (${(target - out).toFixed(3)})`);
});
