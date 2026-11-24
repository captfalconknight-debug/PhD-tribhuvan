/**
 * engine.js — Virtual Box and Block Test (VBBT) game engine.
 *
 * This module contains ONLY the rules, physics, scoring and kinematic
 * metrics. It has no DOM / browser code, so it can be unit-tested in Node.
 *
 * Coordinate system (front view of the box, all units in CENTIMETRES):
 *   x = 0 at the outer left edge of the box, increasing to the right.
 *   y = 0 at the floor of the box, increasing UPWARDS.
 *   A block is a square of side BOX.block; (x, y) is its BOTTOM-LEFT corner.
 *
 * Time is in SECONDS since the start of the trial.
 *
 * The app feeds one hand sample per frame via update(t, input), where
 *   input = { present: bool, x: cm, y: cm, pinch: bool }
 */

/** Standard Box and Block Test dimensions (cm) and simulation constants. */
export const BOX = Object.freeze({
  width: 53.7,              // outer box length (left–right)
  depth: 25.4,              // front-to-back; used by the 3D view only
  height: 8.5,              // height of the box walls
  wall: 0.8,                // wall thickness (simulation assumption)
  partitionHeight: 15.2,    // partition top, measured from the box floor
  partitionThickness: 1.0,  // simulation assumption
  block: 2.5,               // block edge length
  totalBlocks: 150,
  cols: 10,                 // columns of blocks per compartment (left-right)
  layers: 3,                // 2D view: layers drawn per compartment
  rows: 9,                  // 3D view: rows of blocks per compartment (front-back)
});

/** Default simulation parameters (can be overridden per engine). */
export const DEFAULTS = Object.freeze({
  duration: 60,             // seconds
  grabRadius: 3.0,          // cm, cursor-to-block-centre distance allowed for a grasp
  lossGraceMs: 500,         // keep holding a block this long after tracking is lost
  gravity: 981,             // cm/s^2
  slideSpeed: 40,           // cm/s, speed at which a block slides off the partition top
  ceiling: 34,              // cm, highest point a held block can be lifted to
  speedWindow: 0.1,         // s, window used to estimate hand/block speed
});

const EPS = 1e-6;

// ---- Derived geometry -------------------------------------------------------
const S = BOX.block;
export const GEOM = Object.freeze({
  innerLeft: BOX.wall,
  innerRight: BOX.width - BOX.wall,
  partitionX0: (BOX.width - BOX.partitionThickness) / 2,
  partitionX1: (BOX.width + BOX.partitionThickness) / 2,
  partitionMid: BOX.width / 2,
  partitionTop: BOX.partitionHeight,
});

/** Left edge x of the visible grid of 10 columns in a compartment. */
export function gridLeft(side) {
  const x0 = side === 'left' ? GEOM.innerLeft : GEOM.partitionX1;
  const x1 = side === 'left' ? GEOM.partitionX0 : GEOM.innerRight;
  return x0 + ((x1 - x0) - BOX.cols * S) / 2;
}

/**
 * 3D view: depth (z) of the front face of a block in a given row.
 * z = 0 at the outer front edge of the box, increasing away from the viewer.
 * Inner depth 25.4 - 2 x 0.8 = 23.8 cm holds 9 rows of 2.5 cm, centred.
 */
export const Z_FRONT = BOX.wall + ((BOX.depth - 2 * BOX.wall) - BOX.rows * S) / 2;
export function rowZ(row) { return Z_FRONT + row * S; }

/** Small deterministic random generator (mulberry32) so every participant gets the same pile. */
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Which compartment a block belongs to, judged by the x of its centre. */
export function sideOfX(centreX) {
  return centreX > GEOM.partitionMid ? 'right' : 'left';
}

function overlap1D(a0, a1, b0, b1) {
  return Math.min(a1, b1) - Math.max(a0, b0) > EPS;
}

function rectsOverlap(ax, ay, bx, by) {
  return overlap1D(ax, ax + S, bx, bx + S) && overlap1D(ay, ay + S, by, by + S);
}

