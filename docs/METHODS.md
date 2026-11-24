# Virtual Box and Block Test (VBBT): rules and metric definitions

This document describes exactly what the software does, in wording that can be adapted for the methods section of a paper or thesis. Values refer to app version 1.1.0. All numbers here are taken directly from the source code (`engine.js`, `inputs/handmath.js`, `app.js`, `setup.js`, `filters.js`, `config.js`).

---

## 1. Virtual apparatus

The VBBT reproduces the standard Box and Block Test (BBT) as a two-dimensional front view of the box, rendered in a web browser (HTML5 Canvas). All geometry is defined in centimetres in a virtual coordinate system: *x* runs left to right from the outer left edge of the box, and *y* runs upward from the box floor.

| Element | Value |
|---|---|
| Box outer length | 53.7 cm |
| Box wall height | 8.5 cm |
| Box depth | 25.4 cm (not shown in the front view) |
| Partition height (from box floor) | 15.2 cm, at the centre |
| Block size | 2.5 × 2.5 cm |
| Total blocks | 150 |
| Wall thickness *(simulation assumption)* | 0.8 cm |
| Partition thickness *(simulation assumption)* | 1.0 cm |
| Inner width of each compartment | 25.55 cm, which holds 10 columns of blocks |

Because the view is from the front, a block has to be **lifted over the partition** to reach the other compartment. That reproduces the lift-carry-release movement of the physical test.

**Source and target compartments.** Blocks are picked up from the compartment on the same side as the tested hand and placed in the opposite compartment. For example, when the right hand is tested, blocks start on the right and go to the left. The screen shows a mirror view, so the participant's right hand appears on the right of the screen. The target compartment is tinted green, and the labels "PICK UP HERE" and "PLACE HERE" are shown above the compartments.

### 1.1 Display modes: 3D view (default) and 2D front view

The app has two display modes, chosen before a trial and recorded with it (`viewMode`). The task rules, hand tracking, scoring and metrics are the same in both. They differ in how the box is drawn and in how the depth of the pile is handled.

**3D view (`viewMode = 3d`, default).** The box is drawn in perspective, as seen from in front of and above it. A virtual pinhole camera is placed at (26.85, 46, −50) cm looking at (26.85, 6, 13) cm, about 33° downwards. Each block is drawn as a shaded cube, and blocks are painted from far to near. The front wall is drawn see-through (22 % opacity) so the pile is visible. **All 150 blocks are shown as a real pile.** Each compartment holds 10 columns (left–right) × 9 rows (front–back) per layer, given an inner depth of 23.8 cm. At the start, the bottom layer of the source compartment is full (90 blocks). The other 60 blocks sit on top of 60 positions picked by a seeded random shuffle (seed 150), so every participant gets the identical starting pile. No blocks are hidden and no reserve is used.

*Depth is handled automatically.* A laptop webcam cannot reliably measure how far the hand reaches forwards or backwards, so the hand controls only the left–right position and the height (as in the 2D view), and the depth row is set by fixed rules:
- **Grasping:** among uncovered blocks equally close to the cursor (the same column and height in different rows), the block in the **front-most** row is taken.
- **Carrying:** once the held block's bottom is above the box walls (8.5 cm), its row is continuously set to the row it would land in (see below). A shadow on the pile shows where it will drop.
- **Landing:** a released block drops into the depth row where the stack under it is **lowest** at that left–right position. On a tie, the row nearest its current row is used, and after that the front-most row. Blocks therefore spread across the compartment instead of forming towers, much as real blocks tumble and scatter.
- In mouse-simulation mode the pointer moves in the vertical plane through the centre of the front row.

**2D front view (`viewMode = 2d`).** A flat front view of the box. Because a front view cannot show depth, only three layers × 10 columns are drawn per compartment, and the depth of the pile is simulated with a hidden reserve (see "Depth simulation" in Section 4).

> The two modes are different versions of the instrument. Choose one before data collection and use it for all participants. Do not pool scores across modes without an agreement analysis.

## 2. Hand tracking (laptop webcam)

**Device and model.** The laptop's built-in webcam is requested at 640 × 480 pixels and 30 frames per second (the browser may give a different resolution; the actual one is recorded). Hands are detected with Google MediaPipe Hand Landmarker (`@mediapipe/tasks-vision` 0.10.35, `hand_landmarker.task` float16 model, version 1). It runs entirely inside the browser on the participant's laptop. Video frames are processed in memory only: no images or video are recorded, stored or transmitted, and the app makes no network requests once loaded. The model returns 21 landmarks per hand in image coordinates and in approximate 3D "world" coordinates (metres), plus a left/right label. Up to two hands are detected, with confidence thresholds of 0.5 for detection, presence and tracking.

