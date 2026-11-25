// Unit tests for engine.js. Run with:  node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VBBTEngine, BOX, GEOM, gridLeft, rowZ } from '../engine.js';

const S = BOX.block;
const FPS = 60;

/** A tiny driver that feeds the engine hand samples at 60 Hz. */
function makeSim(opts = {}) {
  const e = new VBBTEngine({ testedHand: 'right', ...opts });
  const sim = {
    e, t: 0, x: 40, y: 20, pinch: false,
    step(present = true) {
      sim.t += 1 / FPS;
      e.update(sim.t, { present, x: sim.x, y: sim.y, pinch: sim.pinch });
    },
    /** Move linearly to (x, y) over n frames with the given pinch state. */
    go(x, y, pinch, n = 10) {
      const x0 = sim.x; const y0 = sim.y;
      for (let i = 1; i <= n; i++) {
        sim.x = x0 + (x - x0) * i / n; sim.y = y0 + (y - y0) * i / n; sim.pinch = pinch;
        sim.step();
      }
    },
    wait(n, present = true) { for (let i = 0; i < n; i++) sim.step(present); },
  };
  sim.wait(2);
  return sim;
}

function topBlock(e, side) {
  return e.blocks
    .filter((b) => b.state === 'rest' && e.sideOf(b) === side && !e.isCovered(b))
    .sort((a, b) => b.y - a.y || a.x - b.x)[0];
}

/** Scripted participant: pick up from `fromSide`, lift over the partition, drop at x = toX. */
function carry(sim, fromSide, toX) {
  const b = topBlock(sim.e, fromSide);
  assert.ok(b, 'there should be a block to pick up');
  const cx = b.x + S / 2; const cy = b.y + S / 2;
  sim.go(cx, cy, false, 8);
  sim.go(cx, cy, true, 2);
  assert.equal(sim.e.held?.id, b.id, 'block should be grasped');
  sim.go(cx, 22, true, 8);
  sim.go(toX, 22, true, 12);
  sim.go(toX, 12, true, 4);
  sim.go(toX, 12, false, 2);
  sim.wait(20);
  return b;
}
const targetX = (i) => gridLeft('left') + (i % BOX.cols) * S + S / 2;   // tested hand right → target left
const sourceX = (i) => gridLeft('right') + (i % BOX.cols) * S + S / 2;

test('initial state: 30 visible source blocks, 150 in total, score 0', () => {
  const e = new VBBTEngine({ testedHand: 'right' });
  assert.equal(e.sourceSide, 'right');
  assert.equal(e.targetSide, 'left');
  assert.equal(e.blocks.length, 30);
  assert.equal(e.totalBlocks(), 150);
  assert.equal(e.score(), 0);
  const l = new VBBTEngine({ testedHand: 'left' });
  assert.equal(l.sourceSide, 'left');
  assert.ok(l.blocks.every((b) => l.sideOf(b) === 'left'));
});

test('scripted agent: score equals the number of transfers', () => {
  const sim = makeSim({ duration: 1000 });
  for (let i = 0; i < 12; i++) carry(sim, 'right', targetX(i));
  assert.equal(sim.e.c.transfers, 12);
  assert.equal(sim.e.score(), 12);
  const s = sim.e.summary();
  assert.equal(s.successfulGrasps, 12);
  assert.equal(s.missedGrasps, 0);
  assert.ok(s.cycleTimeMean > 0 && s.carryPathMean > 0 && s.carrySpeedMean > 0 && s.peakSpeed > 0);
  assert.ok(s.clearanceMean > 0, 'blocks were carried above the partition');
});

test('60 s trial ends on time and score equals transfers', () => {
  const sim = makeSim();
  let i = 0;
  while (!sim.e.finished && i < 200) {
    const b = topBlock(sim.e, 'right');
    if (!b) break;
    carry(sim, 'right', targetX(i++));
  }
  assert.ok(sim.e.finished);
  const s = sim.e.summary();
  assert.equal(s.duration, 60);
  assert.equal(s.score, sim.e.c.transfers);
  assert.ok(s.score > 40, `expected many transfers, got ${s.score}`);
});

