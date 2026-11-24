// Unit tests for the webcam hand-tracking maths and the One Euro filter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pinchRatio, cursorFromLandmarks, PinchDetector, pinchThresholds, selectHand, DEFAULT_PINCH, median, percentile,
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
  // world landmarks preferred when given
  assert.ok(Math.abs(pinchRatio(hand(0.9), hand(0.045)) - 10) < 1e-9);
});

test('pinch detector uses hysteresis', () => {
  const d = new PinchDetector({ close: 0.3, open: 0.45 });
  assert.equal(d.update(0.8), false);
  assert.equal(d.update(0.35), false);  // between thresholds, stays open
  assert.equal(d.update(0.25), true);   // closes
  assert.equal(d.update(0.40), true);   // between thresholds, stays closed
  assert.equal(d.update(0.50), false);  // opens
  assert.equal(d.update(null), false);  // missing value keeps state
});

test('calibrated thresholds sit between pinch and open; sensitivity scales them', () => {
  const t = pinchThresholds({ open: 1.0, pinch: 0.1 }, 5);
  assert.ok(Math.abs(t.close - 0.415) < 1e-9 && Math.abs(t.open - 0.595) < 1e-9);
  const hi = pinchThresholds({ open: 1.0, pinch: 0.1 }, 10);
  const lo = pinchThresholds({ open: 1.0, pinch: 0.1 }, 1);
  assert.ok(hi.close > t.close && lo.close < t.close);
  assert.deepEqual(pinchThresholds(null, 5), DEFAULT_PINCH);
});

test('cursor is the thumb-index midpoint, mirrored horizontally', () => {
  const c = cursorFromLandmarks(hand(0.1, { ox: 0.2, oy: 0.6 }));
  assert.ok(Math.abs(c.u - 0.8) < 1e-9);
  assert.ok(Math.abs(c.v - 0.48) < 1e-9);
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