**Processing back-end.** When the camera is connected, the model is created with both the GPU (WebGL) and CPU (XNNPACK) back-ends. Each is timed on five frames of the live video, and the faster one is kept. The chosen back-end and its time per frame are recorded with every trial.

**Tested-hand selection.** Only the hand whose label matches the tested hand is used. Whether MediaPipe's labels refer to the participant's own hand depends on whether the camera image is mirrored. This is checked once per laptop during the camera check (Section 3): if the only visible hand keeps the opposite label for about 1 second, the labels are treated as swapped. The result is recorded (`setup.handednessInverted`). Before the camera check has been done, a single visible hand is used even if its label does not match (`setup.handSelection`).

**Cursor position.** The cursor is the midpoint between the thumb tip (landmark 4) and the index fingertip (landmark 8) in image coordinates, mirrored horizontally (*u* = 1 − *x*) so that movement on screen matches a mirror.

**Smoothing.** *u* and *v* are each smoothed with a One Euro filter (Casiez et al., 2012) with minimum cutoff 1.0 Hz, speed coefficient β = 4.0 and derivative cutoff 1.0 Hz. The filter is reset whenever the hand reappears after a tracking loss.

**Mapping hand movement to the box (reach area).** A rectangle in the camera image, the reach area, is mapped linearly onto the box:

- the left and right edges of the reach area map to the inner left and right walls of the box (*x* = 0.8 and 52.9 cm);
- the bottom and top edges map to *y* = 0 cm (box floor) and *y* = 26 cm (10.8 cm above the partition top).

The reach area comes from the participant's calibration (Section 3). If no calibration has been done, a default area is used (*u* 0.20 to 0.80, *v* 0.25 to 0.80 of the image). The reach-area slider scales the rectangle about its centre (50–150 %; 100 % is the default). The reach area used in each trial is recorded.

> **Important for interpreting kinematic measures:** distances, speeds and clearances are reported in **virtual box centimetres**. They describe movement of the virtual block, which is a scaled version of the hand's movement in the camera image. They are not real-world hand displacements.

**Pinch (grasp) detection.**

*Pinch ratio* = 3D distance between thumb tip (4) and index tip (8) ÷ 3D distance between wrist (0) and middle-finger MCP joint (9), computed from MediaPipe world landmarks. Normalising by a hand-size reference makes the ratio largely independent of hand size and of distance from the camera.

The pinch state uses **hysteresis**: the hand is "pinched" when the ratio falls below the *close* threshold, and "open" again only when it rises above the higher *open* threshold. This stops the state flickering near a single threshold.

- *Calibrated thresholds:* with *R*_open the median ratio with the hand open and *R*_pinch the median ratio while pinching (Section 3), and *r* = *R*_open − *R*_pinch:
  close = *R*_pinch + 0.35*r*, open = *R*_pinch + 0.55*r*.
- *Default thresholds (no calibration):* close = 0.30, open = 0.45.
- *Pinch-sensitivity slider (1–10, default 5):* both thresholds are multiplied by 1 + 0.08 × (sensitivity − 5). Higher values make a pinch easier to detect.

## 3. Camera check and calibration (before testing)

Run once per participant and tested hand, before the trials. The stage shows the large mirrored camera image with the hand skeleton.

1. **Camera (2.5 s):** the detection frame rate and the mean image brightness (0–255, from a 64 × 48 down-sampled image) are measured. Brightness below 60 is flagged as too dark and above 210 as too bright. A frame rate below 25 fps is flagged.
2. **Open hand:** the participant holds up only the tested hand, fingers open (pinch ratio > 0.5), palm towards the screen. It must be held still (wrist movement < 0.04 in normalised image coordinates over the last 20 frames) and at an acceptable distance for 3 s continuously. The distance cue is the palm length (wrist to middle MCP) as a fraction of image width: < 0.09 is too far, > 0.24 is too close. The median open-hand ratio and palm size are recorded. The left/right label check (Section 2) happens in this step.
3. **Pinch:** the participant touches thumb and index tips together for 2 s continuously (ratio < 0.45 × open ratio). The median pinch ratio is recorded.
4. **Reach:** the participant moves the hand slowly as far left, right, up and down as is comfortable while seated, for 8 s of tracked time. The reach area is the 3rd to 97th percentile of the cursor positions on each axis. If the movement covers less than 15 % of the image width or 12 % of its height, the default reach area is used and a warning is shown.

