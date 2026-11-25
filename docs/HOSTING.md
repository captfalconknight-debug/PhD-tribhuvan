# Putting the VBBT online (GitHub Pages), step by step

> **This project:** repository `captfalconknight-debug/PhD-tribhuvan` (code already uploaded).
> Web address once Pages is switched on: **https://captfalconknight-debug.github.io/PhD-tribhuvan/**
> Remaining steps: make the repository **public** (Step 2, item 3: Settings → General → Danger Zone →
> Change visibility) and switch on Pages (Step 4).

GitHub Pages hosts the app for free over **https**, which the camera needs. Every laptop can then open it from one web address, and it keeps working offline after the first visit.

**Cost:** free. **Time:** about 20 minutes the first time.

> **Keep in mind:** a free GitHub Pages site comes from a **public** repository, so anyone can see the app's *code*. That is fine (and good for open science). **Participant data is never in the repository.** It stays in each laptop's browser until you download it.

---

## Part A: one-time set-up (you do this)

### Step 1. Create a GitHub account
1. Go to https://github.com/signup.
2. Choose a username. It becomes part of the web address: `https://USERNAME.github.io/vbbt/`.
3. Verify your email address.

### Step 2. Create an empty repository
1. Sign in, click **+** (top right), then **New repository**.
2. **Repository name:** `vbbt`
3. **Visibility:** **Public**.
4. Do **not** tick "Add a README", ".gitignore" or "license". The repository must be empty.
5. Click **Create repository**.

### Step 3. Let Claude push the code to it
1. Go to https://claude.ai/connect-github and connect your GitHub account.
2. When asked, install the **Claude GitHub App** and give it access to the `vbbt` repository.
3. Tell Claude in this chat: *"The repository is USERNAME/vbbt — please push."* Claude attaches it and uploads all the code.

*(Alternative without Claude: download the project as a ZIP from Claude, then on the repository page choose "uploading an existing file" and drag in all the files and folders. GitHub's web upload accepts files up to 25 MB each, and the two `.wasm` files are 10–11 MB, so this works.)*

### Step 4. Switch on GitHub Pages
1. In the repository, open **Settings → Pages** (left menu).
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. **Branch:** `main`, folder **/ (root)**, then **Save**.
4. Wait 1–3 minutes and refresh. The page shows **"Your site is live at https://USERNAME.github.io/vbbt/"**.

### Step 5. Test it
1. Open the address in **Chrome** or **Edge** on a laptop.
2. Choose *Camera* and press **Connect**. Allow the camera.
3. Work through the **hardware test checklist** in `README.md` on each laptop model.

---

## Part B: using it on other laptops

1. Open `https://USERNAME.github.io/vbbt/` in Chrome or Edge (bookmark it).
2. The first load downloads about 30 MB. After that it works offline on that laptop.
3. **Each laptop keeps its own saved sessions.** Download the CSV from each laptop at the end of each testing day and combine them in Excel/SPSS/R. Each row has a unique `sessionId`, so duplicates are easy to remove.

## Part C: updating the app later (e.g. the consent text)

- **Through Claude:** ask Claude to change something and push. GitHub Pages updates within a few minutes.
- **By hand:** in the repository, open `config.js`, click the pencil icon, edit `CONSENT_TEXT`, then **Commit changes**.
- After an update, laptops get the new version the **next time the page is opened while online**. Reload once to be sure. The version number is shown at the top of the page and saved with each trial (`appVersion`).

> For a study, **freeze the version** once data collection starts: don't change the rules or settings mid-study, and report the `appVersion` you used.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| 404 page | Wait a few minutes after enabling Pages; check that the branch is `main` and the folder is `/ (root)`. |
| "Camera permission was refused" | Click the camera icon in the address bar, choose **Allow**, press Connect again. |
| "The camera is being used by another program" | Close Zoom, Teams or the Camera app. |
| Very slow or low FPS | Plug in the charger; close other programs; use Chrome or Edge. |
| Old version still showing | Reload the page while online (Ctrl+Shift+R). |

## Optional: a central database

At the moment each laptop stores its own data and you collect CSV files. If you later want results sent automatically to one place (e.g. a Supabase database storing anonymised summaries only, never video), that can be added behind an on/off setting. It would need ethics approval for data transfer and is **not included** now.
