/**
 * render.js — draws the front view of the box on a <canvas>.
 * Reads engine state; never changes it.
 */
import { BOX, GEOM, DEFAULTS } from './engine.js';
import { drawHand, drawPickFlash } from './avatar.js';

const S = BOX.block;
// Visible part of the world, in cm (x right, y up).
const VIEW = { x0: -6, x1: BOX.width + 6, y0: -4.5, y1: 34 };

const COLORS = ['#d32f2f', '#1565c0', '#2e7d32', '#f9a825', '#6a1b9a', '#ef6c00'];

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.resize();
  }

  /** Match the canvas resolution to its on-screen size (sharp on high-DPI screens). */
  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(1.25, window.devicePixelRatio || 1);   // capped: drawing cost competes with hand tracking
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    const W = this.canvas.width; const H = this.canvas.height;
    const vw = VIEW.x1 - VIEW.x0; const vh = VIEW.y1 - VIEW.y0;
    this.scale = Math.min(W / vw, H / vh);
    this.ox = (W - vw * this.scale) / 2;
    this.oy = (H - vh * this.scale) / 2;
    this.dpr = dpr;
  }

  // world (cm) -> canvas pixels
  px(x) { return this.ox + (x - VIEW.x0) * this.scale; }
  py(y) { return this.oy + (VIEW.y1 - y) * this.scale; }

  /** World point -> canvas pixels (same interface as the 3D renderer; z is ignored). */
  toScreen(x, y) { return [this.px(x), this.py(y)]; }

  /** Stage fractions (u, v; v = 0 at top) -> world cm. Used for every input. */
  toWorld(u, v) {
    const x = (u * this.canvas.width - this.ox) / this.scale + VIEW.x0;
    const y = VIEW.y1 - (v * this.canvas.height - this.oy) / this.scale;
    return { x, y };
  }

  rect(x, y, w, h, fill, stroke, lw = 2) {
    const c = this.ctx;
    const X = this.px(x); const Y = this.py(y + h);
    c.fillStyle = fill; c.fillRect(X, Y, w * this.scale, h * this.scale);
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw * this.dpr; c.strokeRect(X, Y, w * this.scale, h * this.scale); }
  }

  text(str, x, y, size, color = '#111', align = 'center', weight = '700') {
    const c = this.ctx;
    c.fillStyle = color;
    c.font = `${weight} ${Math.round(size * this.scale)}px system-ui, -apple-system, "Segoe UI", Arial, sans-serif`;
    c.textAlign = align; c.textBaseline = 'middle';
    c.fillText(str, this.px(x), this.py(y));
  }

  /**
   * @param {VBBTEngine|null} e
   * @param {object} o  { cursor: {x,y,pinch,present} | null, highlight: bool, labels: bool }
   */
  draw(e, o = {}) {
    const c = this.ctx;
    const W = this.canvas.width; const H = this.canvas.height;
    c.fillStyle = '#eef2f7'; c.fillRect(0, 0, W, H);

    const src = e ? e.sourceSide : (o.sourceSide || 'right');
    const tgt = src === 'left' ? 'right' : 'left';
    const comp = (side) => (side === 'left'
      ? [GEOM.innerLeft, GEOM.partitionX0]
      : [GEOM.partitionX1, GEOM.innerRight]);

    // Table
    this.rect(VIEW.x0, VIEW.y0, VIEW.x1 - VIEW.x0, -VIEW.y0, '#cfd8dc');

    // Target compartment tint (inside the box) and a lighter column above it
    const [tx0, tx1] = comp(tgt);
    this.rect(tx0, 0, tx1 - tx0, 24, 'rgba(56, 196, 96, 0.12)');
    this.rect(tx0, 0, tx1 - tx0, BOX.height, '#b9f6ca');

    // Box: floor, outer walls, partition
    this.rect(0, -0.8, BOX.width, 0.8, '#5d4037');
    this.rect(0, 0, BOX.wall, BOX.height, '#795548', '#3e2723', 1.5);
    this.rect(BOX.width - BOX.wall, 0, BOX.wall, BOX.height, '#795548', '#3e2723', 1.5);
    this.rect(GEOM.partitionX0, 0, BOX.partitionThickness, BOX.partitionHeight, '#6d4c41', '#3e2723', 1.5);

    // Labels
    if (o.labels !== false) {
      const [sx0, sx1] = comp(src);
      this.text('PICK UP HERE', (sx0 + sx1) / 2, 30.5, 2.6, '#0d47a1');
      this.text('PLACE HERE', (tx0 + tx1) / 2, 30.5, 2.6, '#1b5e20');
      this.text('↓', (sx0 + sx1) / 2, 27.4, 2.6, '#0d47a1');
      this.text('↓', (tx0 + tx1) / 2, 27.4, 2.6, '#1b5e20');
    }

    if (!e) return;

    // Hidden counts (depth simulation)
    const [sx0, sx1] = comp(src);
    // Full counts of all 150 blocks. Only 3 layers are drawn; the rest are "behind" (depth simulation).
    const inSource = e.reserve + e.blocks.filter((b) => b.state !== 'held' && e.sideOf(b) === src).length;
    const inTarget = e.score();
    const visS = inSource - e.reserve; const visT = inTarget - e.targetHidden;
    this.text(`${inSource} of ${BOX.totalBlocks} blocks here`, (sx0 + sx1) / 2, -2.2, 1.5, '#263238', 'center', '700');
    this.text(`(${visS} shown, ${e.reserve} behind)`, (sx0 + sx1) / 2, -3.8, 1.2, '#455a64', 'center', '600');
    this.text(`${inTarget} of ${BOX.totalBlocks} blocks here`, (tx0 + tx1) / 2, -2.2, 1.5, '#263238', 'center', '700');
    this.text(`(${visT} shown, ${e.targetHidden} behind)`, (tx0 + tx1) / 2, -3.8, 1.2, '#455a64', 'center', '600');

    // Blocks
    const cand = o.highlight && o.cursor?.present ? e.grabCandidate(o.cursor.x, o.cursor.y) : null;
    for (const b of e.blocks) {
      if (b.state === 'held') continue;
      this.rect(b.x, b.y, S, S, COLORS[b.id % COLORS.length], '#1a1a1a', 1.2);
    }
    if (cand) {
      // Block that a pinch would pick: pulsing orange outline
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 120);
      this.rect(cand.x - 0.2, cand.y - 0.2, S + 0.4, S + 0.4, 'rgba(255,171,0,0.25)', '#ff6d00', 3 + 3 * pulse);
    }
    const now = performance.now();
    if (e.held && e.held.id !== this.lastHeldId) this.flash = { t0: now };
    this.lastHeldId = e.held ? e.held.id : null;
    if (e.held) {
      // Picked block: snapped between the avatar's fingertips, bright yellow outline
      const b = e.held;
      this.rect(b.x + 0.35, b.y - 0.35, S, S, 'rgba(0,0,0,0.25)');
      c.save(); c.shadowColor = '#ffab00'; c.shadowBlur = 14 * this.dpr;
      this.rect(b.x, b.y, S, S, COLORS[b.id % COLORS.length], '#ffd600', 4);
      c.restore();
    }

    // Hand avatar (pinch point = cursor), or a simple ring if no avatar is available
    const cur = o.cursor;
    if (o.avatar && cur) {
      const pts = o.avatar.map((p) => [this.px(cur.x + p.x), this.py(cur.y + p.y)]);
      drawHand(c, pts, this.scale, { present: cur.present, pinch: cur.pinch, dpr: this.dpr });
    } else if (cur) {
      const R = DEFAULTS.grabRadius * this.scale * 0.6;
      c.beginPath();
      c.arc(this.px(cur.x), this.py(cur.y), R, 0, Math.PI * 2);
      c.lineWidth = 4 * this.dpr;
      c.strokeStyle = cur.present ? '#0d47a1' : '#9e9e9e';
      if (cur.present && cur.pinch) { c.fillStyle = 'rgba(13, 71, 161, 0.55)'; c.fill(); }
      c.stroke();
    }
    if (this.flash && e.held) {
      const t = (now - this.flash.t0) / 450;
      if (t < 1) drawPickFlash(c, this.px(e.held.x + S / 2), this.py(e.held.y + S / 2), S * this.scale * 0.8, t, this.dpr);
    }
  }
}