test('a held block cannot tunnel through the partition when held low', () => {
  const sim = makeSim();
  const b = topBlock(sim.e, 'right');
  sim.go(b.x + S / 2, b.y + S / 2, false, 5);
  sim.go(b.x + S / 2, b.y + S / 2, true, 2);
  assert.equal(sim.e.held.id, b.id);
  // One huge jump across the partition at low height (a teleport between frames)...
  sim.x = 5; sim.y = 4; sim.step();
  assert.ok(b.x >= GEOM.partitionX1 - 1e-9, `block x=${b.x} should stay right of the partition`);
  // ...and a slow drag along the floor.
  sim.go(3, 4, true, 120);
  assert.ok(b.x >= GEOM.partitionX1 - 1e-9);
  assert.equal(sim.e.sideOf(b), 'right');
  // Lifting above the partition then lets it pass.
  sim.go(3, 25, true, 30);
  assert.equal(sim.e.sideOf(b), 'left');
  assert.ok(b.y >= GEOM.partitionTop, 'it must have been lifted over the top');
});

test('block released over the target side counts while still falling', () => {
  const sim = makeSim();
  const b = topBlock(sim.e, 'right');
  sim.go(b.x + S / 2, b.y + S / 2, false, 5);
  sim.go(b.x + S / 2, b.y + S / 2, true, 2);
  sim.go(b.x + S / 2, 25, true, 10);
  sim.go(10, 25, true, 10);
  sim.pinch = false; sim.step();
  assert.equal(b.state, 'fall');
  assert.equal(sim.e.score(), 1);
});

test('a block released on the partition top slides off to the side of its centre', () => {
  for (const [offset, expectSide] of [[0.4, 'right'], [-0.4, 'left']]) {
    const sim = makeSim();
    const b = topBlock(sim.e, 'right');
    sim.go(b.x + S / 2, b.y + S / 2, false, 5);
    sim.go(b.x + S / 2, b.y + S / 2, true, 2);
    sim.go(b.x + S / 2, 25, true, 10);
    sim.go(GEOM.partitionMid + offset, 25, true, 10);
    sim.go(GEOM.partitionMid + offset, GEOM.partitionTop + S / 2 + 0.3, true, 10);
    sim.go(GEOM.partitionMid + offset, GEOM.partitionTop + S / 2 + 0.3, false, 1);
    sim.wait(90);
    assert.ok(sim.e.events.some((ev) => ev.type === 'partition_slide'), 'should slide');
    assert.equal(b.state, 'rest');
    assert.equal(sim.e.sideOf(b), expectSide);
    assert.ok(b.y < GEOM.partitionTop, 'should end up inside a compartment');
    assert.ok(b.x + S <= GEOM.partitionX0 + 1e-9 || b.x >= GEOM.partitionX1 - 1e-9);
    assert.equal(sim.e.score(), expectSide === 'left' ? 1 : 0);
  }
});

test('returning a block to the source side reduces the score', () => {
  const sim = makeSim();
  carry(sim, 'right', targetX(0));
  carry(sim, 'right', targetX(3));
  assert.equal(sim.e.score(), 2);
  carry(sim, 'left', sourceX(4));
  assert.equal(sim.e.score(), 1);
  const s = sim.e.summary();
  assert.equal(s.returns, 1);
  assert.equal(s.transfers, 2);
});

test('releasing on the source side is a failed release; empty pinch is a missed grasp', () => {
  const sim = makeSim();
  sim.go(45, 30, false, 5);
  sim.go(45, 30, true, 2);    // nothing within reach
  sim.go(45, 30, false, 2);
  carry(sim, 'right', sourceX(8));
  const s = sim.e.summary();
  assert.equal(s.missedGrasps, 1);
  assert.equal(s.graspAttempts, 2);
  assert.equal(s.failedReleases, 1);
  assert.equal(s.score, 0);
});

test('tracking loss: holds for 500 ms, then force-releases and logs it', () => {
  const sim = makeSim();
  const b = topBlock(sim.e, 'right');
  sim.go(b.x + S / 2, b.y + S / 2, false, 5);
  sim.go(b.x + S / 2, b.y + S / 2, true, 2);
  sim.go(b.x + S / 2, 25, true, 10);

  sim.wait(27, false);           // 450 ms lost: still held
  assert.equal(sim.e.held?.id, b.id);
  sim.wait(3);                   // tracking restored
  assert.equal(sim.e.held?.id, b.id);

  sim.wait(36, false);           // 600 ms lost: force release at ~500 ms
  assert.equal(sim.e.held, null);
  const forced = sim.e.events.find((ev) => ev.type === 'forced_release');
  assert.ok(forced, 'forced release logged');
  sim.wait(5);
  const s = sim.e.summary();
  assert.equal(s.forcedReleases, 1);
  assert.equal(s.trackingLossEpisodes, 2);
  assert.ok(Math.abs(s.trackingLostTime - 1.05) < 0.03, `lost time ${s.trackingLostTime}`);
  assert.ok(sim.e.events.filter((ev) => ev.type === 'tracking_lost').length === 2);
});

