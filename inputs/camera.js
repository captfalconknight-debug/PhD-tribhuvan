/**
 * inputs/camera.js — laptop webcam hand tracking with MediaPipe HandLandmarker.
 *
 * Everything runs inside the browser on this laptop: video frames are passed
 * to the MediaPipe model in memory and are never recorded, stored or uploaded.
 *
 * read(now) returns { present, u, v, pinch } where u, v are fractions of the
 * (mirrored) camera image, v = 0 at the top. The app maps them onto the stage
 * using the reach area. Extra fields (ratio, palm, label, ...) are used by the
 * setup check and for logging.
 */
import {
  cursorFromLandmarks, pinchRatio, palmSize, PinchDetector, selectHand, DEFAULT_PINCH,
} from './handmath.js';
import { MEDIAPIPE_LOCAL, MEDIAPIPE_CDN, MEDIAPIPE_MODEL_CDN, HANDEDNESS_INVERTED } from '../config.js';

// Bones of the hand skeleton for the preview overlay (MediaPipe landmark pairs).
const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11],
  [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];

const STALE_MS = 300;   // if no new detection for this long, the hand counts as "not present"

let landmarkerPromise = null;   // the model is loaded once per page and reused

/**
 * Load MediaPipe and the hand model (local vendor/ folder first, CDN only as a
 * fallback), create a GPU and a CPU version, time both on the live video and
 * keep the faster one. On laptops without usable graphics acceleration the
 * "GPU" path runs in software and can be many times slower than the CPU path.
 */
async function loadLandmarker(video) {
  const attempts = [
    { lib: new URL(MEDIAPIPE_LOCAL, location.href).href, model: new URL(MEDIAPIPE_LOCAL + 'hand_landmarker.task', location.href).href, where: 'local' },
  ];
  if (MEDIAPIPE_CDN) attempts.push({ lib: MEDIAPIPE_CDN, model: MEDIAPIPE_MODEL_CDN, where: 'cdn' });
  let lastErr;
  for (const a of attempts) {
    try {
      const vision = await import(/* webpackIgnore: true */ a.lib + 'vision_bundle.mjs');
      const wasmBase = a.where === 'local' ? a.lib.replace(/\/$/, '') : a.lib + 'wasm';
      const fileset = await vision.FilesetResolver.forVisionTasks(wasmBase);
      const found = [];
      for (const delegate of ['GPU', 'CPU']) {
        try {
          const lm = await vision.HandLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: a.model, delegate },
            runningMode: 'VIDEO',
            numHands: 2,
            minHandDetectionConfidence: 0.5,
            minHandPresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });
          found.push({ lm, delegate, ms: benchmark(lm, video) });
        } catch (e) { lastErr = e; }
      }
      if (found.length) {
        found.sort((x, y) => x.ms - y.ms);
        for (const f of found.slice(1)) f.lm.close();
        const timings = Object.fromEntries(found.map((f) => [f.delegate, Math.round(f.ms)]));
        return { lm: found[0].lm, delegate: found[0].delegate, source: a.where, timings };
      }
    } catch (e) { lastErr = e; }
  }
  throw new Error('Could not load the hand-tracking model: ' + (lastErr?.message || lastErr));
}

/** Median time (ms) of a few detections on the current video frame. */
function benchmark(lm, video) {
  const times = [];
  let ts = performance.now();
  for (let i = 0; i < 6; i++) {
    ts += 34;
    const t0 = performance.now();
    lm.detectForVideo(video, ts);
    if (i > 0) times.push(performance.now() - t0);   // first call includes warm-up
  }
  times.sort((a, b) => a - b);
  // Later real timestamps must be larger than the ones used here.
  lm._vbbtLastTs = ts;
  return times[times.length >> 1];
}

export class CameraInput {
  /**
   * @param {object} o
   * @param {HTMLVideoElement} o.video     hidden video element receiving the webcam stream
   * @param {HTMLCanvasElement} [o.preview] small canvas for the mirrored preview + skeleton
   * @param {'left'|'right'} o.testedHand
   */
  constructor({ video, preview, testedHand = 'right' }) {
    this.kind = 'camera';
    this.video = video;
    this.preview = preview;
    this.testedHand = testedHand;
    this.pinch = new PinchDetector(DEFAULT_PINCH);
    this.latest = { present: false, u: 0.5, v: 0.5, pinch: false, t: 0 };
    this.seq = 0;
    this.running = false;
    this.fpsTimes = [];
    this.lastVideoTime = -1;
    this.info = {};
    this.invert = HANDEDNESS_INVERTED;  // set by the camera check (see setup.js)
    this.allowSingle = true;            // until the camera check has confirmed the labels
  }

  setTestedHand(h) { this.testedHand = h; this.pinch.reset(); }
  setPinchThresholds(th) { this.pinch.setThresholds(th); }

