/**
 * app.js — user interface, trial flow, rendering loop, saving and export.
 *
 * Trial flow:  idle → (consent) → waiting for hand → 3-2-1 countdown → running → results
 */
import { VBBTEngine } from './engine.js';
import { Renderer } from './render.js';
import { Renderer3D } from './render3d.js';
import { OneEuroFilter } from './filters.js';
import { MouseInput } from './inputs/mouse.js';
import { CameraInput } from './inputs/camera.js';
import { pinchThresholds } from './inputs/handmath.js';
import { runSetupCheck } from './setup.js';
import {
  loadSessions, saveSession, saveLastTrial, loadLastTrial, clearAll, getConsent, setConsent,
  nextTrialNumber, toCSV, download,
} from './storage.js';
import {
  APP_VERSION, TEST_DURATION, PRACTICE_DURATION, FPS_WARNING,
  CONSENT_TITLE, CONSENT_TEXT, CONSENT_BUTTON,
} from './config.js';

const $ = (id) => document.getElementById(id);
const ui = {
  pid: $('pid'), age: $('age'), sex: $('sex'), dominant: $('dominant'), notes: $('notes'),
  device: $('device'), connect: $('connect'), devStatus: $('devStatus'), preview: $('preview'), video: $('video'),
  setupBtn: $('setupBtn'), calibStatus: $('calibStatus'),
  reach: $('reach'), reachOut: $('reachOut'), sens: $('sens'), sensOut: $('sensOut'),
  view: $('view'), practice: $('practice'), highlight: $('highlight'), start: $('start'), abort: $('abort'), formMsg: $('formMsg'),
  hudTime: $('hudTime'), hudScore: $('hudScore'), hudTrack: $('hudTrack'),
  stage: $('stage'), overlay: $('overlay'),
  results: $('results'), resultsTitle: $('resultsTitle'), resScore: $('resScore'), resFlag: $('resFlag'), resTable: $('resTable'),
  sessionsBody: document.querySelector('#sessions tbody'),
  dlCsv: $('dlCsv'), dlJson: $('dlJson'), clearData: $('clearData'),
  consent: $('consent'),
};
const fieldsets = ['formParticipant', 'formDevice'].map($);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const viewMode = () => (ui.view.value === '2d' ? '2d' : '3d');
let renderer = viewMode() === '3d' ? new Renderer3D(ui.stage) : new Renderer(ui.stage);
const state = {
  phase: 'idle',          // idle | setup | wait | countdown | running | done
  input: null,            // MouseInput | CameraInput
  inputInfo: null,
  calib: null,            // result of the camera check, per participant + hand
  engine: null,
  idleEngine: new VBBTEngine({ testedHand: 'right', mode: viewMode() }),  // static pile shown when idle
  // One Euro smoothing of the pointer: 0.6 Hz minimum cutoff (steady when still), beta 3.0
  filters: { u: new OneEuroFilter(0.6, 3.0), v: new OneEuroFilter(0.6, 3.0) },
  lastSeq: -1, lastUpdate: 0, wasPresent: false,
  t0: 0, countdownStart: 0, handSince: null,
  trial: null,            // metadata of the running trial
  camSamples: 0,          // new camera frames during the running trial
  setupAbort: null,
};

ui.video.hidden = true;
$('version').textContent = APP_VERSION;

const testedHand = () => document.querySelector('input[name=hand]:checked').value;

function setMsg(text, cls = '') { ui.formMsg.textContent = text; ui.formMsg.className = 'status ' + cls; }
function setStatus(el, text, cls = '') { el.textContent = text; el.className = 'status ' + cls; }