/** Does a block at (x, y) intersect the partition? */
function hitsPartition(x, y) {
  return overlap1D(x, x + S, GEOM.partitionX0, GEOM.partitionX1) && y < GEOM.partitionTop - EPS;
}

function mean(a) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : null; }
function sd(a) {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}
const r3 = (v) => (v == null ? v : Math.round(v * 1000) / 1000);

export class VBBTEngine {
  /**
   * @param {object} opts
   * @param {'left'|'right'} opts.testedHand  hand being tested; its side is the source compartment
   * @param {number} [opts.duration]          trial length in seconds (60 test / 15 practice)
   * @param {'2d'|'3d'} [opts.mode]           '2d' = front view with 3 visible layers and a hidden
   *                                           reserve; '3d' = all 150 blocks in a real pile, 9 rows deep
   */
  constructor(opts = {}) {
    this.p = { ...DEFAULTS, ...opts };
    this.mode = opts.mode === '3d' ? '3d' : '2d';
    this.rows = this.mode === '3d' ? BOX.rows : 1;
    this.testedHand = opts.testedHand === 'left' ? 'left' : 'right';
    this.sourceSide = this.testedHand;                          // pick up on the tested-hand side
    this.targetSide = this.sourceSide === 'left' ? 'right' : 'left';

    this.blocks = [];              // all VISIBLE blocks (resting, falling, sliding or held)
    this.nextId = 1;
    this.reserve = BOX.totalBlocks; // hidden blocks "deeper" in the source pile
    this.targetHidden = 0;          // blocks folded out of view in the target pile (still scored)

    if (this.mode === '3d') {
      // 3D: all 150 blocks are visible. Bottom layer full (10 columns x 9 rows = 90);
      // the other 60 are on top of randomly chosen (but always the same) positions.
      for (let row = 0; row < BOX.rows; row++) {
        for (let col = 0; col < BOX.cols; col++) this.spawn(col, 0, 'rest', row);
      }
      const rnd = seededRandom(150);
      const slots = [];
      for (let row = 0; row < BOX.rows; row++) for (let col = 0; col < BOX.cols; col++) slots.push([col, row]);
      for (let i = slots.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [slots[i], slots[j]] = [slots[j], slots[i]]; }
      for (const [col, row] of slots.slice(0, BOX.totalBlocks - BOX.cols * BOX.rows)) this.spawn(col, 1, 'rest', row);
    } else {
      // 2D: fill the visible source pile, 3 layers x 10 columns.
      for (let layer = 0; layer < BOX.layers; layer++) {
        for (let col = 0; col < BOX.cols; col++) this.spawn(col, layer, 'rest');
      }
    }

    this.t = 0;
    this.lastT = 0;
    this.finished = false;
    this.held = null;               // block currently held
    this.carry = null;              // running measurements of the current carry
    this.prevPinch = false;
    this.cursor = null;             // last known cursor {x, y}
    this.trackingPresent = true;    // trial only starts once a hand is detected
    this.lostSince = null;

    this.events = [];
    this.samples = [];
    this.carries = [];              // completed carries (one per release)
    this.c = {                      // counters
      graspAttempts: 0, successfulGrasps: 0, missedGrasps: 0,
      transfers: 0, failedReleases: 0, returns: 0, repositions: 0,
      forcedReleases: 0, lossEpisodes: 0, lostTime: 0,
    };
    this.transferTimes = [];
  }

  // ---------------------------------------------------------------------------
  // Block bookkeeping
  // ---------------------------------------------------------------------------

  /** Move one block from the hidden reserve into a grid slot of the source pile. */
  spawn(col, layer, state = 'fall', row = 0) {
    const b = {
      id: this.nextId++,
      x: gridLeft(this.sourceSide) + col * S,
      y: layer * S,
      row,            // depth row (always 0 in the 2D view)
      vy: 0,
      state,          // 'fall' = settles onto whatever is below on the next physics step
      dir: 0,
    };
    this.reserve--;
    this.blocks.push(b);
    return b;
  }

  removeBlock(b) {
    this.blocks.splice(this.blocks.indexOf(b), 1);
  }