All camera-check results are stored with every trial that follows (columns `setup.*`).

## 4. Task rules

**Starting state.** In the 3D view all 150 blocks are in the source compartment (Section 1.1). In the 2D view the source compartment shows 30 blocks (3 layers × 10 columns), and the other 120 blocks are in a hidden reserve representing the depth of the real pile (see "Depth simulation" below).

**Trial sequence.** Consent is recorded once per participant ID. The app then waits until the tested hand has been detected continuously for 0.6 s, shows a 3-2-1 countdown (1 s per number), and runs the test for **60 s**. An optional **15 s practice trial** follows the same rules and is not saved.

**Grasping.** A grasp attempt is the moment the pinch closes (open to pinched) while no block is held. The block grasped is the **nearest uncovered resting block** whose centre is within **3.0 cm** of the cursor ("uncovered" means no block rests on top of it). If there is no such block, the attempt is a *missed grasp*. Keeping the pinch closed and moving over a block does not grasp it; the hand must open and pinch again. The offset between the cursor and the block centre at the moment of grasping is kept during the carry, so the block does not jump. Only one block can be held at a time. Blocks can also be grasped from the target compartment.

**Carrying.** The held block follows the cursor but cannot pass through the partition. Each frame, the movement is split into sub-steps of at most 0.2 cm. Horizontal and vertical movements are resolved separately, and any sub-step that would overlap the partition is stopped at its surface. A block held lower than the partition top therefore cannot "tunnel" through it, even if the cursor jumps between frames. The held block is kept between the inner box walls and between the box floor and 34 cm. It passes over other blocks without colliding (simplification).

**Releasing.** Opening the pinch releases the block. It falls under gravity (981 cm/s², simulated in steps of ≤ 1/240 s) and comes to rest on the highest surface below it: the box floor, another block, or the partition top. If it is released overlapping other blocks, it is first placed on top of them. A block that lands on the **partition top** slides off horizontally (40 cm/s) towards the side its centre is on (to the source side if the centre is exactly over the middle), then falls into that compartment.

**Tracking loss.** If the tested hand is not detected (or no new detection has arrived for 300 ms), tracking is lost. A held block stays held for up to **250 ms**. If tracking has not returned by then, the block is force-released and falls as above. Both the loss episode and the forced release are logged.

**Depth simulation (2D view only; in the 3D view all blocks are shown and none are hidden).** Only three layers of blocks are drawn per compartment:

- *Source side:* while the reserve is not empty, whenever fewer than 30 blocks are visible in the source compartment, one block per frame is moved from the reserve into the lowest free, supported grid position. The participant therefore always sees a full pile until the reserve runs out.
- *Target side:* a block that comes to rest in a fourth layer (bottom ≥ 7.5 cm) is removed from view and added to a hidden counter. It **still counts** in the score.
- A returned block that comes to rest in a fourth layer on the source side goes back into the reserve.
- The total number of blocks is always 150 (visible + reserve + hidden). Under each compartment the screen shows the full count, e.g. "150 of 150 blocks here (30 shown, 120 behind)" at the start of the test.

## 5. Scoring

**Score (primary outcome)** = number of blocks on the target side at the end of the 60 s trial = blocks whose centre is on the target side of the partition midline (resting, falling or sliding), plus, in the 2D view, blocks folded into the hidden target counter.

- A block released over the target side counts immediately, even while it is still falling.
- A block still held at 60 s is **not** counted.
- A block moved from the target side back to the source side is a *return* and lowers the score by one. The score is therefore a **net** count (score = transfers − returns).

## 6. Per-trial metrics

All times are in seconds, distances in virtual cm, speeds in virtual cm/s.

