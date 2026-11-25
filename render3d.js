/**
 * render3d.js — perspective (3D) view of the box, drawn on a 2D <canvas>.
 *
 * No 3D library is used: each block is an axis-aligned cube; its visible faces
 * are projected with a simple pinhole-camera model and painted back-to-front
 * (painter's algorithm). Reads engine state; never changes it.
 *
 * World axes (cm): x left→right, y up, z front→back (away from the viewer).
 * The hand controls x and y; depth (z) is handled automatically by the engine.
 */
import { BOX, GEOM, DEFAULTS, rowZ, Z_FRONT } from './engine.js';

const S = BOX.block;
const W = BOX.width; const D = BOX.depth; const H = BOX.height; const T = BOX.wall;

// Camera: in front of the box, above it, looking down at about 33 degrees.
const CAM = { x: W / 2, y: 46, z: -50 };
const LOOK = { x: W / 2, y: 6, z: 13 };
const UPV = { x: 0, y: 1, z: 0 };

// Mouse mode: the pointer moves in this vertical plane (front-row centre depth).
const MOUSE_PLANE_Z = Z_FRONT + S / 2;

const COLORS = ['#d32f2f', '#1565c0', '#2e7d32', '#f9a825', '#6a1b9a', '#ef6c00'];

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (a) => { const l = Math.hypot(a.x, a.y, a.z); return { x: a.x / l, y: a.y / l, z: a.z / l }; };

// Camera basis
const F = norm(sub(LOOK, CAM));           // forward
const R = norm(cross(UPV, F));            // right
const U = cross(F, R);                    // up

/** Shade a #rrggbb colour: k > 0 lightens, k < 0 darkens. */
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  let r = n >> 16; let g = (n >> 8) & 255; let b = n & 255;
  const f = (c) => Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k));
  r = f(r); g = f(g); b = f(b);
  return `rgb(${r},${g},${b})`;
}