  async start() {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('The camera can only be used on a secure page (https:// or http://localhost).');
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 }, facingMode: 'user' },
      audio: false,
    });
    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play();

    if (!landmarkerPromise) landmarkerPromise = loadLandmarker(this.video).catch((e) => { landmarkerPromise = null; throw e; });
    const { lm, delegate, source, timings } = await landmarkerPromise;
    this.landmarker = lm;

    const track = this.stream.getVideoTracks()[0];
    const st = track.getSettings ? track.getSettings() : {};
    this.info = {
      label: track.label || 'Webcam',
      width: this.video.videoWidth || st.width,
      height: this.video.videoHeight || st.height,
      requestedFps: st.frameRate || null,
      delegate,
      timings,            // ms per frame for each processing option tried
      modelSource: source,
    };
    this.running = true;
    this._schedule();
    return this.info;
  }

  stop() {
    this.running = false;
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.latest = { present: false, u: 0.5, v: 0.5, pinch: false, t: 0 };
  }

  _schedule() {
    if (!this.running) return;
    // Poll every display frame; _frame() only runs detection when the camera
    // has delivered a new image. (requestVideoFrameCallback is not used because
    // it does not fire for a hidden <video> element in some browsers.)
    requestAnimationFrame(() => this._frame());
  }

  /** Run hand detection on each new camera frame. */
  _frame() {
    if (!this.running) return;
    try {
      const v = this.video;
      if (v.readyState >= 2 && v.currentTime !== this.lastVideoTime) {
        this.lastVideoTime = v.currentTime;
        // MediaPipe requires strictly increasing timestamps.
        const now = Math.max(performance.now(), (this.landmarker._vbbtLastTs || 0) + 1);
        this.landmarker._vbbtLastTs = now;
        const res = this.landmarker.detectForVideo(v, now);
        this._process(res, now);
        this._drawPreview(res);
      }
    } catch (e) {
      console.warn('Hand detection error', e);
    }
    this._schedule();
  }

  _process(res, now) {
    this.fpsTimes.push(now);
    while (this.fpsTimes.length && now - this.fpsTimes[0] > 2000) this.fpsTimes.shift();
    const aspect = (this.video.videoWidth || 4) / (this.video.videoHeight || 3);
    const { hand, all } = selectHand(res, this.testedHand, this.invert, this.allowSingle);
    this.seq++;
    this.lastLandmarks = hand ? hand.image : null;
    if (!hand) {
      this.latest = { present: false, u: this.latest.u, v: this.latest.v, pinch: this.latest.pinch, t: now, others: all.map((h) => h.label) };
      return;
    }
    const ratio = pinchRatio(hand.world, hand.image, aspect);
    const pinch = this.pinch.update(ratio);
    const { u, v } = cursorFromLandmarks(hand.image);
    this.latest = {
      present: true, u, v, pinch, ratio, t: now,
      palm: palmSize(hand.image, aspect),
      label: hand.label, score: hand.score,
      wrist: { u: 1 - hand.image[0].x, v: hand.image[0].y },
      others: all.map((h) => h.label),
      assumed: !!hand.assumed,
    };
  }

  /** Measured detection rate over the last 2 s (frames per second). */
  fps() {
    const n = this.fpsTimes.length;
    if (n < 2) return 0;
    return (n - 1) / ((this.fpsTimes[n - 1] - this.fpsTimes[0]) / 1000);
  }

  /** Mean brightness of the camera image, 0 (black) to 255 (white). */
  brightness() {
    const v = this.video;
    if (!v.videoWidth) return null;
    if (!this._small) { this._small = document.createElement('canvas'); this._small.width = 64; this._small.height = 48; }
    const ctx = this._small.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(v, 0, 0, 64, 48);
    const d = ctx.getImageData(0, 0, 64, 48).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return s / (d.length / 4);
  }

  _drawPreview(res) {
    const c = this.preview;
    if (!c) return;
    const ctx = c.getContext('2d');
    const w = c.width; const h = c.height;
    ctx.save();
    ctx.translate(w, 0); ctx.scale(-1, 1);          // mirror, like looking in a mirror
    ctx.drawImage(this.video, 0, 0, w, h);
    const { hand } = selectHand(res, this.testedHand, this.invert, this.allowSingle);
    (res.landmarks || []).forEach((pts, i) => {
      const tested = hand && hand.index === i;
      ctx.strokeStyle = tested ? '#00e676' : '#ff9100';
      ctx.lineWidth = 3;
      for (const [a, b] of BONES) {
        ctx.beginPath(); ctx.moveTo(pts[a].x * w, pts[a].y * h); ctx.lineTo(pts[b].x * w, pts[b].y * h); ctx.stroke();
      }
      ctx.fillStyle = tested ? (this.latest.pinch ? '#ffea00' : '#ffffff') : '#ff9100';
      for (const k of [4, 8]) { ctx.beginPath(); ctx.arc(pts[k].x * w, pts[k].y * h, 5, 0, Math.PI * 2); ctx.fill(); }
    });
    ctx.restore();
  }

  /** Latest hand sample. Stale results (> 300 ms old) count as "hand not present". */
  read(now = performance.now()) {
    const l = this.latest;
    const present = l.present && now - l.t < STALE_MS;
    return { ...l, present, seq: this.seq };
  }
}
