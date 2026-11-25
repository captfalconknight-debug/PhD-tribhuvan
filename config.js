/**
 * config.js — settings the researcher may edit without touching the rest of the code.
 */

export const APP_VERSION = '1.6.0';

/** Trial durations in seconds. */
export const TEST_DURATION = 60;
export const PRACTICE_DURATION = 15;

/** Trials whose measured camera frame rate is below this are flagged. */
export const FPS_WARNING = 25;

/** Where the MediaPipe files live (relative to index.html). */
export const MEDIAPIPE_LOCAL = './vendor/mediapipe/';
/**
 * Fallback used ONLY if the local files cannot be loaded (e.g. the single-file
 * build opened directly from disk). Set to null to forbid any CDN use.
 */
export const MEDIAPIPE_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/';
export const MEDIAPIPE_MODEL_CDN =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

/**
 * Starting assumption for MediaPipe's left/right labels. The camera check
 * detects automatically if they are swapped on a laptop, so leave this false.
 */
export const HANDEDNESS_INVERTED = false;

/**
 * Consent text shown before a participant's first trial.
 * REPLACE THIS with the wording approved by your ethics committee.
 * Each array item is one paragraph.
 */
export const CONSENT_TITLE = 'Participant consent';
export const CONSENT_TEXT = [
  '[Placeholder - replace with the consent text approved by your ethics committee.]',
  'This test uses the laptop camera to follow the movement of your hand. The video is processed only on this laptop. No video or pictures are recorded, stored or sent anywhere. Only the test scores and movement measurements are saved.',
  'Taking part is voluntary. You can stop at any time without giving a reason.',
];
export const CONSENT_BUTTON = 'I have read this and I agree to take part';