test('a block still in the hand at 60 s is not counted', () => {
  const sim = makeSim({ duration: 5 });
  carry(sim, 'right', targetX(0));
  const b = topBlock(sim.e, 'right');
  sim.go(b.x + S / 2, b.y + S / 2, false, 5);
  sim.go(b.x + S / 2, b.y + S / 2, true, 2);
  sim.go(10, 25, true, 20);
  while (!sim.e.finished) sim.step();
  assert.equal(sim.e.summary().score, 1);
});

test('fold/respawn accounting: never more than 150 blocks, hidden counts scored', () => {
  const sim = makeSim({ duration: 10000 });
  let maxVisTarget = 0;
  for (let i = 0; i < 200; i++) {
    if (!topBlock(sim.e, 'right')) break;
    carry(sim, 'right', targetX(i * 3));
    assert.equal(sim.e.totalBlocks(), 150, 'total must stay 150');
    const tgt = sim.e.blocks.filter((b) => sim.e.sideOf(b) === 'left');
    maxVisTarget = Math.max(maxVisTarget, ...tgt.map((b) => b.y));
    assert.equal(sim.e.score(), sim.e.c.transfers);
    if (i === 20) {
      const vis = sim.e.blocks.filter((b) => sim.e.sideOf(b) === 'right' && b.state === 'rest').length;
      assert.equal(vis, 30, 'source pile is refilled from the reserve');
    }
  }
  assert.ok(maxVisTarget < BOX.layers * S, 'no visible 4th layer on the target side');
  assert.ok(sim.e.targetHidden > 0, 'some blocks were folded out of view');
  assert.equal(sim.e.reserve, 0);
  // All 150 blocks were eventually transferred.
  assert.equal(sim.e.score(), 150);
  assert.equal(sim.e.summary().score, 150);
});

test('returned blocks stacking in a 4th source layer go back to the reserve', () => {
  const sim = makeSim({ duration: 1000 });
  for (let i = 0; i < 3; i++) carry(sim, 'right', targetX(5));
  // Drop them back onto the full source pile at one spot.
  for (let i = 0; i < 3; i++) carry(sim, 'left', sourceX(2));
  assert.equal(sim.e.totalBlocks(), 150);
  assert.equal(sim.e.score(), 0);
  assert.ok(sim.e.events.some((ev) => ev.type === 'fold_source'));
});

test('raw samples and event log are recorded', () => {
  const sim = makeSim();
  carry(sim, 'right', targetX(1));
  const e = sim.e;
  assert.ok(e.samples.length > 50);
  const s = e.samples[e.samples.length - 1];
  for (const k of ['t', 'x', 'y', 'pinch', 'held', 'present']) assert.ok(k in s);
  const types = e.events.map((ev) => ev.type);
  for (const k of ['grab', 'release', 'transfer']) assert.ok(types.includes(k), k);
});

// ============================== 3D view ==============================


/** 3D scripted participant: grab whatever block the rules give at the top of the pile. */
function carry3d(sim, fromSide, toX) {
  const e = sim.e;
  const b = topBlock(e, fromSide);
  assert.ok(b, 'there should be a block to pick up');
  const cx = b.x + S / 2; const cy = b.y + S / 2;
  sim.go(cx, cy, false, 8);
  sim.go(cx, cy, true, 2);
  const held = e.held;
  assert.ok(held, 'a block should be grasped');
  sim.go(cx, 22, true, 8);
  sim.go(toX, 22, true, 12);
  sim.go(toX, 12, true, 4);
  sim.go(toX, 12, false, 2);
  sim.wait(25);
  return held;
}

test('3D: all 150 blocks are visible in the source compartment, none hidden', () => {
  const e = new VBBTEngine({ testedHand: 'right', mode: '3d' });
  assert.equal(e.blocks.length, 150);
  assert.equal(e.reserve, 0);
  assert.equal(e.totalBlocks(), 150);
  assert.ok(e.blocks.every((b) => e.sideOf(b) === 'right'));
  assert.equal(e.blocks.filter((b) => b.y === 0).length, 90, 'bottom layer 10 x 9');
  assert.equal(e.blocks.filter((b) => b.y === S).length, 60, 'second layer');
  // The pile is the same for every participant.
  const e2 = new VBBTEngine({ testedHand: 'right', mode: '3d' });
  assert.deepEqual(e.blocks.map((b) => [b.x, b.y, b.row]), e2.blocks.map((b) => [b.x, b.y, b.row]));
  assert.ok(rowZ(BOX.rows - 1) + S <= BOX.depth - BOX.wall + 1e-9, 'rows fit inside the box depth');
});

