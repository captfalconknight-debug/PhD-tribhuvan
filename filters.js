/**
 * filters.js — One Euro filter (Casiez, Roussel & Vogel, CHI 2012).
 *
 * An adaptive low-pass filter: at low speeds it smooths strongly (removes
 * jitter), at high speeds it smooths less (keeps lag low).
 *   cutoff = minCutoff + beta * |speed|
 * Used on the normalised cursor coordinates u and v (units: screen fraction).
 */

function alpha(cutoff, dt) {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export class OneEuroFilter {
  /**
   * @param {number} minCutoff  Hz — lower = smoother when the hand is still
   * @param {number} beta       speed coefficient — higher = less lag when moving fast
   * @param {number} dCutoff    Hz — cutoff for the speed estimate
   */
  constructor(minCutoff = 1.0, beta = 4.0, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }

  reset() { this.x = null; this.dx = 0; this.t = null; }

  /** Filter value x observed at time t (seconds). */
  filter(x, t) {
    if (this.x == null || this.t == null || t <= this.t) {
      if (this.x == null) { this.x = x; this.t = t; }
      return this.x;
    }
    const dt = t - this.t;
    const dxRaw = (x - this.x) / dt;
    this.dx = this.dx + alpha(this.dCutoff, dt) * (dxRaw - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x = this.x + alpha(cutoff, dt) * (x - this.x);
    this.t = t;
    return this.x;
  }
}