  sideOf(b) { return sideOfX(b.x + S / 2); }

  /** Is there a block lying directly on top of b? */
  isCovered(b) {
    return this.blocks.some((o) => o !== b && o.state !== 'held' && o.row === b.row &&
      Math.abs(o.y - (b.y + S)) < 0.01 && overlap1D(o.x, o.x + S, b.x, b.x + S));
  }

  /**
   * Nearest uncovered resting block whose centre is within the grab radius of (x, y).
   * Distance is measured in the left-right / up-down plane that the hand controls.
   * 3D view: blocks at the same left-right position and height in different depth
   * rows are equally near; the one closest to the front is taken.
   */
  grabCandidate(x = this.cursor?.x, y = this.cursor?.y) {
    if (x == null || this.held) return null;
    let best = null; let bestD = Infinity;
    for (const b of this.blocks) {
      if (b.state !== 'rest') continue;
      const d = Math.hypot(b.x + S / 2 - x, b.y + S / 2 - y);
      if (d > this.p.grabRadius + EPS) continue;
      const key = d + b.row * 1e-4;            // tie-break: front-most row
      if (key < bestD && !this.isCovered(b)) { best = b; bestD = key; }
    }
    return best;
  }

  /** Height of the highest block under a block-wide footprint at x in a given row. */
  stackTop(x, row, except = null) {
    let top = 0;
    for (const o of this.blocks) {
      if (o === except || o.state === 'held' || o.row !== row) continue;
      if (overlap1D(x, x + S, o.x, o.x + S)) top = Math.max(top, o.y + S);
    }
    return top;
  }

  /**
   * 3D view: the depth row a block at x will drop into = the row with the lowest
   * stack at that position (ties: the row nearest its current row, then the front).
   * This automatic depth placement replaces reaching forwards/backwards, which a
   * single webcam cannot measure reliably. 2D view: always row 0.
   */
  landingRow(b) {
    if (this.rows === 1) return 0;
    let best = b.row; let bestKey = Infinity;
    for (let r = 0; r < this.rows; r++) {
      const key = this.stackTop(b.x, r, b) * 1000 + Math.abs(r - b.row) * 10 + r * 0.01;
      if (key < bestKey) { bestKey = key; best = r; }
    }
    return best;
  }

  /** Net score: blocks on the target side (visible, not in the hand) + folded hidden blocks. */
  score() {
    let n = this.targetHidden;
    for (const b of this.blocks) if (b.state !== 'held' && this.sideOf(b) === this.targetSide) n++;
    return n;
  }

  /** Count of all blocks in the simulation (must always equal 150). */
  totalBlocks() { return this.blocks.length + this.reserve + this.targetHidden; }

  log(type, extra = {}) { this.events.push({ t: r3(this.t), type, ...extra }); }

  // ---------------------------------------------------------------------------
  // Main update — call once per frame with the latest hand sample.
  // ---------------------------------------------------------------------------

  update(t, input) {
    if (this.finished) return;
    const end = this.p.duration;
    const tc = Math.min(t, end);
    const dt = Math.max(0, Math.min(0.1, tc - this.lastT));  // cap: never simulate >100 ms at once
    this.t = tc;
    this.lastT = tc;

    // 1) Tracking status ------------------------------------------------------
    let justRestored = false;
    if (!input.present) {
      if (this.trackingPresent) {
        this.trackingPresent = false;
        this.lostSince = tc;
        this.c.lossEpisodes++;
        this.log('tracking_lost');
      }
      // Grace period: keep holding up to lossGraceMs, then force a release.
      if (this.held && (tc - this.lostSince) * 1000 >= this.p.lossGraceMs - EPS) {
        this.release(true);
      }
    } else {
      if (!this.trackingPresent) {
        this.trackingPresent = true;
        this.c.lostTime += tc - this.lostSince;
        this.log('tracking_restored', { lostFor: r3(tc - this.lostSince) });
        this.lostSince = null;
        justRestored = true;
      }
      this.cursor = { x: input.x, y: input.y };

      // 2) Pinch edges: closing = grasp attempt, opening = release ------------
      if (input.pinch && !this.prevPinch && !this.held) this.tryGrab();
      else if (!input.pinch && this.prevPinch && this.held) this.release(false);
      this.prevPinch = !!input.pinch;

      // 3) Carry the held block toward the cursor (with partition collision) --
      if (this.held) this.moveHeld(dt, justRestored);
    }

    // 4) Physics for released blocks, then keep the source pile topped up -----
    this.physics(dt);
    this.refillSource();

    // 5) Raw sample -------------------------------------------------------------
    this.samples.push({
      t: r3(tc),
      x: input.present ? r3(input.x) : null,
      y: input.present ? r3(input.y) : null,
      pinch: input.present ? (input.pinch ? 1 : 0) : null,
      held: this.held ? this.held.id : null,
      present: input.present ? 1 : 0,
    });

    if (tc >= end - EPS) this.finish();
  }