function showOverlay(html, cls = '') {
  ui.overlay.className = 'overlay ' + cls;
  ui.overlay.innerHTML = html;
  ui.overlay.hidden = !html;
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------------------
// Device connection
// ---------------------------------------------------------------------------
async function connect() {
  disconnect();
  const kind = ui.device.value;
  ui.connect.disabled = true;
  setStatus(ui.devStatus, kind === 'camera' ? 'Starting camera and loading the hand model… (first time can take a minute)' : 'Connecting…');
  try {
    if (kind === 'mouse') {
      state.input = new MouseInput(ui.stage);
      state.inputInfo = await state.input.start();
      setStatus(ui.devStatus, 'Mouse ready: move over the box, hold the button to pinch.', 'ok');
    } else {
      state.input = new CameraInput({ video: ui.video, preview: ui.preview, testedHand: testedHand() });
      state.inputInfo = await state.input.start();
      ui.preview.hidden = false;
      const i = state.inputInfo;
      setStatus(ui.devStatus, `Camera ready (${i.width}×${i.height}, ${i.delegate} processing, ~${i.timings[i.delegate]} ms per frame).`, 'ok');
      applyPinchSettings();
    }
  } catch (e) {
    console.warn(e);
    state.input = null;
    setStatus(ui.devStatus, friendlyError(e), 'err');
  }
  ui.connect.disabled = false;
  ui.connect.textContent = state.input ? 'Reconnect' : 'Connect';
  ui.setupBtn.disabled = !(state.input && state.input.kind === 'camera');
}

function disconnect() {
  if (state.input) state.input.stop();
  state.input = null;
  ui.preview.hidden = true;
  ui.setupBtn.disabled = true;
}

function friendlyError(e) {
  const n = e?.name || '';
  if (n === 'NotAllowedError') return 'Camera permission was refused. Click the camera icon in the address bar, allow the camera, then press Connect again.';
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'No camera was found on this computer.';
  if (n === 'NotReadableError') return 'The camera is being used by another program (e.g. Zoom/Teams). Close it and press Connect again.';
  return e?.message || String(e);
}

function applyPinchSettings() {
  if (state.input?.kind !== 'camera') return;
  const calib = state.calib ? { open: state.calib.openRatio, pinch: state.calib.pinchRatio } : null;
  state.input.setPinchThresholds(pinchThresholds(calib, +ui.sens.value));
}

function resetCalibration(reason) {
  if (!state.calib) return;
  state.calib = null;
  if (state.input?.kind === 'camera') state.input.allowSingle = true;
  applyPinchSettings();
  setStatus(ui.calibStatus, `Not calibrated (${reason}). Please run the camera check again.`, 'warn');
}

// ---------------------------------------------------------------------------
// Hand position -> world coordinates (cm)
// ---------------------------------------------------------------------------

/** Default reach area (fraction of the mirrored camera image) when not calibrated. */
const DEFAULT_REACH = { u0: 0.2, u1: 0.8, v0: 0.25, v1: 0.8 };
const BOX_X0 = 0.8; const BOX_X1 = 52.9;   // inner box edges (cm)
const REACH_Y0 = 0; const REACH_Y1 = 26;   // vertical range (cm) mapped to the reach area

function currentReach() {
  const r = state.calib?.reach || DEFAULT_REACH;
  const k = +ui.reach.value / 100;           // >1 = larger area = more movement needed
  const cu = (r.u0 + r.u1) / 2; const cv = (r.v0 + r.v1) / 2;
  const hu = (r.u1 - r.u0) / 2 * k; const hv = (r.v1 - r.v0) / 2 * k;
  return { u0: cu - hu, u1: cu + hu, v0: cv - hv, v1: cv + hv };
}

/** Read the input and convert to {present, x, y, pinch, seq} in world cm. */
function readHand(now) {
  const inp = state.input;
  if (!inp) return null;
  const r = inp.read(now);
  if (inp.kind === 'mouse') {
    const w = renderer.toWorld(r.u, r.v);
    return { present: r.present, x: w.x, y: w.y, pinch: r.pinch, seq: r.seq, raw: r };
  }
  // Camera: smooth u, v with the One Euro filter, then map the reach area onto the box.
  if (!r.present) { state.wasPresent = false; return { present: false, x: null, y: null, pinch: false, seq: r.seq, raw: r }; }
  if (!state.wasPresent) { state.filters.u.reset(); state.filters.v.reset(); }
  state.wasPresent = true;
  const ts = r.t / 1000;
  const u = state.filters.u.filter(r.u, ts);
  const v = state.filters.v.filter(r.v, ts);
  const R = currentReach();
  const fx = (u - R.u0) / (R.u1 - R.u0);
  const fy = (R.v1 - v) / (R.v1 - R.v0);
  const x = Math.max(-4, Math.min(57.7, BOX_X0 + fx * (BOX_X1 - BOX_X0)));
  const y = Math.max(-1, Math.min(33, REACH_Y0 + fy * (REACH_Y1 - REACH_Y0)));
  return { present: true, x, y, pinch: r.pinch, ratio: r.ratioSmooth, seq: r.seq, raw: r };
}

// ---------------------------------------------------------------------------
// Trial flow
// ---------------------------------------------------------------------------
function validateForm() {
  const pid = ui.pid.value.trim();
  if (!pid) return 'Please enter the Participant ID.';
  const age = +ui.age.value;
  if (!ui.age.value || !(age >= 18 && age <= 100)) return 'Please enter an age between 18 and 100.';
  if (!ui.sex.value) return 'Please select sex.';
  if (!ui.dominant.value) return 'Please select the dominant hand.';
  return null;
}

async function askConsent(pid) {
  const existing = getConsent(pid);
  if (existing) return existing;
  $('consentTitle').textContent = CONSENT_TITLE;
  const box = $('consentText'); box.innerHTML = '';
  for (const para of CONSENT_TEXT) { const p = document.createElement('p'); p.textContent = para; box.appendChild(p); }
  $('consentAgree').textContent = CONSENT_BUTTON;
  ui.consent.returnValue = '';
  ui.consent.showModal();
  await new Promise((res) => ui.consent.addEventListener('close', res, { once: true }));
  if (ui.consent.returnValue !== 'agree') return null;
  const ts = new Date().toISOString();
  setConsent(pid, ts);
  return ts;
}

async function startTrial() {
  const err = validateForm();
  if (err) { setMsg(err, 'warn'); return; }
  setMsg('');
  const pid = ui.pid.value.trim();
  const consentTs = await askConsent(pid);
  if (!consentTs) { setMsg('The trial was not started because consent was not given.', 'warn'); return; }

  if (!state.input || state.input.kind !== ui.device.value) await connect();
  if (!state.input) { setMsg('Please connect the hand-tracking input first.', 'warn'); return; }
  if (state.input.kind === 'camera') {
    state.input.setTestedHand(testedHand());
    if (!state.calib) setMsg('Tip: run "Camera check & calibration" first for the most reliable pinch.', 'warn');
  }

  const practice = ui.practice.checked;
  const hand = testedHand();
  const device = state.input.kind;
  state.trial = {
    practice,
    duration: practice ? PRACTICE_DURATION : TEST_DURATION,
    meta: {
      sessionId: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)),
      timestamp: null,
      appVersion: APP_VERSION,
      participantId: pid,
      age: +ui.age.value,
      sex: ui.sex.value,
      dominantHand: ui.dominant.value,
      testedHand: hand,
      notes: ui.notes.value.trim(),
      device,
      viewMode: viewMode(),
      trialType: practice ? 'practice' : 'test',
      trialNumber: practice ? null : nextTrialNumber(pid, hand, device),
      consentTimestamp: consentTs,
    },
  };
  state.engine = new VBBTEngine({ testedHand: hand, duration: state.trial.duration, mode: viewMode() });
  state.phase = 'wait';
  state.handSince = null;
  ui.results.hidden = true;
  setRunning(true);
  ui.stage.scrollIntoView({ block: 'center' });
}

