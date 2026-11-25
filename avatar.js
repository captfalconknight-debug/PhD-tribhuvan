/**
 * avatar.js — semi-transparent hand avatar.
 *
 * The avatar is built from the 21 MediaPipe hand landmarks, so every finger
 * joint follows the participant's hand: fingers bend, open and close as theirs
 * do. It is drawn so that the PINCH POINT (midway between thumb tip and index
 * tip) sits exactly on the cursor, which is where blocks are grasped.
 *
 * Landmark indices: 0 wrist; thumb 1-4; index 5-8; middle 9-12; ring 13-16; little 17-20.
 */

export const AVATAR_PALM_CM = 7;   // drawn size: wrist to middle-finger knuckle, in box centimetres

const FINGERS = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
const PALM_OUTLINE = [0, 1, 2, 5, 9, 13, 17];
const FINGER_WIDTH_CM = [1.7, 1.5, 1.55, 1.45, 1.25];   // thumb, index, middle, ring, little

/**
 * Built-in hand shapes for mouse (simulation) mode: a right hand seen in a
 * mirror, palm towards the screen. Units: wrist at (0,0), wrist-to-middle-knuckle
 * length = 1, y pointing DOWN (image convention).
 */
const OPEN = [[0, 0], [-0.35, -0.15], [-0.62, -0.35], [-0.82, -0.56], [-0.98, -0.76],
  [-0.3, -0.95], [-0.35, -1.35], [-0.38, -1.6], [-0.4, -1.85],
  [0, -1], [0, -1.45], [0, -1.72], [0, -1.98],
  [0.27, -0.93], [0.3, -1.33], [0.32, -1.57], [0.34, -1.8],
  [0.5, -0.8], [0.58, -1.1], [0.63, -1.3], [0.67, -1.48]];
const PINCHED = [[0, 0], [-0.33, -0.17], [-0.58, -0.42], [-0.68, -0.8], [-0.6, -1.15],
  [-0.3, -0.95], [-0.38, -1.28], [-0.5, -1.33], [-0.58, -1.2],
  [0, -1], [-0.02, -1.4], [-0.04, -1.62], [-0.05, -1.82],
  [0.27, -0.93], [0.28, -1.3], [0.29, -1.52], [0.3, -1.72],
  [0.5, -0.8], [0.56, -1.07], [0.6, -1.25], [0.63, -1.42]];

/**
 * Template hand for mouse mode. t = 0 open … 1 pinched. Returns 21 offsets
 * (cm, y up) relative to the pinch point.
 */
export function templateHand(t, hand = 'right') {
  const pts = OPEN.map((p, i) => [p[0] + (PINCHED[i][0] - p[0]) * t, p[1] + (PINCHED[i][1] - p[1]) * t]);
  const mx = (pts[4][0] + pts[8][0]) / 2; const my = (pts[4][1] + pts[8][1]) / 2;
  const sx = hand === 'left' ? -1 : 1;
  return pts.map(([x, y]) => ({ x: sx * (x - mx) * AVATAR_PALM_CM, y: -(y - my) * AVATAR_PALM_CM }));
}

/**
 * Tracked hand: image landmarks (0..1) -> 21 offsets in cm (y up) relative to
 * the pinch point, scaled so the palm is AVATAR_PALM_CM long whatever the
 * distance from the camera. `mx` maps image x to mirrored screen x.
 */
export function handOffsets(lm, aspect, mx) {
  const P = lm.map((p) => ({ x: mx(p.x) * aspect, y: p.y }));
  const palm = Math.hypot(P[0].x - P[9].x, P[0].y - P[9].y) || 1e-3;
  const k = AVATAR_PALM_CM / palm;
  const cx = (P[4].x + P[8].x) / 2; const cy = (P[4].y + P[8].y) / 2;
  return P.map((p) => ({ x: (p.x - cx) * k, y: -(p.y - cy) * k }));
}

let off = null;   // offscreen canvas: the hand is drawn opaque, then blended once (even transparency)

/**
 * Draw the avatar.
 * @param ctx      destination 2D context
 * @param pts      21 points already in canvas pixels [[x, y], ...]
 * @param pxPerCm  scale for line widths
 * @param o        { present, pinch, dpr }
 */
export function drawHand(ctx, pts, pxPerCm, o) {
  const W = ctx.canvas.width; const H = ctx.canvas.height;
  if (!off) off = document.createElement('canvas');
  if (off.width !== W || off.height !== H) { off.width = W; off.height = H; }
  const c = off.getContext('2d');
  c.clearRect(0, 0, W, H);
  const skin = o.present ? '#f2c4a0' : '#b0bec5';
  const edge = o.present ? '#8d5b3c' : '#607d8b';
  c.lineCap = 'round'; c.lineJoin = 'round';

  // Palm
  c.beginPath();
  PALM_OUTLINE.forEach((i, n) => (n ? c.lineTo(pts[i][0], pts[i][1]) : c.moveTo(pts[i][0], pts[i][1])));
  c.closePath();
  c.fillStyle = skin; c.fill();
  c.lineWidth = 1.4 * pxPerCm; c.strokeStyle = skin; c.stroke();

  // Fingers: dark outline, then skin on top
  const finger = (f, width, color) => {
    c.beginPath();
    c.moveTo(pts[f[0]][0], pts[f[0]][1]);
    for (const i of f.slice(1)) c.lineTo(pts[i][0], pts[i][1]);
    c.lineWidth = width; c.strokeStyle = color; c.stroke();
  };
  FINGERS.forEach((f, n) => finger(f, FINGER_WIDTH_CM[n] * pxPerCm + 3 * o.dpr, edge));
  FINGERS.forEach((f, n) => finger(f, FINGER_WIDTH_CM[n] * pxPerCm, skin));

  // Joints (all fingers) as small dots, so finger bending is easy to see
  c.fillStyle = edge;
  for (let i = 1; i < 21; i++) {
    if (i === 4 || i === 8) continue;
    c.beginPath(); c.arc(pts[i][0], pts[i][1], 0.22 * pxPerCm, 0, Math.PI * 2); c.fill();
  }

  ctx.save();
  ctx.globalAlpha = o.present ? 0.55 : 0.3;
  ctx.drawImage(off, 0, 0);
  ctx.restore();

  // Thumb and index tips: glowing yellow when pinched, white when open (drawn fully opaque)
  ctx.save();
  for (const i of [4, 8]) {
    ctx.beginPath(); ctx.arc(pts[i][0], pts[i][1], 0.55 * pxPerCm, 0, Math.PI * 2);
    if (o.pinch && o.present) {
      ctx.fillStyle = '#ffea00'; ctx.shadowColor = '#ffab00'; ctx.shadowBlur = 10 * o.dpr;
    } else { ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.shadowBlur = 0; }
    ctx.fill();
    ctx.shadowBlur = 0; ctx.lineWidth = 2 * o.dpr; ctx.strokeStyle = o.present ? '#5d4037' : '#607d8b'; ctx.stroke();
  }
  ctx.restore();
}

/** Expanding ring shown for a moment when a block is picked up. t = 0..1 */
export function drawPickFlash(ctx, x, y, rPx, t, dpr) {
  ctx.save();
  ctx.globalAlpha = 1 - t;
  ctx.lineWidth = (6 - 4 * t) * dpr;
  ctx.strokeStyle = '#ffd600';
  ctx.shadowColor = '#ffab00'; ctx.shadowBlur = 16 * dpr;
  ctx.beginPath(); ctx.arc(x, y, rPx * (1 + 1.2 * t), 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}