| Variable (CSV column) | Definition |
|---|---|
| `score` | Net blocks on the target side at 60 s (Section 5). |
| `blocksPerMinute` | score × 60 / trial duration. |
| `transfers` | Releases of a block picked up from the source side whose centre is on the target side at release. |
| `graspAttempts` | Number of pinch closures while no block was held. |
| `successfulGrasps` | Grasp attempts that picked up a block. |
| `missedGrasps` | Grasp attempts with no grabbable block within 3.0 cm. |
| `failedReleases` | Blocks picked up from the source side and released on the source side. |
| `returns` | Blocks picked up from the target side and released on the source side. |
| `repositions` | Blocks picked up from the target side and released on the target side. |
| `forcedReleases` | Releases forced by tracking loss (> 250 ms). |
| `timeToFirstTransfer` | Time from trial start to the first transfer release. |
| `cycleTimeMean`, `cycleTimeSD` | Mean and sample SD of the intervals between consecutive transfer releases (needs ≥ 2 and ≥ 3 transfers respectively). |
| `carryPathMean` | Mean path length of the block centre from grasp to release, over transfers. |
| `carryDurationMean` | Mean time from grasp to release, over transfers. |
| `carrySpeedMean` | Mean of (path length ÷ carry duration) over transfers. |
| `peakSpeed` | Highest block-centre speed during any carry. Speed is the displacement over a ~100 ms sliding window, which reduces frame-to-frame noise. The jump that follows a tracking gap is excluded. |
| `clearanceMean` | For each transfer, the smallest gap between the block's bottom and the partition top while the block was horizontally over the partition, averaged over transfers. |
| `trackingLossEpisodes` | Number of times tracking changed from present to lost. |
| `trackingLostTime` | Total time with tracking lost. |
| `inputFps` | New camera detections processed during the trial ÷ trial duration. |
| `lowFpsFlag` | `true` if `inputFps` < 25. Such trials should be repeated or excluded according to a pre-specified rule. |
| `sampleRate`, `sampleCount`, `presentFraction` | Engine updates per second, number of raw samples, and the fraction of samples with the hand tracked. |
| `targetHidden`, `reserveLeft` | Depth-simulation counters at the end of the trial. |

**Recorded with each trial:** participant ID, age, sex, dominant hand, tested hand, notes, device (`camera` or `mouse`), trial type, trial number (per participant × hand × device), consent timestamp, app version, start timestamp, the camera-check results, camera resolution, processing back-end and time per frame, pinch thresholds, reach area, screen size and browser user agent.

**Raw data (JSON export of the last trial):**

- *samples*, one per engine update (one per new camera frame in webcam mode): time, cursor *x* and *y* (cm), pinch state, id of the held block, and hand present;
- *events*: start, grab, grasp_missed, release, forced_release, transfer, return, partition_slide, fold_target, fold_source, tracking_lost, tracking_restored, end. Each has a time stamp and details.

## 7. Software verification

The engine was tested with automated unit tests (Node.js, `node --test`):

- a scripted participant transfers blocks and the score equals the number of transfers;
- a block held below the partition top cannot pass through it, even when the cursor jumps across it in one frame;
- a block released on the partition top slides off to the side of its centre;
- a returned block lowers the score;
- tracking loss holds the block for 250 ms and then force-releases it;
- depth-simulation accounting never exceeds 150 blocks and correctly scores all 150 transfers;
- 3D view: all 150 blocks are present at the start with an identical pile for every participant; grasping takes the top block, front-most on a tie; blocks spread over all 9 depth rows without towers; all 150 can be transferred; no tunnelling through the partition; returns lower the score;
- the hand-tracking maths (pinch ratio, hysteresis, calibration thresholds, hand selection, mirroring) and the One Euro filter behave as specified.

An automated browser test (Playwright, Chromium) runs complete practice and test trials in mouse-simulation mode, in both the 3D and 2D views. It also checks that the webcam pipeline loads the bundled model and makes no external network requests.

## 8. Differences from the physical BBT (to report as limitations)

- **Hand movement in two dimensions.** The 3D view shows a three-dimensional pile, but the hand controls only left–right position and height; the depth row is chosen automatically. The participant does not reach forwards into the pile, and the hand does not have to cross the partition physically.
- **No real grasp.** A pinch gesture replaces gripping a real 2.5 cm cube, so there is no grip force and no touch feedback.
- **Visual feedback and delay.** Feedback is on a screen, with camera and processing delay (roughly one to three camera frames).
- **Movement scale depends on the setup.** How far the hand has to move depends on the reach area (calibration and slider), camera field of view and distance. Keep the reach-area setting constant within a study and report it.
- **Measurement device.** The camera and laptop are part of the measurement system. Record them, and do not pool data across devices without checking agreement.

## Reference

Casiez, G., Roussel, N., & Vogel, D. (2012). 1 € filter: A simple speed-based low-pass filter for noisy input in interactive systems. *Proceedings of the SIGCHI Conference on Human Factors in Computing Systems*, 2527–2530. https://doi.org/10.1145/2207676.2208639