  tryGrab() {
    this.c.graspAttempts++;
    const b = this.grabCandidate(this.cursor.x, this.cursor.y);
    if (!b) {
      this.c.missedGrasps++;
      this.log('grasp_missed', { x: r3(this.cursor.x), y: r3(this.cursor.y) });
      return;
    }
    this.c.successfulGrasps++;
    b.state = 'held';
    b.vy = 0;
    this.held = b;
    const cx = b.x + S / 2; const cy = b.y + S / 2;
    this.carry = {
      blockId: b.id,
      from: this.sideOf(b),
      t0: this.t,
      // keep the offset between cursor and block centre so the block does not jump
      offX: cx - this.cursor.x,
      offY: cy - this.cursor.y,
      path: 0,
      minClearance: null,      // smallest gap above the partition top while over it
      peakSpeed: 0,
      hist: [{ t: this.t, x: cx, y: cy }],
    };
    this.log('grab', { block: b.id, side: this.carry.from });
  }

  /** Move the held block toward the cursor in small steps so it can never tunnel. */
  moveHeld(dt, skipSpeed) {
    const b = this.held;
    const g = GEOM;
    let tx = this.cursor.x + this.carry.offX - S / 2;
    let ty = this.cursor.y + this.carry.offY - S / 2;
    tx = Math.max(g.innerLeft, Math.min(g.innerRight - S, tx));
    ty = Math.max(0, Math.min(this.p.ceiling, ty));

    const x0 = b.x; const y0 = b.y;
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(tx - b.x), Math.abs(ty - b.y)) / 0.2));
    const sx = (tx - b.x) / n; const sy = (ty - b.y) / n;
    for (let i = 0; i < n; i++) {
      // horizontal sub-step
      let nx = b.x + sx;
      if (hitsPartition(nx, b.y)) nx = sx > 0 ? g.partitionX0 - S : g.partitionX1;
      b.x = nx;
      // vertical sub-step
      let ny = b.y + sy;
      if (hitsPartition(b.x, ny)) ny = g.partitionTop; // can only come from above
      b.y = Math.max(0, ny);
      this.trackClearance(b);
    }

    // 3D: once lifted above the box walls, the block moves to the depth row it will land in.
    if (this.rows > 1 && b.y >= BOX.height) b.row = this.landingRow(b);

    // Kinematics of the carry (block centre path)
    const c = this.carry;
    c.path += Math.hypot(b.x - x0, b.y - y0);
    const cx = b.x + S / 2; const cy = b.y + S / 2;
    if (skipSpeed) c.hist = [];   // ignore the jump that follows a tracking gap
    c.hist.push({ t: this.t, x: cx, y: cy });
    while (c.hist.length > 2 && this.t - c.hist[1].t >= this.p.speedWindow) c.hist.shift();
    const h0 = c.hist[0];
    if (this.t - h0.t >= this.p.speedWindow * 0.5) {
      const v = Math.hypot(cx - h0.x, cy - h0.y) / (this.t - h0.t);
      if (v > c.peakSpeed) c.peakSpeed = v;
    }
  }

  trackClearance(b) {
    if (overlap1D(b.x, b.x + S, GEOM.partitionX0, GEOM.partitionX1)) {
      const clr = b.y - GEOM.partitionTop;
      if (this.carry.minClearance == null || clr < this.carry.minClearance) this.carry.minClearance = clr;
    }
  }

  /** Open the hand (or forced by tracking loss): the block starts to fall. */
  release(forced) {
    const b = this.held;
    if (!b) return;
    b.state = 'fall';
    b.vy = 0;
    this.held = null;

    // 3D: choose the depth row it lands in.
    b.row = this.landingRow(b);
    // If released overlapping other blocks, it settles on top of them.
    let moved = true;
    while (moved) {
      moved = false;
      for (const o of this.blocks) {
        if (o !== b && o.state !== 'held' && o.row === b.row && rectsOverlap(b.x, b.y, o.x, o.y)) { b.y = o.y + S; moved = true; }
      }
    }

    const c = this.carry;
    const to = this.sideOf(b);
    let kind;
    if (c.from === this.sourceSide && to === this.targetSide) {
      kind = 'transfer'; this.c.transfers++; this.transferTimes.push(this.t);
    } else if (c.from === this.targetSide && to === this.sourceSide) {
      kind = 'return'; this.c.returns++;
    } else if (c.from === this.sourceSide) {
      kind = 'failed_release'; this.c.failedReleases++;
    } else {
      kind = 'reposition'; this.c.repositions++;
    }
    if (forced) this.c.forcedReleases++;

    this.carries.push({
      blockId: c.blockId, kind, forced,
      duration: this.t - c.t0, path: c.path, peakSpeed: c.peakSpeed,
      minClearance: c.minClearance,
    });
    this.log(forced ? 'forced_release' : 'release', { block: b.id, side: to, kind });
    if (kind === 'transfer') this.log('transfer', { block: b.id, score: this.score() });
    if (kind === 'return') this.log('return', { block: b.id, score: this.score() });
    this.carry = null;
  }

  // ---------------------------------------------------------------------------
  // Physics: gravity, stacking, sliding off the partition top
  // ---------------------------------------------------------------------------

  physics(dt) {
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let k = 0; k < steps; k++) {
      for (const b of [...this.blocks]) {
        if (b.state === 'slide') {
          b.x += b.dir * this.p.slideSpeed * h;
          b.x = Math.max(GEOM.innerLeft, Math.min(GEOM.innerRight - S, b.x));
          if (!overlap1D(b.x, b.x + S, GEOM.partitionX0, GEOM.partitionX1)) b.state = 'fall';
        } else if (b.state === 'fall') {
          const yPrev = b.y;
          b.vy -= this.p.gravity * h;
          b.y += b.vy * h;
          const sup = this.supportBelow(b, yPrev);
          if (b.y <= sup.y + EPS) {
            b.y = sup.y;
            b.vy = 0;
            if (sup.partition) {
              // Landed on the partition top: it slides off toward the side its centre is on.
              b.state = 'slide';
              b.dir = b.x + S / 2 > GEOM.partitionMid ? 1 : -1;
              this.log('partition_slide', { block: b.id });
            } else {
              b.state = 'rest';
              this.onRest(b);
            }
          }
        }
      }
    }
  }

  /** Highest surface under block b (floor, another block or the partition top). */
  supportBelow(b, yPrev) {
    let best = { y: 0, partition: false };
    for (const o of this.blocks) {
      if (o === b || o.state === 'held' || o.row !== b.row) continue;
      const top = o.y + S;
      if (top <= yPrev + EPS && top > best.y && overlap1D(b.x, b.x + S, o.x, o.x + S)) best = { y: top, partition: false };
    }
    if (overlap1D(b.x, b.x + S, GEOM.partitionX0, GEOM.partitionX1) &&
        GEOM.partitionTop <= yPrev + EPS && GEOM.partitionTop >= best.y) {
      best = { y: GEOM.partitionTop, partition: true };
    }
    return best;
  }

  /**
   * Depth simulation. Only 3 layers are drawn. A block that comes to rest in a
   * 4th layer (or higher) is folded out of view:
   *   - target side: added to the hidden target counter (still scored);
   *   - source side: returned to the hidden reserve.
   */
  onRest(b) {
    if (this.mode === '3d') return;              // 3D: everything stays visible
    if (b.y < BOX.layers * S - 0.01) return;
    this.removeBlock(b);
    if (this.sideOf(b) === this.targetSide) {
      this.targetHidden++;
      this.log('fold_target', { block: b.id, hidden: this.targetHidden });
    } else {
      this.reserve++;
      this.log('fold_source', { block: b.id, reserve: this.reserve });
    }
  }

  /** Keep 30 blocks visible in the source compartment while the reserve lasts. */
  refillSource() {
    if (this.reserve <= 0) return;
    const visible = this.blocks.filter((b) => b.state !== 'held' && this.sideOf(b) === this.sourceSide).length;
    if (visible >= BOX.cols * BOX.layers) return;
    const left = gridLeft(this.sourceSide);
    for (let layer = 0; layer < BOX.layers; layer++) {
      for (let col = 0; col < BOX.cols; col++) {
        const x = left + col * S; const y = layer * S;
        const free = !this.blocks.some((o) => o.row === 0 && rectsOverlap(x, y, o.x, o.y));
        const supported = layer === 0 || this.blocks.some((o) => o.state === 'rest' && o.row === 0 &&
          Math.abs(o.y + S - y) < 0.01 && overlap1D(x, x + S, o.x, o.x + S));
        if (free && supported) { this.spawn(col, layer); return; }  // one block per frame
      }
    }
  }

  // ---------------------------------------------------------------------------
  // End of trial and summary
  // ---------------------------------------------------------------------------

  finish() {
    if (this.finished) return;
    if (!this.trackingPresent && this.lostSince != null) this.c.lostTime += this.t - this.lostSince;
    this.finalScore = this.score();   // block still in the hand is NOT counted
    this.finished = true;
    this.log('end', { score: this.finalScore });
  }

  /** All per-trial metrics. Distances in cm, times in s, speeds in cm/s. */
  summary() {
    const dur = this.finished ? this.p.duration : this.t;
    const score = this.finished ? this.finalScore : this.score();
    const tr = this.carries.filter((c) => c.kind === 'transfer');
    const cycles = [];
    for (let i = 1; i < this.transferTimes.length; i++) cycles.push(this.transferTimes[i] - this.transferTimes[i - 1]);
    const clear = tr.map((c) => c.minClearance).filter((v) => v != null);
    const durSafe = Math.max(dur, EPS);
    const present = this.samples.filter((s) => s.present).length;
    return {
      score,
      blocksPerMinute: r3(score * 60 / durSafe),
      duration: r3(dur),
      transfers: this.c.transfers,
      graspAttempts: this.c.graspAttempts,
      successfulGrasps: this.c.successfulGrasps,
      missedGrasps: this.c.missedGrasps,
      failedReleases: this.c.failedReleases,
      returns: this.c.returns,
      repositions: this.c.repositions,
      forcedReleases: this.c.forcedReleases,
      timeToFirstTransfer: r3(this.transferTimes[0] ?? null),
      cycleTimeMean: r3(mean(cycles)),
      cycleTimeSD: r3(sd(cycles)),
      carryPathMean: r3(mean(tr.map((c) => c.path))),
      carrySpeedMean: r3(mean(tr.filter((c) => c.duration > 0).map((c) => c.path / c.duration))),
      carryDurationMean: r3(mean(tr.map((c) => c.duration))),
      peakSpeed: r3(this.carries.length ? Math.max(...this.carries.map((c) => c.peakSpeed)) : null),
      clearanceMean: r3(mean(clear)),
      trackingLossEpisodes: this.c.lossEpisodes,
      trackingLostTime: r3(this.c.lostTime),
      sampleCount: this.samples.length,
      sampleRate: r3(this.samples.length / durSafe),
      presentFraction: r3(this.samples.length ? present / this.samples.length : null),
      targetHidden: this.targetHidden,
      reserveLeft: this.reserve,
    };
  }
}
