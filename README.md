# Virtual Box and Block Test (VBBT)

A web app that runs the Box and Block Test with the laptop's built-in webcam. The participant pinches with thumb and index finger to pick up virtual blocks, lifts them over the partition and drops them in the other compartment. Hand tracking runs inside the browser (Google MediaPipe). **No video or images ever leave the laptop**, and only scores and movement measures are saved.

Research prototype for the PhD project "Non-immersive virtual reality with optical hand tracking". The exact rules and metric definitions are in [`docs/METHODS.md`](docs/METHODS.md). How to put it online is in [`docs/HOSTING.md`](docs/HOSTING.md).

---

## 1. Running it

### Online (recommended)
Open **https://captfalconknight-debug.github.io/PhD-tribhuvan/** in **Google Chrome** or **Microsoft Edge**. The first visit downloads about 30 MB (the hand-tracking model). After that the app also works **offline** on that laptop.

### On one laptop without internet hosting
1. Install Python 3 (https://www.python.org/downloads/).
2. Open a terminal in this folder and run:
   ```bash
   python -m http.server 8000
   ```
3. Open `http://localhost:8000` in Chrome or Edge.

> The camera only works on `https://` pages or on `http://localhost`. Double-clicking `index.html` (`file://`) does **not** work.

### Single-file version
`dist/vbbt.html` holds all the app code in one file. On the hosted site it is at `https://captfalconknight-debug.github.io/PhD-tribhuvan/dist/vbbt.html`. Copied anywhere else on its own, it still works in mouse mode. Webcam mode then downloads MediaPipe from the internet (jsDelivr CDN) because the bundled model files are not next to it. To rebuild it after editing the code:
```bash
node scripts/build-single.js
```

---

## 2. Running a session (step by step)

1. **Participant form:** enter the ID (a code such as P001, never a name), age, sex, dominant hand and tested hand.
2. **Input:** choose *Laptop webcam* and press **Connect**. Allow the camera when the browser asks. The first time, loading takes up to a minute.
3. **Camera check & calibration:** press it and follow the four on-screen steps (camera, open hand, pinch, reach). Do this for **each participant and each hand**. Changing the participant ID or the tested hand clears the calibration.
4. **View:** *3D view* (default) shows the box in perspective with all 150 blocks. *2D front view* is the earlier flat version. Pick one for your study and keep it for everyone.
5. **Practice:** tick *Practice trial* and press **Start**. It lasts 15 s and is not saved.
6. **Test:** untick *Practice* and press **Start**. On a participant's first trial the consent screen appears; once they agree, the timestamp is stored. The app waits for the hand, counts down 3-2-1, then runs for 60 s.
7. The **result** card appears and the trial is saved in this browser.
8. **Download all sessions (CSV)** at the end of each day. Data is stored only in this browser on this laptop. Clearing browser data deletes it. **Download last trial (JSON)** straight after a trial if you need the raw movement samples, because only the most recent trial's raw data is kept.

**Esc** or **Abort** stops a trial without saving it.

### Webcam set-up tips
- **Lighting:** light in front of the participant (a lamp or window facing them). No bright window behind them.
- **Background:** plain and uncluttered behind the hand. Avoid skin-coloured backgrounds.
- **Camera height:** about chest height. Put the laptop on a box or books if needed, with the screen tilted so the hand is in view.
- **Distance:** hand 40–60 cm from the camera. The camera check says "closer" or "further".
- **Posture:** seated, palm roughly towards the screen, pinch visible to the camera. Keep the other hand resting out of view.
- **Laptop:** plugged into the charger (battery saving lowers the frame rate). Close Zoom/Teams and other camera apps.
- Trials with a camera frame rate below 25 fps are flagged in the results and the CSV.

### If the frame rate is low (below 25 fps)
1. **Plug in the charger** and set Windows to **Best performance** (Settings → System → Power → Power mode). On battery, laptops slow the processor down.
2. **Close other programs and browser tabs**, especially Zoom/Teams, video and other camera apps.
3. **Turn on graphics acceleration in Chrome/Edge:** Settings → System → *Use graphics acceleration when available* → on, then restart the browser. After Connect, the status line says *GPU processing* or *CPU processing*; the app picks whichever is faster on that laptop.
4. **Show only the tested hand.** The app tracks one hand; if the other hand is in view, tracking is slower and can lock onto the wrong hand.
5. Good **lighting** also helps: tracking recovers faster when the hand is clearly visible.
6. **Gaming laptops with two graphics chips** (e.g. HP Victus, with NVIDIA or AMD graphics): in Windows Settings → System → Display → Graphics, set Chrome/Edge to **High performance** so the browser uses the faster graphics card. Keep the laptop plugged in: these laptops slow down a lot on battery.
7. **Dim light can lower the frame rate by itself:** many webcams lengthen the exposure in poor light and deliver only about 15 frames per second, however fast the laptop is. If the status line shows a low processing time (e.g. under 25 ms) but the frame rate is still low, add light in front of the participant.
8. Check the result: the low-FPS message shows the hand-tracking time per frame. Above about 40 ms means the laptop itself is too slow for 25 fps. Use a faster laptop for data collection, and record the device (it is saved with each trial).

### Using a phone as the camera
The phone only supplies the picture; hand tracking still runs on the laptop.

1. **Connect the phone as a webcam.** Use one of these:
   - **Android + Windows 11:** Settings → Bluetooth & devices → *Mobile devices* → turn on *Allow this PC to access your mobile devices*, link the phone, and turn on its camera for "connected camera". No extra app is needed.
   - **Any Android or iPhone:** a webcam app with a Windows driver, for example *Camo*, *DroidCam* or *Iriun Webcam* (install it on both the phone and the laptop). **Use a USB cable** if the app allows it: it gives less delay and a steadier frame rate than Wi-Fi.
2. In the VBBT, choose *Laptop webcam* and press **Connect** once. Then pick the phone in the **Camera** list. The app reconnects with it.
3. **Check the mirroring.** In the small preview, raise your **right** hand. It must appear on the **right** side, like a mirror. If it appears on the left, tick **Camera image is already mirrored** (some phone apps mirror the picture themselves). If the app has its own mirror setting, you can switch that off instead.
4. Put the phone on a **stand at chest height**, in landscape orientation, 40–60 cm from the hand, and keep it on the charger.
5. Run **Camera check & calibration** again (changing the camera clears the calibration).

> **For your studies:** a phone camera is a different measurement device from the laptop webcam. The camera name and mirror setting are saved with every trial (`setup.cameraLabel`, `setup.cameraMirroredInput`). Use the same camera set-up for all participants, or test agreement before pooling data.

### Changing the consent text
Edit `CONSENT_TEXT` in `config.js` with your ethics-approved wording, then update the hosted site (see `docs/HOSTING.md`).

### Data and privacy
- Video is processed in memory by MediaPipe inside the browser. Nothing is recorded or uploaded.
- The app makes **no network requests** after loading. The bundled MediaPipe version (0.10.35) was chosen because newer versions (1.x) send usage metrics to Google.
- Saved data stays in the browser's local storage on that laptop until you download or clear it.

---

## 3. What was tested, and what could not be

**Automated tests (all passing):**
```bash
npm test         # 25 unit tests: game engine, pinch/hand maths, smoothing filter
npm run smoke    # browser test (3D view; VBBT_VIEW=2d for 2D): full practice + 60 s trial in mouse mode, saving, CSV/JSON export,
                 # webcam pipeline loads the bundled model, camera check starts/cancels, no external requests
node tests/smoke.mjs dist/vbbt.html   # same test on the single-file build
```
The smoke test needs Playwright (`npm i -D playwright && npx playwright install chromium`).

**Not tested (needs real hardware and people):** tracking of a real hand with a real laptop webcam, including pinch reliability, the left/right label check, the reach calibration, frame rates on your laptops and the experience of older adults. The automated tests use a synthetic camera picture that contains no hand. Use the checklist below before collecting data.

### Hardware test checklist (do this on every laptop model you will use)
- [ ] The page loads over https; Connect shows "Camera ready" with a resolution and processing type.
- [ ] The small preview shows a mirrored image: raising the right hand shows it on the right.
- [ ] The camera check completes all 4 steps for the right hand **and** for the left hand.
- [ ] If the camera check says "left/right labels are swapped … corrected", the trial still follows the correct hand.
- [ ] Frame rate in the camera check is ≥ 25 fps (charger plugged in).
- [ ] Pinch closes reliably when thumb and index touch, and does not close with the hand relaxed and open. Watch the **pinch meter** under the camera preview: the bar shows the gap between thumb and index. When it shrinks past the **green** line it turns yellow ("PINCH - holding"); the block is let go only after it grows past the **red** line. If pinching is hard, raise the sensitivity; if the block is hard to let go, lower it. **Keep the setting constant** within the study.
- [ ] A block can be picked up from every column, including the far edge and the bottom layer.
- [ ] A block can be lifted over the partition without strain at the chosen reach area.
- [ ] The hand never drops out at the edges of the reach area.
- [ ] Hiding the hand briefly while carrying (< ½ s) keeps the block; longer drops it.
- [ ] While carrying a block with a steady pinch, moving fast does not drop it (watch the pinch meter stay yellow).
- [ ] Practice and test trials run, the result appears, and CSV and JSON download and open in Excel/SPSS/R.
- [ ] Results are similar for the same person on two runs (quick test–retest check).
- [ ] Repeat in the actual testing room with its real lighting.
- [ ] Turn off Wi-Fi after the first load and reload: the app still works (offline cache).

---

## 4. Files

| File | Purpose |
|---|---|
| `index.html`, `styles.css` | Page layout and styles (large, high-contrast) |
| `app.js` | User interface, trial flow, hand-to-box mapping, saving and export |
| `engine.js` | Game rules, physics, scoring and metrics (no browser code; unit-tested) |
| `render.js` | Draws the 2D front view |
| `render3d.js` | Draws the 3D perspective view (own projection maths, no 3D library) |
| `setup.js` | Camera check and calibration wizard |
| `inputs/camera.js` | Webcam + MediaPipe hand tracking |
| `inputs/handmath.js` | Pinch ratio, hysteresis, hand selection (pure functions) |
| `inputs/mouse.js` | Mouse simulation mode for development and demonstrations |
| `filters.js` | One Euro smoothing filter |
| `storage.js` | Local storage, CSV/JSON export |
| `config.js` | **Settings you may edit:** consent text, durations, FPS warning level |
| `sw.js` | Offline cache |
| `vendor/mediapipe/` | Bundled MediaPipe 0.10.35 and the hand model (Apache-2.0) |
| `tests/` | Unit tests and the browser smoke test |
| `scripts/build-single.js` | Builds `dist/vbbt.html` |
| `docs/METHODS.md` | Exact rules and metric definitions for papers |
| `docs/HOSTING.md` | Step-by-step guide to putting it online with GitHub Pages |

## 5. Licences
App code: MIT. MediaPipe and the hand landmarker model: Apache License 2.0 (Google).
