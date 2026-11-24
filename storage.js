/**
 * storage.js — saving sessions in this browser (localStorage) and exporting them.
 *
 * Data never leaves the laptop unless the researcher downloads it.
 * Saved per browser: one summary row per test trial, plus the full detail
 * (events + raw samples) of the LAST trial only.
 */
const KEY_SESSIONS = 'vbbt.sessions.v1';
const KEY_LAST = 'vbbt.lastTrial.v1';
const KEY_CONSENT = 'vbbt.consent.v1';

function readJSON(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { console.error('Storage failed', e); return false; }
}

export function loadSessions() { return readJSON(KEY_SESSIONS, []); }

/** Save a test trial summary row; returns false if storage is full/blocked. */
export function saveSession(row) {
  const all = loadSessions();
  all.push(row);
  return writeJSON(KEY_SESSIONS, all);
}

export function saveLastTrial(detail) {
  if (!writeJSON(KEY_LAST, detail)) {
    // Raw samples may not fit: keep the summary and events at least.
    writeJSON(KEY_LAST, { ...detail, samples: [], samplesDropped: true });
  }
}
export function loadLastTrial() { return readJSON(KEY_LAST, null); }

export function clearAll() {
  for (const k of [KEY_SESSIONS, KEY_LAST, KEY_CONSENT]) { try { localStorage.removeItem(k); } catch { /* ignore */ } }
}

/** Consent timestamps per participant ID. */
export function getConsent(pid) { return readJSON(KEY_CONSENT, {})[pid] || null; }
export function setConsent(pid, iso) {
  const all = readJSON(KEY_CONSENT, {});
  all[pid] = iso;
  writeJSON(KEY_CONSENT, all);
}

/** Next trial number for a participant / hand / device (for test–retest analysis). */
export function nextTrialNumber(pid, hand, device) {
  return loadSessions().filter((s) => s.participantId === pid && s.testedHand === hand && s.device === device).length + 1;
}

/** Flatten nested objects: {a:{b:1}} -> {"a.b":1} — used for CSV columns. */
export function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = Array.isArray(v) ? JSON.stringify(v) : v;
  }
  return out;
}

function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** All rows -> CSV text. Columns = union of all keys, in first-seen order. */
export function toCSV(rows) {
  const flat = rows.map((r) => flatten(r));
  const cols = [];
  for (const r of flat) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  const lines = [cols.join(',')];
  for (const r of flat) lines.push(cols.map((c) => csvCell(r[c])).join(','));
  return lines.join('\r\n');
}

/** Ask the browser to save a text file. */
export function download(filename, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
