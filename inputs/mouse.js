/**
 * inputs/mouse.js — simulation input for development and demonstrations.
 *
 * Move the mouse over the stage = hand position; hold the mouse button = pinch.
 * u, v are fractions of the stage canvas (v = 0 at the top), so the mouse maps
 * directly onto the scene (no reach-area mapping, no smoothing).
 */
export class MouseInput {
  constructor(target) {
    this.kind = 'mouse';
    this.target = target;
    this.state = { present: false, u: 0.5, v: 0.5, pinch: false };
    this.seq = 0;
    this._on = (e) => this._handle(e);
  }

  async start() {
    for (const ev of ['pointermove', 'pointerdown', 'pointerup', 'pointerleave', 'pointerenter']) {
      this.target.addEventListener(ev, this._on);
    }
    return { label: 'Mouse (simulation)' };
  }

  stop() {
    for (const ev of ['pointermove', 'pointerdown', 'pointerup', 'pointerleave', 'pointerenter']) {
      this.target.removeEventListener(ev, this._on);
    }
    this.state.present = false;
  }

  _handle(e) {
    const r = this.target.getBoundingClientRect();
    this.state.u = (e.clientX - r.left) / r.width;
    this.state.v = (e.clientY - r.top) / r.height;
    if (e.type === 'pointerdown') { this.state.pinch = true; e.preventDefault(); }
    if (e.type === 'pointerup') this.state.pinch = false;
    this.state.present = e.type !== 'pointerleave';
    if (e.type === 'pointerleave') this.state.pinch = false;
    this.seq++;
  }

  /** Latest hand sample: {present, u, v, pinch}. */
  read() { return { ...this.state, seq: this.seq }; }
}
