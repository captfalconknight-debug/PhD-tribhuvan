// Unit tests for the hand avatar geometry (drawing itself needs a browser).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { templateHand, handOffsets, AVATAR_PALM_CM } from '../avatar.js';

const palmLen = (p) => Math.hypot(p[0].x - p[9].x, p[0].y - p[9].y);
const pinchMid = (p) => ({ x: (p[4].x + p[8].x) / 2, y: (p[4].y + p[8].y) / 2 });

test('template hand: 21 points, pinch point at the cursor, fingers close when pinching', () => {
  const open = templateHand(0); const shut = templateHand(1);
  assert.equal(open.length, 21);
  for (const h of [open, shut]) {
    const m = pinchMid(h);
    assert.ok(Math.abs(m.x) < 1e-9 && Math.abs(m.y) < 1e-9, 'pinch point is the origin (cursor)');
    assert.ok(Math.abs(palmLen(h) - AVATAR_PALM_CM) < 1e-9);
  }
  const gap = (h) => Math.hypot(h[4].x - h[8].x, h[4].y - h[8].y);
  assert.ok(gap(shut) < 0.2 * gap(open), 'thumb and index tips meet when pinched');
  // Left hand is the mirror image.
  assert.ok(Math.abs(templateHand(0, 'left')[4].x + open[4].x) < 1e-9);
});

test('tracked hand: every landmark is used, fixed palm size, mirrored, y up', () => {
  const lm = Array.from({ length: 21 }, (_, i) => ({ x: 0.5 + 0.01 * (i % 5), y: 0.6 - 0.01 * i, z: 0 }));
  lm[0] = { x: 0.5, y: 0.7, z: 0 }; lm[9] = { x: 0.5, y: 0.55, z: 0 };
  lm[4] = { x: 0.45, y: 0.5, z: 0 }; lm[8] = { x: 0.47, y: 0.45, z: 0 };
  const h = handOffsets(lm, 1, (x) => 1 - x);
  assert.equal(h.length, 21);
  assert.ok(Math.abs(palmLen(h) - AVATAR_PALM_CM) < 1e-9, 'scaled to a fixed palm size');
  const m = pinchMid(h);
  assert.ok(Math.abs(m.x) < 1e-9 && Math.abs(m.y) < 1e-9);
  assert.ok(h[9].y > h[0].y, 'knuckles above the wrist (y up)');
  assert.ok(h[4].x > 0 === (1 - lm[4].x > 1 - lm[8].x), 'mirrored horizontally');
});