function setRunning(on) {
  fieldsets.forEach((f) => { f.disabled = on; });
  ui.start.disabled = on;
  ui.practice.disabled = on;
  ui.view.disabled = on;
  ui.abort.disabled = !on;
}

function abortTrial(reason = 'Trial aborted — not saved.') {
  if (state.setupAbort) { state.setupAbort.abort(); return; }
  if (!['wait', 'countdown', 'running'].includes(state.phase)) return;
  state.phase = 'idle';
  state.engine = null;
  setRunning(false);
  showOverlay(`<div class="msg">${esc(reason)}</div>`);
  setTimeout(() => { if (state.phase === 'idle') showOverlay(''); }, 2500);
}

function finishTrial() {
  const e = state.engine;
  const tr = state.trial;
  const sum = e.summary();
  const cam = state.input?.kind === 'camera';
  const inputFps = cam ? Math.round((state.camSamples / tr.duration) * 10) / 10 : null;
  const c = state.calib;
  const row = {
    ...tr.meta,
    ...sum,
    inputFps,
    lowFpsFlag: cam ? inputFps < FPS_WARNING : false,
    setup: {
      cameraResolution: cam ? `${state.inputInfo.width}x${state.inputInfo.height}` : null,
      processing: cam ? state.inputInfo.delegate : null,
      processingMsPerFrame: cam ? state.inputInfo.timings : null,
      calibrated: !!c,
      checkFps: c?.fps ?? null,
      brightness: c?.brightness ?? null,
      lighting: c?.brightnessHint ?? null,
      palmSize: c?.palmSize ?? null,
      distance: c?.distanceHint ?? null,
      pinchOpenRatio: c?.openRatio ?? null,
      pinchClosedRatio: c?.pinchRatio ?? null,
      pinchSensitivity: +ui.sens.value,
      pinchThresholds: cam ? pinchThresholds(c ? { open: c.openRatio, pinch: c.pinchRatio } : null, +ui.sens.value) : null,
      reachScale: +ui.reach.value,
      reachArea: cam ? currentReach() : null,
      calibratedAt: c?.completedAt ?? null,
      handednessInverted: cam ? state.input.invert : null,
      handSelection: cam ? (state.input.allowSingle ? 'label, or the only visible hand' : 'label (checked)') : null,
      screen: `${screen.width}x${screen.height}@${window.devicePixelRatio || 1}`,
      userAgent: navigator.userAgent,
    },
  };
  // Round the reach area/thresholds for readability.
  for (const obj of [row.setup.reachArea, row.setup.pinchThresholds]) {
    if (obj) for (const k of Object.keys(obj)) obj[k] = Math.round(obj[k] * 1000) / 1000;
  }

  state.phase = 'done';
  setRunning(false);
  if (!tr.practice) {
    const ok = saveSession(row);
    saveLastTrial({ summary: row, events: e.events, samples: e.samples });
    if (!ok) setMsg('WARNING: the browser storage is full. Download the CSV now and clear old data.', 'warn');
  }
  showOverlay(`<div class="msg">Time is up! ${tr.practice ? 'Practice finished.' : ''}</div>`);
  setTimeout(() => { if (state.phase === 'done') showOverlay(''); }, 3000);
  showResults(row, tr.practice);
  renderSessions();
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
function frame(now) {
  requestAnimationFrame(frame);
  if (state.phase === 'setup') return;   // the setup check draws on the stage itself

  const hand = readHand(now);
  const isCam = state.input?.kind === 'camera';
  const fresh = hand && (hand.seq !== state.lastSeq);

  // Tracking indicator
  if (!hand) { ui.hudTrack.textContent = '–'; ui.hudTrack.className = 'hud-value track'; }
  else if (hand.present) { ui.hudTrack.textContent = 'Tracked'; ui.hudTrack.className = 'hud-value track ok'; }
  else { ui.hudTrack.textContent = 'Not seen'; ui.hudTrack.className = 'hud-value track lost'; }

  const name = testedHand() === 'left' ? 'LEFT' : 'RIGHT';
  if (state.phase === 'wait') {
    if (hand?.present) {
      if (state.handSince == null) state.handSince = now;
      if (now - state.handSince > 600) { state.phase = 'countdown'; state.countdownStart = now; }
    } else state.handSince = null;
    showOverlay(state.input?.kind === 'mouse'
      ? '<div class="msg">Move the mouse over the box to begin</div>'
      : `<div class="msg">Show your ${name} hand to the camera</div>`);
  } else if (state.phase === 'countdown') {
    const left = 3 - Math.floor((now - state.countdownStart) / 1000);
    if (left <= 0) {
      state.phase = 'running';
      state.t0 = now;
      state.lastSeq = hand ? hand.seq : -1;
      state.lastUpdate = now;
      state.camSamples = 0;
      state.trial.meta.timestamp = new Date().toISOString();
      state.engine.log('start', { duration: state.trial.duration });
      showOverlay('');
    } else showOverlay(`<div class="count">${left}</div>`);
  }

  if (state.phase === 'running') {
    const t = (now - state.t0) / 1000;
    // Camera: update on every new camera frame (or every 50 ms if frames stop arriving).
    if (!isCam || fresh || now - state.lastUpdate > 50 || t >= state.trial.duration) {
      if (isCam && fresh) state.camSamples++;
      state.engine.update(t, hand || { present: false });
      state.lastUpdate = now;
    }
    ui.hudTime.textContent = Math.max(0, Math.ceil(state.trial.duration - t));
    ui.hudScore.textContent = state.engine.score();
    if (state.engine.finished) finishTrial();
  } else if (state.phase !== 'done') {
    ui.hudTime.textContent = ui.practice.checked ? PRACTICE_DURATION : TEST_DURATION;
    if (state.phase === 'idle') ui.hudScore.textContent = '0';
  }
  if (hand) state.lastSeq = hand.seq;

  const eng = state.engine || state.idleEngine;
  if (!state.engine && (state.idleEngine.testedHand !== testedHand() || state.idleEngine.mode !== viewMode())) {
    state.idleEngine = new VBBTEngine({ testedHand: testedHand(), mode: viewMode() });
  }
  renderer.draw(eng, {
    cursor: hand && hand.x != null ? { x: hand.x, y: hand.y, pinch: hand.pinch, present: hand.present }
      : (eng.cursor ? { ...eng.cursor, present: false, pinch: false } : null),
    highlight: ui.highlight.checked && state.phase === 'running',
  });
}

// ---------------------------------------------------------------------------
// Setup check
// ---------------------------------------------------------------------------
async function runSetup() {
  if (state.input?.kind !== 'camera') return;
  state.input.setTestedHand(testedHand());
  state.phase = 'setup';
  state.setupAbort = new AbortController();
  setRunning(true);
  ui.start.disabled = true;
  ui.stage.scrollIntoView({ block: 'center' });
  try {
    const res = await runSetupCheck({
      cam: state.input, canvas: ui.stage, overlay: ui.overlay, testedHand: testedHand(), signal: state.setupAbort.signal,
    });
    state.calib = { ...res, participantId: ui.pid.value.trim(), hand: testedHand() };
    applyPinchSettings();
    const warn = res.warnings.length > 0;
    setStatus(ui.calibStatus, `Calibrated for ${state.calib.participantId || 'this participant'}, ${testedHand()} hand. ` +
      `${res.fps} fps, lighting ${res.brightnessHint}, distance ${res.distanceHint}.` + (warn ? ' See warnings.' : ''), warn ? 'warn' : 'ok');
    await new Promise((r) => setTimeout(r, 3500));
  } catch (e) {
    if (state.input?.kind === 'camera') { state.input.allowSingle = true; state.input.continuity = true; }
    const msg = e.message === 'cancelled' ? 'Camera check cancelled.' : e.message === 'timeout'
      ? 'Camera check timed out — the hand was not seen clearly. Check lighting and distance, then try again.' : friendlyError(e);
    setStatus(ui.calibStatus, msg, 'warn');
  }
  state.setupAbort = null;
  state.phase = 'idle';
  showOverlay('');
  setRunning(false);
  renderer.resize();
}

// ---------------------------------------------------------------------------
// Results and saved sessions
// ---------------------------------------------------------------------------
const RESULT_ROWS = [
  ['Blocks per minute', 'blocksPerMinute'],
  ['Grasp attempts', 'graspAttempts'],
  ['Successful grasps', 'successfulGrasps'],
  ['Missed grasps', 'missedGrasps'],
  ['Failed releases (dropped on pick-up side)', 'failedReleases'],
  ['Blocks returned to pick-up side', 'returns'],
  ['Time to first transfer (s)', 'timeToFirstTransfer'],
  ['Transfer cycle time, mean (s)', 'cycleTimeMean'],
  ['Transfer cycle time, SD (s)', 'cycleTimeSD'],
  ['Carry path length, mean (cm)', 'carryPathMean'],
  ['Carry speed, mean (cm/s)', 'carrySpeedMean'],
  ['Peak speed (cm/s)', 'peakSpeed'],
  ['Clearance above partition, mean (cm)', 'clearanceMean'],
  ['Tracking-loss episodes', 'trackingLossEpisodes'],
  ['Tracking lost, total (s)', 'trackingLostTime'],
  ['Forced releases (tracking loss)', 'forcedReleases'],
  ['Camera frame rate (fps)', 'inputFps'],
];

function showResults(row, practice) {
  ui.results.hidden = false;
  ui.resultsTitle.textContent = practice ? 'Practice result (not saved)' : `Result — ${row.participantId}, ${row.testedHand} hand, trial ${row.trialNumber}`;
  ui.resScore.textContent = row.score;
  ui.resFlag.hidden = !row.lowFpsFlag;
  ui.resFlag.textContent = row.lowFpsFlag ? `Low camera frame rate (${row.inputFps} fps < ${FPS_WARNING}). Consider repeating this trial.` : '';
  ui.resTable.innerHTML = '';
  for (const [label, key] of RESULT_ROWS) {
    if (key === 'inputFps' && row.inputFps == null) continue;
    const tr = document.createElement('tr');
    const a = document.createElement('td'); a.textContent = label;
    const b = document.createElement('td'); b.textContent = row[key] == null ? '–' : row[key];
    tr.append(a, b); ui.resTable.appendChild(tr);
  }
  ui.results.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderSessions() {
  const rows = loadSessions().slice().reverse();
  ui.sessionsBody.innerHTML = '';
  if (!rows.length) {
    const tr = document.createElement('tr'); const td = document.createElement('td');
    td.colSpan = 10; td.textContent = 'No sessions saved yet.'; tr.appendChild(td); ui.sessionsBody.appendChild(tr);
    return;
  }
  for (const r of rows) {
    const tr = document.createElement('tr');
    const d = r.timestamp ? new Date(r.timestamp) : null;
    const cells = [
      d ? d.toLocaleString() : '', r.participantId, r.age, r.testedHand, r.device, r.trialNumber,
      r.score, r.blocksPerMinute, r.inputFps ?? '–', r.lowFpsFlag ? 'Low FPS' : '',
    ];
    for (const c of cells) { const td = document.createElement('td'); td.textContent = c ?? ''; tr.appendChild(td); }
    ui.sessionsBody.appendChild(tr);
  }
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
ui.connect.addEventListener('click', connect);
ui.device.addEventListener('change', () => { disconnect(); setStatus(ui.devStatus, 'Not connected'); ui.connect.textContent = 'Connect'; });
ui.setupBtn.addEventListener('click', runSetup);
ui.start.addEventListener('click', startTrial);
ui.abort.addEventListener('click', () => abortTrial());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') abortTrial(); });

ui.reach.addEventListener('input', () => { ui.reachOut.textContent = ui.reach.value + '%'; });
ui.sens.addEventListener('input', () => { ui.sensOut.textContent = ui.sens.value; applyPinchSettings(); });
ui.pid.addEventListener('change', () => resetCalibration('participant changed'));
document.querySelectorAll('input[name=hand]').forEach((r) => r.addEventListener('change', () => {
  if (state.input?.kind === 'camera') state.input.setTestedHand(testedHand());
  resetCalibration('tested hand changed');
}));
ui.view.addEventListener('change', () => {
  renderer = viewMode() === '3d' ? new Renderer3D(ui.stage) : new Renderer(ui.stage);
});
ui.practice.addEventListener('change', () => { ui.hudTime.textContent = ui.practice.checked ? PRACTICE_DURATION : TEST_DURATION; });

ui.dlCsv.addEventListener('click', () => {
  const rows = loadSessions();
  if (!rows.length) { setMsg('There are no saved sessions yet.', 'warn'); return; }
  download(`vbbt_sessions_${stamp()}.csv`, toCSV(rows), 'text/csv');
});
ui.dlJson.addEventListener('click', () => {
  const last = loadLastTrial();
  if (!last) { setMsg('No test trial has been saved yet.', 'warn'); return; }
  download(`vbbt_${last.summary.participantId}_${last.summary.testedHand}_trial${last.summary.trialNumber}_${stamp()}.json`,
    JSON.stringify(last, null, 1), 'application/json');
});
ui.clearData.addEventListener('click', () => {
  const n = loadSessions().length;
  if (!confirm(`Delete ALL ${n} saved sessions and consent records from this browser?\n\nDownload the CSV first if you need the data. This cannot be undone.`)) return;
  clearAll();
  renderSessions();
  setMsg('All saved data was deleted from this browser.', 'ok');
});

window.addEventListener('resize', () => renderer.resize());
new ResizeObserver(() => renderer.resize()).observe(ui.stage);

renderSessions();
requestAnimationFrame(frame);

// Offline support: cache the app after the first visit (https or localhost only).
if ('serviceWorker' in navigator && window.isSecureContext && location.protocol !== 'file:' && !window.VBBT_SINGLE_FILE) {
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Service worker not registered', e));
}

// Exposed for automated tests and debugging in the browser console.
window.vbbt = { state, get renderer() { return renderer; } };