export class Renderer3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.displayZ = new Map();            // smoothed depth per block id (for gentle row changes)
    this.resize();
  }

  /** Camera-space coordinates (before the perspective divide). */
  cam(p) { const d = sub(p, CAM); return { x: dot(d, R), y: dot(d, U), z: dot(d, F) }; }

  /** Fit the scene into the canvas. */
  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(1.25, window.devicePixelRatio || 1);   // capped: drawing cost competes with hand tracking
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.dpr = dpr;
    // Projected extent of the region that must be visible (box + lifting space + labels).
    const pts = [];
    for (const x of [-1, W + 1]) for (const y of [-4, 28]) for (const z of [-2, D]) pts.push({ x, y, z });
    let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
    for (const p of pts) {
      const c = this.cam(p);
      const sx = c.x / c.z; const sy = -c.y / c.z;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    const Wc = this.canvas.width; const Hc = this.canvas.height;
    this.f = Math.min(Wc / (x1 - x0), Hc / (y1 - y0));
    this.cx = Wc / 2 - this.f * (x0 + x1) / 2;
    this.cy = Hc / 2 - this.f * (y0 + y1) / 2;
  }

  /** World (cm) -> canvas pixels. */
  project(x, y, z) {
    const c = this.cam({ x, y, z });
    return [this.cx + this.f * c.x / c.z, this.cy - this.f * c.y / c.z, c.z];
  }

  /** For tests/debugging: world point in the mouse plane -> canvas pixels. */
  toScreen(x, y, z = MOUSE_PLANE_Z) { const [a, b] = this.project(x, y, z); return [a, b]; }

  /** Stage fractions (u, v) -> world (x, y): pointer ray hits the vertical mouse plane. Mouse mode only. */
  toWorld(u, v) {
    const px = (u * this.canvas.width - this.cx) / this.f;
    const py = -(v * this.canvas.height - this.cy) / this.f;
    const dir = { x: R.x * px + U.x * py + F.x, y: R.y * px + U.y * py + F.y, z: R.z * px + U.z * py + F.z };
    const t = (MOUSE_PLANE_Z - CAM.z) / dir.z;
    return { x: CAM.x + t * dir.x, y: CAM.y + t * dir.y };
  }

  poly(pts, fill, stroke, lw = 1) {
    const c = this.ctx;
    c.beginPath();
    pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw * this.dpr; c.lineJoin = 'round'; c.stroke(); }
  }

  /** Draw an axis-aligned cuboid: only the faces the camera can see. */
  cuboid(x0, y0, z0, x1, y1, z1, color, { stroke = 'rgba(0,0,0,0.55)', alpha = 1 } = {}) {
    const c = this.ctx;
    const P = (x, y, z) => this.project(x, y, z);
    c.save();
    c.globalAlpha = alpha;
    if (CAM.x < x0) this.poly([P(x0, y0, z0), P(x0, y1, z0), P(x0, y1, z1), P(x0, y0, z1)], shade(color, -0.3), stroke);
    if (CAM.x > x1) this.poly([P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)], shade(color, -0.3), stroke);
    this.poly([P(x0, y0, z0), P(x1, y0, z0), P(x1, y1, z0), P(x0, y1, z0)], color, stroke);            // front
    if (CAM.y > y1) this.poly([P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)], shade(color, 0.28), stroke); // top
    c.restore();
  }

  text(str, x, y, z, sizeCm, color, weight = '800') {
    const [sx, sy, cz] = this.project(x, y, z);
    const c = this.ctx;
    const px = Math.max(10, sizeCm * this.f / cz);
    c.font = `${weight} ${Math.round(px)}px system-ui, -apple-system, "Segoe UI", Arial, sans-serif`;
    c.fillStyle = color; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(str, sx, sy);
  }

  /** Smoothed depth of a block (rows change in steps; this makes the movement gentle). */
  zOf(b) {
    const target = rowZ(b.row);
    const cur = this.displayZ.get(b.id);
    const z = cur == null ? target : cur + (target - cur) * 0.25;
    this.displayZ.set(b.id, Math.abs(z - target) < 0.01 ? target : z);
    return z;
  }

  draw(e, o = {}) {
    const c = this.ctx;
    c.fillStyle = '#eef2f7'; c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!e) return;
    const src = e.sourceSide; const tgt = e.targetSide;
    const comp = (side) => (side === 'left' ? [GEOM.innerLeft, GEOM.partitionX0] : [GEOM.partitionX1, GEOM.innerRight]);
    const [sx0, sx1] = comp(src); const [tx0, tx1] = comp(tgt);
    const P = (x, y, z) => this.project(x, y, z);

    // Table and floor of the box
    this.poly([P(-12, -0.8, -6), P(W + 12, -0.8, -6), P(W + 12, -0.8, D + 8), P(-12, -0.8, D + 8)], '#cfd8dc');
    this.cuboid(0, -0.8, 0, W, 0, D, '#8d6e63');
    // Target floor tint
    this.poly([P(tx0, 0.01, T), P(tx1, 0.01, T), P(tx1, 0.01, D - T), P(tx0, 0.01, D - T)], '#b9f6ca');
    // Back and side walls (drawn before the blocks)
    this.cuboid(0, 0, D - T, W, H, D, '#8d6e63');
    this.cuboid(0, 0, 0, T, H, D, '#795548');
    this.cuboid(W - T, 0, 0, W, H, D, '#795548');

    // Blocks: far rows first, then lower first, then outer (farther from the camera's x) first.
    const items = e.blocks.map((b) => ({ b, z: this.zOf(b) }));
    const key = (it) => [-(it.z), it.b.y, -Math.abs(it.b.x + S / 2 - CAM.x)];
    items.sort((a, b2) => { const ka = key(a); const kb = key(b2); return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2]; });
    const cand = o.highlight && o.cursor?.present ? e.grabCandidate(o.cursor.x, o.cursor.y) : null;

    // Landing shadow for the held block: shows where it will drop.
    if (e.held) {
      const hb = e.held; const row = e.landingRow(hb); const z0 = rowZ(row);
      const overPartition = hb.x + S > GEOM.partitionX0 && hb.x < GEOM.partitionX1;
      const yS = (overPartition ? GEOM.partitionTop : Math.min(e.stackTop(hb.x, row, hb), hb.y)) + 0.02;
      this.poly([P(hb.x, yS, z0), P(hb.x + S, yS, z0), P(hb.x + S, yS, z0 + S), P(hb.x, yS, z0 + S)], 'rgba(0,0,0,0.35)');
    }

    const drawBlock = ({ b, z }) => {
      const col = COLORS[b.id % COLORS.length];
      this.cuboid(b.x, b.y, z, b.x + S, b.y + S, z + S, col, { stroke: b === e.held ? '#000' : 'rgba(0,0,0,0.55)' });
      if (b === cand) {
        c.save();
        const pts = [P(b.x, b.y + S, z), P(b.x + S, b.y + S, z), P(b.x + S, b.y + S, z + S), P(b.x, b.y + S, z + S)];
        this.poly(pts, null, '#ff6d00', 4);
        this.poly([P(b.x, b.y, z), P(b.x + S, b.y, z), P(b.x + S, b.y + S, z), P(b.x, b.y + S, z)], null, '#ff6d00', 4);
        c.restore();
      }
    };
    const high = (it) => it.b.y >= GEOM.partitionTop - 1e-6;
    for (const it of items) if (!high(it)) drawBlock(it);
    // Partition, then the front wall (see-through so the pile stays visible)
    this.cuboid(GEOM.partitionX0, 0, T, GEOM.partitionX1, GEOM.partitionTop, D - T, '#6d4c41');
    this.cuboid(0, 0, 0, W, H, T, '#a1887f', { alpha: 0.22, stroke: 'rgba(62,39,35,0.9)' });
    for (const it of items) if (high(it)) drawBlock(it);

    // Labels and counts
    if (o.labels !== false) {
      this.text('PICK UP HERE', (sx0 + sx1) / 2, 24, D / 2, 2.6, '#0d47a1');
      this.text('PLACE HERE', (tx0 + tx1) / 2, 24, D / 2, 2.6, '#1b5e20');
    }
    const inSource = e.blocks.filter((b) => b.state !== 'held' && e.sideOf(b) === src).length + e.reserve;
    const inTarget = e.score();
    this.text(`${inSource} of ${BOX.totalBlocks} blocks here`, (sx0 + sx1) / 2, -1.5, -2, 1.6, '#263238', '700');
    this.text(`${inTarget} of ${BOX.totalBlocks} blocks here`, (tx0 + tx1) / 2, -1.5, -2, 1.6, '#263238', '700');

    // Cursor: a ring at the depth of the block it would grab (or the held block).
    const cur = o.cursor;
    if (cur) {
      const ref = e.held || cand;
      const zc = ref ? this.zOf(ref) + S / 2 : MOUSE_PLANE_Z;
      const [px, py, cz] = this.project(cur.x, cur.y, zc);
      const Rpx = DEFAULTS.grabRadius * 0.6 * this.f / cz;
      c.beginPath(); c.arc(px, py, Rpx, 0, Math.PI * 2);
      c.lineWidth = 4 * this.dpr;
      if (cur.present) {
        c.strokeStyle = '#0d47a1';
        if (cur.pinch) { c.fillStyle = 'rgba(13, 71, 161, 0.55)'; c.fill(); }
      } else { c.strokeStyle = '#9e9e9e'; c.setLineDash([6 * this.dpr, 6 * this.dpr]); }
      c.stroke(); c.setLineDash([]);
      c.beginPath(); c.arc(px, py, 3 * this.dpr, 0, Math.PI * 2);
      c.fillStyle = cur.present ? '#0d47a1' : '#9e9e9e'; c.fill();
    }
  }
}
