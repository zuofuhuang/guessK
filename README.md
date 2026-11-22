# Guess the Hidden K — Online Classroom Edition

An online multiplayer classroom version of **Guess the Hidden K** (for Intro Stats), built from the single-screen offline demo (`offline/guessK.html`).

Student groups join a live room from laptops or phones, request independent draws from `1` to a hidden `K`, and lock in **one final guess** per round while the instructor tracks every group's decisions in real time from the **Master Screen**.

## Scoring Rules

$$\text{Score} = \frac{100}{\text{number of numbers requested} + |\text{guessed } K - \text{actual } K|}$$

- Draws are independent uniform integers from `1` to `K` (with replacement, sorted automatically).
- `K` stays strictly on the server until the instructor clicks **Reveal K & Scores**—students cannot inspect `K` in browser DevTools.
- Each group can request as many numbers as they want (at least 1) and lock in one final guess per round.

---

## Features

### Student Group Screen (`/play/:roomCode`)
- Join via **6-character room code**, direct URL, or **scannable QR code**.
- **Multi-device team sync:** Creating a group generates a 4-digit **Team PIN** so teammates on other laptops/phones can join the same live group screen without letting other groups interfere.
- Quick draw buttons (`Request 1`, `Request 3`, `Request 5`, `Request 10`, plus custom count) with animated highlights on newly drawn numbers.
- Confirmation modal before locking in the final guess (including a gentle warning if the guess is smaller than the largest observed draw).
- Automatic post-reveal score breakdown with the visual fraction formula and class leaderboard.

### Instructor Master Screen (`/master/:roomCode`)
- **Masked `Hidden K` input** (dots while typing) and per-round **Sampling Mode** toggle:
  - **Independent Draws:** each group draws its own fresh random sample.
  - **Shared Stream:** all groups draw prefixes from the same server sequence so two groups requesting `n` numbers see the exact same first `n` values.
- **Projector-Safe Mode (ON by default):** hides `K`, every group's sample range, and submitted guesses while you project the Master Screen live—showing only progress (`n` requested and `Submitted ✓`) until you click **Reveal K & Scores**. Toggle OFF anytime to peek privately on your own device.
- **Per-Group Decision Inspector:** click **Inspect** on any group to view their chronological decision timeline (`+3 → +5 → Submit`), Team PIN, full sorted sample, Intro Stats estimators (`max`, `(n+1)/n · max`, `2·mean − 1`), and moderation controls (**Unlock Guess** / **Remove Group**).
- **Post-Reveal Debrief Charts:** interactive SVG plots comparing **Group Guesses vs. Actual K** and **Sample Size (`n`) vs. Score**.
- **Multi-Round Tracking & CSV Exports:** download both the **Round Summary CSV** and the **Chronological Decision Log CSV**.

---

## Hosting So Students Can Easily Join

Because hidden `K` protection and live multi-group syncing require a Node.js backend, you can either host the **backend on Google Cloud Run + frontend on Cloudflare Workers** (both free tier) or run everything on a single Node host:

### Option 1: Google Cloud Run (Backend) + Cloudflare Workers (Frontend) — Recommended Free Tier

This splits static website delivery onto Cloudflare's global edge while Google Cloud Run handles the hidden `K` RNG, Socket.IO rooms, and live tracking (scaling to 0 between classes).

#### Step A — Deploy the Backend on Google Cloud Run
1. Open **Google Cloud Console → Cloud Run → Create Service**.
2. Choose **Continuously deploy from a repository** → connect `zuofuhuang/guessK` (`main` branch, **Dockerfile**).
3. Configure for free-tier classroom WebSockets:
   - **Region:** `us-central1` (Tier 1 free tier)
   - **Authentication:** Allow public access (unauthenticated invocations)
   - **Memory / CPU:** `512 MiB` / `1 vCPU`
   - **Scaling:** Min instances `0`, **Max instances `1`** *(keeps all groups on one live instance)*
   - **Concurrency:** `250`, **Request timeout:** `3600` seconds, **Session affinity:** Enabled
   - **Environment variables:**
     - `CORS_ORIGIN`: your Cloudflare Worker URL (e.g., `https://guessk-web.<your-subdomain>.workers.dev`)
     - `PUBLIC_APP_URL`: your Cloudflare Worker URL (optional—QR codes also auto-detect it from the browser origin)
4. Copy the resulting Cloud Run URL (e.g., `https://guessk-online-xxxx.run.app`).

#### Step B — Deploy the Frontend on Cloudflare Workers
1. In **Cloudflare Dashboard → Workers & Pages → Create → Workers → Connect to Git**, select `zuofuhuang/guessK`.
   *(Cloudflare automatically reads `wrangler.jsonc` and `worker/index.js` to serve `public/` and handle `/play/:roomCode`, `/master/:roomCode`, and `/config.js`.)*
2. Under **Settings → Variables and Secrets**, add a plaintext variable:
   - `BACKEND_URL` = your Cloud Run URL (e.g., `https://guessk-online-xxxx.run.app`)
3. Save and deploy. Open your `https://guessk-web.<your-subdomain>.workers.dev` URL, click **Create New Session**, and click **Show Join QR** for your students.

*(Or deploy the Worker from your terminal with `npx wrangler deploy` after setting `BACKEND_URL` in `wrangler.jsonc`.)*

### Option 2: Single-Service Deploy on Render (Free HTTPS URL)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/zuofuhuang/guessK)

1. Click **Deploy to Render** above (reads `render.yaml` automatically).
2. Open the generated URL, click **Create New Session**, and click **Show Join QR**.

### Option 3: Launch Instantly in GitHub Codespaces (Zero External Accounts)
1. On this GitHub repo page, click **Code → Codespaces → Create codespace on main**.
2. Once the terminal opens, run:
   ```bash
   npm start
   ```
3. In the **Ports** tab, right-click port **3000** → **Port Visibility → Public**, then open the forwarded URL and click **Show Join QR**.

### Option 3: Railway, Fly.io, or Docker
A production `Dockerfile` is included:
```bash
docker build -t guessk-online .
docker run -p 3000:3000 -v guessk-data:/app/data guessk-online
```

### Option 4: Run Locally (Classroom Wi-Fi or Development)
Requires Node.js 20+ (Node 22 recommended for built-in SQLite persistence; earlier Node versions automatically use atomic JSON file storage):
```bash
npm install
npm run build
npm start
```
The server prints both `http://localhost:3000` and your local classroom LAN URL.

---

## Development & Tests

```bash
npm run typecheck   # TypeScript type checking
npm test            # Unit + full Socket.IO multi-group & persistence integration tests
npm run build       # Compile TypeScript to dist/
```

The original single-file offline demo is preserved at [`offline/guessK.html`](offline/guessK.html) and is also accessible at `/offline/guessK.html` when the server is running.