test('3D: grasp takes the top block, front-most row on a tie', () => {
  const e = new VBBTEngine({ testedHand: 'right', mode: '3d' });
  const top = e.blocks.filter((b) => b.y === S);
  const col = top[0].x;
  const sameCol = top.filter((b) => b.x === col).sort((a, b) => a.row - b.row);
  const c = e.grabCandidate(col + S / 2, S + S / 2);
  assert.equal(c.id, sameCol[0].id);
});

test('3D: score equals transfers; blocks spread over depth rows; 150 can be moved', () => {
  const sim = makeSim({ mode: '3d', duration: 10000 });
  for (let i = 0; i < 160; i++) {
    if (!topBlock(sim.e, 'right')) break;
    carry3d(sim, 'right', targetX(i * 7));
    assert.equal(sim.e.score(), sim.e.c.transfers);
    assert.equal(sim.e.totalBlocks(), 150);
  }
  assert.equal(sim.e.score(), 150);
  const rows = new Set(sim.e.blocks.map((b) => b.row));
  assert.equal(rows.size, BOX.rows, 'target pile uses all depth rows');
  const maxY = Math.max(...sim.e.blocks.map((b) => b.y));
  assert.ok(maxY <= 2 * S + 1e-9, `blocks are spread, not stacked in towers (max y ${maxY})`);
});

test('3D: no tunnelling through the partition; returns reduce the score', () => {
  const sim = makeSim({ mode: '3d' });
  const b = topBlock(sim.e, 'right');
  sim.go(b.x + S / 2, b.y + S / 2, false, 5);
  sim.go(b.x + S / 2, b.y + S / 2, true, 2);
  const held = sim.e.held;
  sim.x = 5; sim.y = 4; sim.step();
  sim.go(3, 4, true, 60);
  assert.ok(held.x >= GEOM.partitionX1 - 1e-9);
  sim.go(3, 4, false, 2); sim.wait(20);
  carry3d(sim, 'right', targetX(0));
  carry3d(sim, 'right', targetX(4));
  carry3d(sim, 'left', sourceX(5));
  const s = sim.e.summary();
  assert.equal(s.score, 1);
  assert.equal(s.returns, 1);
});

test('grab window: a block reached within 0.3 s of pinching is caught; later is a missed grasp', () => {
  const sim = makeSim();
  const b = topBlock(sim.e, 'right');
  const cx = b.x + S / 2; const cy = b.y + S / 2;
  sim.go(cx, cy + 6, false, 5);        // above the pile, out of reach
  sim.go(cx, cy + 6, true, 1);          // pinch closes here (nothing in reach)
  sim.go(cx, cy, true, 10);             // arrives on the block within ~0.17 s
  assert.ok(sim.e.held, 'block caught within the grab window');
  assert.equal(sim.e.summary().missedGrasps, 0);
  sim.go(10, 25, true, 20); sim.go(10, 25, false, 5); sim.wait(20);

  const b2 = topBlock(sim.e, 'right');
  sim.go(b2.x + S / 2, b2.y + S / 2 + 6, false, 5);
  sim.go(b2.x + S / 2, b2.y + S / 2 + 6, true, 1);
  sim.wait(30);                          // 0.5 s pinched in empty space
  sim.go(b2.x + S / 2, b2.y + S / 2, true, 5);
  assert.equal(sim.e.held, null, 'too late: no grab without a new pinch');
  const s = sim.e.summary();
  assert.equal(s.graspAttempts, 2);
  assert.equal(s.successfulGrasps, 1);
  assert.equal(s.missedGrasps, 1);
});

test('a picked block snaps to the pinch point; the snap is not counted as carry path', () => {
  const sim = makeSim();
  const b = topBlock(sim.e, 'right');
  const cx = b.x + S / 2 + 0.8; const cy = b.y + S / 2 + 0.6;   // pinch slightly off-centre
  sim.go(cx, cy, false, 5);
  sim.go(cx, cy, true, 3);
  assert.equal(sim.e.held?.id, b.id);
  assert.ok(Math.abs(b.x + S / 2 - cx) < 1e-6 && Math.abs(b.y + S / 2 - cy) < 1e-6, 'block centre at the pinch point');
  assert.ok(sim.e.carry.path < 1e-9, 'snap not counted');
});
