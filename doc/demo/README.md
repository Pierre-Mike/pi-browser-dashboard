# pi-browser-dashboard — feature captures

> **🎛️ Live feature tour:** [pierre-mike.github.io/pi-browser-dashboard](https://pierre-mike.github.io/pi-browser-dashboard/)
> — the same captures, grouped by user story in a browsable UI ([`index.html`](./index.html),
> published to GitHub Pages by [`.github/workflows/pages.yml`](../../.github/workflows/pages.yml)).

Every feature is captured twice, from one scripted pass against the live dev app:

| | what | where |
|---|---|---|
| **Still** | a 1920px WebP, captured at **2× device pixels** and downscaled | [`shots/`](./shots/) |
| **Clip** | a 1120px / 12fps GIF of the same feature being used | [`gifs/`](./gifs/) |
| **Themes** | all nine families × light / dark, plus each family's token panel | [`themes/`](./themes/) |

The tour page leads with the still and only fetches a clip when you hover it. That
is not a nicety: 27 GIFs is ~21MB and every one of them animates at once, where the
stills total 3.4MB and are the sharper image anyway.

## Why this looks different from the old recordings

The previous rig recorded Playwright's `recordVideo`, which encodes VP8 at the
**CSS** viewport size — so text was already soft before `ffmpeg` ever saw it, and
the output was 760px at 7fps. This one drives CDP `Page.startScreencast` and
supersamples: capture at 1.5–2× device resolution, downscale with lanczos. The
clips are now 2.2× the pixel area at 1.7× the frame rate for **less** total weight
than before (24MB → 21MB), and the stills are a format the old rig did not produce
at all.

Three things cost real time to work out, all of them load-bearing:

1. **The screencast fires on *paint*.** A panel being held still emits no frames,
   so the gaps have to be reconstructed or a two-second hold plays back as a jump
   cut. The obvious encoding — an `ffmpeg` concat list with per-frame `duration`
   directives — silently collapses a 440-frame, 14-second list into **0.16s** of
   output. `buildSequence()` resamples onto a fixed grid with symlinks instead.
2. **`ev.metadata.timestamp` is optional in the CDP schema** and Chrome omits it
   often enough that half a run comes back `NaN`. Frame *arrival* time is accurate
   to a millisecond or two, which is far inside a 12fps bucket.
3. **`stats_mode=diff` + `diff_mode=rectangle` only pay off when the frame holds
   still**, which a scrolling panel does not — the same clip lands 10× heavier with
   a scroll in it. The encoder steps itself down through width / fps / colours
   until it fits a budget, rather than every entry being hand-tuned.

## How to re-record

```bash
# prereqs — ffmpeg and cwebp on PATH; playwright is already a repo dep
brew install ffmpeg webp

# record against a FRESHLY started server (see the Vite gotcha below)
rm -rf apps/web/.vite apps/web/node_modules/.vite
PID_WEB_PORT=5180 bun run dev:web          # in another shell; daemon must be up too

node .demo-tmp/capture.mjs                 # every feature: stills + clips
node .demo-tmp/capture.mjs 14 18           # only ids starting 14 / 18
node .demo-tmp/capture.mjs --stills        # skip the clips (fast)
node .demo-tmp/capture.mjs --gifs          # skip the stills
node .demo-tmp/capture-themes.mjs          # the 27 theme images + the cycle clip
node .demo-tmp/capture-themes.mjs --gif    # only the cycle clip
```

The three scripts are embedded at the bottom of this file rather than committed as
`.mjs` — throwaway demo tooling, not app code, and a committed source file there
would be scanned by Biome and counted as dead code by `fallow audit`. Save them
under `.demo-tmp/` (git-ignored) and run from the repo root.

Push docs with `SKIP_E2E=1 git push` — the Playwright suite collides with a dev
server already holding the port.

### Choosing capture targets

```bash
curl -s localhost:8787/sessions | head -c 2000     # pick DEMO_SESSION
curl -s localhost:8787/projects | head -c 800      # pick DEMO_PROJECT
```

| env | default | wants |
|---|---|---|
| `DEMO_BASE` | `http://localhost:5180` | the dev web origin |
| `DEMO_SESSION` | `bbb993a5` | a rich transcript and a live pane |
| `DEMO_SESSION_DIFF` | `1e60d5d7` | a **small** worktree — a big one renders "truncated" |
| `DEMO_SESSION_BOARD` | `DEMO_SESSION` | **a worktree you own** — the clip writes a `.canvas` file into it |
| `DEMO_PROJECT` | `pi-browser-dashboard` | a project with PRs |

## Gotchas that produce a plausible-but-wrong capture

The failure mode of a demo recorder is not a crash. It is a believable clip of an
empty panel that nobody notices for three months, so every entry that opens a panel
which starts empty carries a guard that **throws**.

- **Panels start empty and stay that way.** Library, Files and the file preview all
  render a "select something" state until you click. The library's empty copy
  renders once *per hidden category*, so the guard has to count `{ visible: true }`
  only.
- **`+` on the boards rail is not a button that creates a board.** It swaps itself
  for an inline name field, so the click alone leaves the rail waiting and no board
  is ever created.
- **`peek-summary` is on the *card*, not the session page.** The drill-in topbar's
  Peek button only refreshes state; the summary renders in `SessionCardActions`. The
  call takes ~24s against a live daemon, which is why that entry carries `trimHead`.
- **Never type into a terminal pane.** These are not shells: the project pane runs
  the repo's vite dev server, the global "default" pane runs whatever you left going
  (often `bun run dev` itself), and a session pane runs the agent — where a stray
  Enter submits a prompt to a live Claude. Every typed command in the first take
  echoed onto the prompt line and none of them ran. Click **Reconnect** instead: it
  re-attaches the WebSocket and zellij redraws the whole screen. Never click
  **Restart** next to it — that one kills the session.
- **A stale Vite dep-optimize renders diffs and markdown blank, with no error.**
  `@pierre/diffs` and the markdown panels lazy-import chunks (`github-dark`,
  `markdown`); a stale `.vite/deps` answers those with `504 (Outdated Optimize Dep)`
  and the panel renders empty. Record against a freshly started server.
- **The project route's default tab is Terminal**, not the session grid. Without a
  click, that clip is a duplicate of the project-terminal one.
- **A collapsed sidebar reserves zero width**, so the sidebar clip has to *end*
  collapsed to be distinguishable from the Activity-feed clip at all.

Verify any clip by pulling its last frame:

```bash
ffmpeg -y -sseof -0.5 -i doc/demo/gifs/14-brainstorm.gif -update 1 -frames:v 1 /tmp/check.png
```

## Feature inventory

### A. Home dashboard — `/`

| # | Feature | What it shows |
|---|---------|---------------|
| 01 | [Activity feed](./shots/01-activity.webp) | Sessions and projects on one live grid, state badges over SSE. |
| 02 | [Sidebar & full-width toggle](./shots/02-sidebar.webp) | Project buckets, pinning, by-state grouping, "show more", collapse to full width. |
| 03 | [Spawn a session](./shots/03-spawn.webp) | Prompt box, Claude / pi harness tabs, skill chips, tool allow-list, effort, model, ×N. |
| 04 | [Global terminal](./shots/04-terminal-global.webp) | Attached to the zellij `default` session. |
| 05 | [Claude config](./shots/05-claude-config.webp) | hooks / skills / settings.json / CLAUDE.md from `~/.claude`. |
| 06 | [Library](./shots/06-library.webp) | Skills / agents / tools catalog with one-click install. |
| 07 | [Extensions](./shots/07-extensions.webp) | Installed iframe extensions with per-capability toggles. |
| 08 | [Tunnel](./shots/08-tunnel.webp) | Cloudflare tunnel start / stop, URL masked until revealed. |
| 09 | [Orchestration](./shots/09-orchestration.webp) | The voice supervisor session that coordinates across every project. |
| 10 | [Global settings](./shots/10-settings.webp) | The daemon's settings file as a form — git, library, orchestration, network, Appearance. |
| 11 | [Command palette](./shots/11-palette.webp) | Double-tap Shift: projects, sessions, actions, every theme command. |
| 12 | [Peek](./shots/12-peek.webp) | A Haiku call reads the session's live screen and writes a summary onto its card. |

### B. Session detail — `/sessions/$id`

| # | Feature | What it shows |
|---|---------|---------------|
| 13 | [Chat transcript](./shots/13-chat.webp) | The JSONL transcript rendered: tool-use, tool-result, assistant blocks. |
| 14 | [Brainstorm board](./shots/14-brainstorm.webp) | Any `.canvas` in the worktree is a board — rail, toolbar, minimap, zoom. |
| 15 | [Session terminal](./shots/15-terminal-session.webp) | xterm attached to the per-session zellij layout. |
| 16 | [Session files](./shots/16-session-files.webp) | The whole worktree, with markdown / image / PDF / code previews. |

### C. Project detail — `/projects/$id`

| # | Feature | What it shows |
|---|---------|---------------|
| 17 | [Project activity](./shots/17-project-activity.webp) | One project's sessions, with working / blocked / failed counts. |
| 18 | [GitHub / PR diff](./shots/18-github.webp) | PR list with an inline, syntax-highlighted diff. The topbar's Git Pull sits beside the branch. |
| 19 | [Project terminal](./shots/19-terminal-project.webp) | A shell rooted at the project path, sharing whatever runs there. |
| 20 | [Project files](./shots/20-project-files.webp) | Full tree with rendered markdown, images, PDFs, highlighted code. |
| 21 | [Project Claude config](./shots/21-project-claude.webp) | The config panel scoped to one project's `.claude`. |
| 22 | [Project Library](./shots/22-project-library.webp) | The catalog with an all / global / local scope selector. |
| 23 | [Project settings](./shots/23-project-settings.webp) | Per-project `.pid/settings`: default skills, permission mode, spawn defaults. |
| 24 | [Fleets](./shots/24-fleets.webp) | Saved multi-agent recipes — `review-diff`, `fix-then-verify` — with a dry run. |
| 25 | [Specs (pid-apps)](./shots/25-specs.webp) | Any HTML under `.pid/` as a sandboxed tab: opaque origin, no RPC by default. |

### D. Themes

| # | Feature | What it shows |
|---|---------|---------------|
| 26 | [Theme lab](./shots/26-theme-lab.webp) | `/theme-lab`: every family, both variants, every token and component on one page. |
| 27 | [Theme switching](./gifs/27-themes.gif) | One dashboard cycling all nine families, driven from the command palette. |

Plus [`themes/`](./themes/): `<family>-light.webp`, `<family>-dark.webp` and
`<family>-lab.webp` for each of `pid`, `mono`, `terminal`, `sunset`, `candy`,
`arcade`, `citrus`, `prism`, `neon`.

`capture-themes.mjs` reads the lab's filter buttons out of the running app and
**fails if its own family list disagrees**, so a tenth family cannot be silently
skipped from the gallery.

### Not captured

**Git Pull has no clip of its own.** It is a real feature and it is visible in the
project topbar in every project capture, but recording it means running `git pull`
against the operator's working checkout. That is a side effect a demo recorder has
no business taking on its own.

## Gallery

### Home
![Activity feed](./shots/01-activity.webp)
![Sidebar](./shots/02-sidebar.webp)
![Spawn a session](./shots/03-spawn.webp)
![Global terminal](./shots/04-terminal-global.webp)
![Claude config](./shots/05-claude-config.webp)
![Library](./shots/06-library.webp)
![Extensions](./shots/07-extensions.webp)
![Tunnel](./shots/08-tunnel.webp)
![Orchestration](./shots/09-orchestration.webp)
![Global settings](./shots/10-settings.webp)
![Command palette](./shots/11-palette.webp)
![Peek](./shots/12-peek.webp)

### Session
![Chat transcript](./shots/13-chat.webp)
![Brainstorm board](./shots/14-brainstorm.webp)
![Session terminal](./shots/15-terminal-session.webp)
![Session files](./shots/16-session-files.webp)

### Project
![Project activity](./shots/17-project-activity.webp)
![GitHub PR diff](./shots/18-github.webp)
![Project terminal](./shots/19-terminal-project.webp)
![Project files](./shots/20-project-files.webp)
![Project Claude config](./shots/21-project-claude.webp)
![Project Library](./shots/22-project-library.webp)
![Project settings](./shots/23-project-settings.webp)
![Fleets](./shots/24-fleets.webp)
![Specs](./shots/25-specs.webp)

### Themes
![Theme switching](./gifs/27-themes.gif)
![Theme lab](./shots/26-theme-lab.webp)

| | light | dark |
|---|---|---|
| **Pid** — sky / slate | ![](./themes/pid-light.webp) | ![](./themes/pid-dark.webp) |
| **Mono** — grayscale | ![](./themes/mono-light.webp) | ![](./themes/mono-dark.webp) |
| **Terminal** — phosphor green | ![](./themes/terminal-light.webp) | ![](./themes/terminal-dark.webp) |
| **Sunset** — rose / violet | ![](./themes/sunset-light.webp) | ![](./themes/sunset-dark.webp) |
| **Candy** — bubblegum pink / cyan | ![](./themes/candy-light.webp) | ![](./themes/candy-dark.webp) |
| **Arcade** — electric violet / magenta | ![](./themes/arcade-light.webp) | ![](./themes/arcade-dark.webp) |
| **Citrus** — orange / lime | ![](./themes/citrus-light.webp) | ![](./themes/citrus-dark.webp) |
| **Prism** — full spectrum | ![](./themes/prism-light.webp) | ![](./themes/prism-dark.webp) |
| **Neon** — electric highlighter | ![](./themes/neon-light.webp) | ![](./themes/neon-dark.webp) |

## The capture scripts

Save all three under `.demo-tmp/` at the repo root, then run from the repo root.

<details>
<summary><code>.demo-tmp/capture.mjs</code> — the rig</summary>

```js
// High-quality demo capture for pi-browser-dashboard.
//
// Two artifacts per feature, from one scripted browser pass:
//   doc/demo/shots/<id>.webp  — a crisp retina still (2x device pixels, downscaled)
//   doc/demo/gifs/<id>.gif    — the motion clip
//
// Why not Playwright's recordVideo: it encodes VP8 at the CSS viewport size, so
// text is already soft before ffmpeg ever sees it. This drives CDP
// `Page.startScreencast` instead, which hands back one image per painted frame at
// *device* resolution with a real timestamp. Supersampling (capture at 1.5-2x,
// downscale with lanczos) is the single biggest legibility win over the old rig.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, statSync, existsSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SHOTS } from './shots.mjs';

const BASE = process.env.DEMO_BASE || 'http://localhost:5180';
const ROOT = resolve('.');
const OUT_GIFS = join(ROOT, 'doc', 'demo', 'gifs');
const OUT_SHOTS = join(ROOT, 'doc', 'demo', 'shots');
const WORK = join(ROOT, '.demo-tmp', 'frames');
const ONLY = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const STILLS_ONLY = process.argv.includes('--stills');
const GIFS_ONLY = process.argv.includes('--gifs');

// 1440x900 CSS is the smallest viewport this shell lays out at full width (the
// sidebar collapses below `lg`). Captured at 2x, so a still is 2880x1800.
const VIEW = { width: 1440, height: 900 };
const DSF = 2;
// The screencast runs at 1.5x rather than the full 2x: 2x costs ~2.5x the encode
// time per frame for a difference that vanishes at the 1120px gif width.
const CAST = { maxWidth: Math.round(VIEW.width * 1.5), maxHeight: Math.round(VIEW.height * 1.5) };
const GIF_W = 1120;
const GIF_FPS = 12;
const SHOT_W = 1920;
// Long enough to show a feature, short enough that the gif stays a few hundred KB.
const MAX_CLIP_S = 16;
const TAIL_S = 1.4;

mkdirSync(OUT_GIFS, { recursive: true });
mkdirSync(OUT_SHOTS, { recursive: true });

const log = (...a) => console.log('[cap]', ...a);
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { stdio: 'inherit' });

// ---------------------------------------------------------------- gif encoding

/**
 * Frames -> gif. Two ffmpeg-isms carry the quality/size trade here:
 *   palettegen `stats_mode=diff` weights the palette toward *moving* pixels, so a
 *     mostly-static UI clip spends its 256 colours on the part that changes;
 *   paletteuse `diff_mode=rectangle` emits only the changed rectangle per frame,
 *     which is what keeps a 1120px/12fps gif near the size of the old 760px/7fps one.
 *
 * Those two only pay off when most of the frame holds still, and that is exactly
 * what a *scrolling* panel is not: a clip that scrolls a dense markdown or config
 * pane redraws every pixel and lands 10x heavier than a clip of the same length
 * that only opens a tab. Rather than hand-tuning the scroll out of each entry,
 * the encode steps itself down until the clip fits a budget — quality where it is
 * free, size where it is not, and no clip that quietly blows up the page weight.
 */
const GIF_STEPS = [
  { w: GIF_W, fps: GIF_FPS, colors: 256 },
  { w: 960, fps: 10, colors: 192 },
  { w: 860, fps: 8, colors: 144 },
];
const GIF_BUDGET_KB = 1100;

function framesToGif({ pattern, gifPath }) {
  for (const [i, step] of GIF_STEPS.entries()) {
    const filters = [
      `fps=${step.fps}`,
      `scale=${step.w}:-2:flags=lanczos`,
      'split[a][b]',
      `[a]palettegen=stats_mode=diff:max_colors=${step.colors}[p]`,
      '[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle',
    ].join(',');
    ff(['-y', '-framerate', String(GIF_FPS), '-i', pattern, '-vf', filters, '-loop', '0', gifPath]);
    const kb = statSync(gifPath).size / 1024;
    if (kb <= GIF_BUDGET_KB || i === GIF_STEPS.length - 1) return { kb: Math.round(kb), step: i };
  }
  return { kb: Math.round(statSync(gifPath).size / 1024), step: GIF_STEPS.length - 1 };
}

/** PNG -> webp. `-q 84` is where UI screenshots stop shedding visible detail. */
function pngToWebp({ pngPath, webpPath, width = SHOT_W }) {
  execFileSync('cwebp', ['-quiet', '-q', '84', '-resize', String(width), '0', pngPath, '-o', webpPath]);
}

// ------------------------------------------------------------- page utilities

async function clickAny(page, labels, { exact = false } = {}) {
  for (const label of labels) {
    for (const make of [
      () => page.getByRole('tab', { name: label, exact }),
      () => page.getByRole('button', { name: label, exact }),
      () => page.getByRole('link', { name: label, exact }),
      () => page.getByText(label, { exact }),
    ]) {
      try {
        const loc = make().first();
        if ((await loc.count()) && (await loc.isVisible())) {
          await loc.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
          await loc.click({ timeout: 2500 });
          return true;
        }
      } catch { /* next strategy */ }
    }
  }
  log('NOTE: no match for', JSON.stringify(labels));
  return false;
}

async function clickTestId(page, id, { timeout = 3000 } = {}) {
  const loc = page.locator(`[data-testid="${id}"]`).first();
  try { await loc.waitFor({ state: 'visible', timeout }); await loc.click({ timeout }); return true; }
  catch { return false; }
}

/**
 * Force the attached pane to repaint, WITHOUT typing into it.
 *
 * The pane mounts cold — xterm shows a black box until something redraws — and
 * the obvious fix, sending a few Enters and a harmless command, is wrong here.
 * These panes are not shells. The project pane runs the repo's vite dev server,
 * the global "default" pane holds whatever crashed in it last, and a session
 * pane runs the agent itself, where a stray Enter submits a prompt to a live
 * Claude. The first take proved it: every typed command echoed onto the prompt
 * line and none of them ran.
 *
 * Reconnect re-attaches the WebSocket and zellij redraws the whole screen, which
 * is the repaint we actually wanted and touches nothing. Never click Restart
 * next to it — that one kills the session.
 */
async function reattachTerminal(page) {
  const pane = page.locator('.xterm-screen, .xterm, [data-testid="terminal-host"]').first();
  await pane.waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(1200);
  const reconnect = page.getByRole('button', { name: 'Reconnect', exact: true }).first();
  if (await reconnect.count()) {
    await reconnect.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(2600);
  }
  // A pane that painted nothing at all is a black rectangle, and that is the one
  // outcome worth failing on rather than shipping.
  const ink = await page.evaluate(() => {
    const rows = document.querySelector('.xterm-rows');
    return rows ? rows.textContent.replace(/\s|\u00a0/g, '').length : 0;
  });
  if (ink < 40) throw new Error(`terminal guard: pane painted ${ink} glyphs`);
  await page.waitForTimeout(1600);
}

const helpers = { clickAny, clickTestId, reattachTerminal };

// ------------------------------------------------------------------ screencast

/** Collect CDP screencast frames to disk, with their real inter-frame gaps. */
async function startCast({ page, dir }) {
  mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  let n = 0;
  cdp.on('Page.screencastFrame', async (ev) => {
    const i = n++;
    writeFileSync(join(dir, `f${String(i).padStart(5, '0')}.jpg`), Buffer.from(ev.data, 'base64'));
    // Arrival time, not `ev.metadata.timestamp`: that field is optional in the
    // CDP schema and Chrome omits it often enough that half a run comes back
    // NaN. A frame arrives within a millisecond or two of the paint, which is
    // far inside a 12fps bucket.
    frames.push({ i, t: Date.now() / 1000 });
    try { await cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }); } catch { /* closed */ }
  });
  await cdp.send('Page.startScreencast', {
    format: 'jpeg', quality: 92, everyNthFrame: 1, maxWidth: CAST.maxWidth, maxHeight: CAST.maxHeight,
  });
  return {
    async stop() {
      try { await cdp.send('Page.stopScreencast'); } catch { /* closed */ }
      await new Promise((r) => setTimeout(r, 250));
      return frames.sort((a, b) => a.i - b.i);
    },
  };
}

/**
 * Resample paint-time frames onto a fixed 12fps grid, as symlinks in `seq/`.
 *
 * The screencast fires on *paint*, so a held panel emits nothing at all and a
 * scroll emits a burst — the timing has to be reconstructed or a two-second hold
 * plays back as a single frame. The obvious encoding of that is a concat list
 * with per-frame `duration` directives, and it does not work: ffmpeg's concat
 * demuxer collapses a 440-frame, 14-second list into 0.16s of output. Picking
 * the most recent frame for each output tick sidesteps the demuxer entirely and
 * makes the playback rate something this file decides rather than something it
 * asks for.
 */
function buildSequence({ frames, dir, trimHead = 0 }) {
  if (frames.length < 2) return null;
  const seq = join(dir, 'seq');
  mkdirSync(seq, { recursive: true });
  const t0 = frames[0].t + trimHead;
  // + TAIL_S: the last thing a clip does is hold on the finished panel, and a
  // held panel paints nothing, so the run's real ending is past the last frame.
  // Without this every clip cuts the moment the UI stops moving.
  const span = Math.min(Math.max(frames.at(-1).t - t0, 1), MAX_CLIP_S) + TAIL_S;
  const ticks = Math.max(2, Math.round(span * GIF_FPS));
  let cursor = 0;
  for (let k = 0; k < ticks; k++) {
    const at = t0 + k / GIF_FPS;
    while (cursor + 1 < frames.length && frames[cursor + 1].t <= at) cursor++;
    symlinkSync(
      join(dir, `f${String(frames[cursor].i).padStart(5, '0')}.jpg`),
      join(seq, `s${String(k).padStart(5, '0')}.jpg`),
    );
  }
  return { pattern: join(seq, 's%05d.jpg'), ticks };
}

// ------------------------------------------------------------------- main pass

async function launch() {
  try { return await chromium.launch({ channel: 'chrome', headless: true }); }
  catch { return await chromium.launch({ headless: true }); }
}

const browser = await launch();
const results = [];

for (const spec of SHOTS) {
  if (ONLY.length && !ONLY.some((p) => spec.id.startsWith(p))) continue;
  const theme = spec.theme ?? 'pid:dark';
  const ctx = await browser.newContext({
    viewport: VIEW,
    deviceScaleFactor: DSF,
    colorScheme: theme.endsWith(':light') ? 'light' : 'dark',
    reducedMotion: 'no-preference',
  });
  // Pin the theme before first paint: the shell reads localStorage synchronously
  // at import time, so setting it after load would record a visible repaint.
  await ctx.addInitScript(`localStorage.setItem('pid:ui:theme', ${JSON.stringify(theme)})`);
  const page = await ctx.newPage();
  const dir = join(WORK, spec.id);
  rmSync(dir, { recursive: true, force: true });

  let err = null;
  let cast = null;
  try {
    await page.goto(BASE + spec.url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(spec.settle ?? 1400);
    if (!STILLS_ONLY) cast = await startCast({ page, dir });
    await spec.run(page, helpers);
  } catch (e) { err = e.message; log(spec.id, 'ERROR', e.message); }

  // Still first: it is the artifact the site leans on, so it is captured from the
  // settled page before the screencast teardown can disturb anything.
  let shotKb = 0;
  if (!GIFS_ONLY && !err) {
    try {
      await page.waitForTimeout(400);
      const png = join(WORK, `${spec.id}.png`);
      await page.screenshot({ path: png, scale: 'device' });
      const webp = join(OUT_SHOTS, `${spec.id}.webp`);
      pngToWebp({ pngPath: png, webpPath: webp });
      rmSync(png, { force: true });
      shotKb = Math.round(statSync(webp).size / 1024);
    } catch (e) { err = `${err ? `${err} | ` : ''}shot:${e.message}`; }
  }

  let gifKb = 0;
  let gifStep = 0;
  let castFrames = 0;
  if (cast) {
    try {
      const frames = await cast.stop();
      // A clip nobody can read is worse than a missing one: a static panel that
      // painted twice yields a two-frame "animation" that looks like a bug.
      if (frames.length < 12) throw new Error(`only ${frames.length} frames captured`);
      const seq = buildSequence({ frames, dir, trimHead: spec.trimHead ?? 0 });
      const gifPath = join(OUT_GIFS, `${spec.id}.gif`);
      const enc = framesToGif({ pattern: seq.pattern, gifPath });
      gifKb = enc.kb;
      gifStep = enc.step;
      castFrames = seq.ticks;
    } catch (e) { err = `${err ? `${err} | ` : ''}gif:${e.message}`; }
  }

  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
  log(`${spec.id.padEnd(26)} shot=${String(shotKb).padStart(4)}KB gif=${String(gifKb).padStart(5)}KB@q${gifStep} frames=${String(castFrames).padStart(4)} ${err ? `ERR=${err}` : ''}`);
  results.push({ id: spec.id, shotKb, gifKb, gifStep, frames: castFrames, err });
}

await browser.close();
rmSync(WORK, { recursive: true, force: true });

const bad = results.filter((r) => r.err);
console.log(`\n${results.length} captured, ${bad.length} with errors`);
for (const r of bad) console.log(`  FAIL ${r.id}: ${r.err}`);
if (existsSync(OUT_GIFS)) {
  const totalGif = results.reduce((a, r) => a + r.gifKb, 0);
  const totalShot = results.reduce((a, r) => a + r.shotKb, 0);
  console.log(`gifs ${(totalGif / 1024).toFixed(1)}MB   shots ${(totalShot / 1024).toFixed(1)}MB`);
}
```

</details>

<details>
<summary><code>.demo-tmp/shots.mjs</code> — the feature inventory it walks</summary>

```js
// The feature inventory the capture rig walks. One entry = one still + one gif.
//
// Every entry that opens a panel which starts EMPTY carries a guard that throws,
// because the failure mode of a demo recorder is not a crash — it is a plausible
// clip of an empty state that nobody notices for three months.
const SESS = process.env.DEMO_SESSION || 'bbb993a5';
const SESS_DIFF = process.env.DEMO_SESSION_DIFF || '1e60d5d7';
// A board is a real file in the session's worktree, so the board clip writes
// one. Point it at a worktree you own — the default is this repo's own capture
// session, whose board is deleted after the run.
const SESS_BOARD = process.env.DEMO_SESSION_BOARD || SESS;
const PROJ = process.env.DEMO_PROJECT || 'pi-browser-dashboard';

const hold = (page, ms) => page.waitForTimeout(ms);

/** Scroll a bit and come back, so a long panel shows it *is* long. */
async function peruse(page, { down = 340, up = 200 } = {}) {
  await page.mouse.wheel(0, down);
  await hold(page, 900);
  await page.mouse.wheel(0, -up);
  await hold(page, 700);
}

async function openTab(page, h, labels, { exact = true } = {}) {
  if (!(await h.clickAny(page, labels, { exact }))) throw new Error(`tab not found: ${labels[0]}`);
  await hold(page, 1600);
}

/** Throw if a panel is still showing its "nothing selected" copy. */
async function refuseEmpty(page, copy) {
  if (await page.getByText(copy, { exact: false }).filter({ visible: true }).count())
    throw new Error(`guard: panel still empty ("${copy}")`);
}

export const SHOTS = [
  // ------------------------------------------------------------------ A. Home
  {
    id: '01-activity', url: '/', theme: 'pid:dark',
    async run(page, h) {
      await openTab(page, h, ['Activity']);
      const cards = await page.locator('[data-testid="session-card"], a[href*="/sessions/"]').count();
      if (cards < 1) throw new Error(`01 guard: no session cards (${cards})`);
      await page.locator('a[href*="/sessions/"], [data-testid="session-card"]').first().hover().catch(() => {});
      await hold(page, 900);
      await peruse(page, { down: 420, up: 420 });
    },
  },
  {
    // Ends COLLAPSED on purpose. Expanded, this frame is the Activity feed's frame
    // with the same sidebar in it — the first cut of this clip was indistinguishable
    // from 01. The rail is the half of the feature the dashboard shot cannot show.
    id: '02-sidebar', url: '/', theme: 'pid:dark',
    async run(page, h) {
      await hold(page, 900);
      await h.clickAny(page, ['Show 5 more', 'Show 2 more', 'Show 1 more']);
      await hold(page, 1400);
      await page.locator('[data-testid="sidebar-pin-toggle"]').first().hover().catch(() => {});
      await hold(page, 900);
      await page.mouse.wheel(0, 300);
      await hold(page, 900);
      await page.mouse.wheel(0, -300);
      await hold(page, 800);
      if (!(await h.clickTestId(page, 'sidebar-rail-toggle')))
        throw new Error('02 guard: rail toggle never appeared');
      await hold(page, 2000);
      const w = await page.locator('[data-testid="sidebar"]').first().boundingBox().catch(() => null);
      if (w && w.width > 120) throw new Error(`02 guard: rail did not collapse (${w.width}px)`);
    },
  },
  {
    id: '03-spawn', url: '/', theme: 'pid:dark',
    async run(page, h) {
      await hold(page, 900);
      if (!(await h.clickTestId(page, 'sidebar-new-session')))
        await h.clickAny(page, ['New session', 'Spawn session', 'Spawn', '+']);
      await hold(page, 1000);
      await page.keyboard.type('Refactor the auth guard and add a regression test', { delay: 28 });
      await hold(page, 1400);
      await peruse(page, { down: 260, up: 260 });
    },
  },
  {
    id: '04-terminal-global', url: '/', theme: 'pid:dark',
    async run(page, h) {
      await openTab(page, h, ['Terminal']);
      await h.reattachTerminal(page);
    },
  },
  {
    id: '05-claude-config', url: '/', theme: 'pid:dark',
    async run(page, h) {
      await openTab(page, h, ['Claude']);
      await hold(page, 1200);
      await peruse(page, { down: 420, up: 300 });
    },
  },
  {
    id: '06-library', url: '/', theme: 'pid:dark',
    async run(page, h) {
      await openTab(page, h, ['Library']);
      const entry = page.locator('[data-testid^="library-entry-"]').first();
      await entry.waitFor({ state: 'visible', timeout: 8000 });
      await entry.click({ timeout: 3000 });
      await hold(page, 1600);
      // Each hidden category renders its own copy of this string, so only the
      // VISIBLE ones count.
      await refuseEmpty(page, 'Select an entry to view details.');
      await peruse(page, { down: 260, up: 200 });
    },
  },
  {
    id: '07-extensions', url: '/', theme: 'pid:dark',
    async run(page, h) { await openTab(page, h, ['Extensions']); await hold(page, 1800); },
  },
  {
    id: '08-tunnel', url: '/', theme: 'pid:dark',
    async run(page, h) { await openTab(page, h, ['Tunnel']); await hold(page, 1800); },
  },
  {
    id: '09-orchestration', url: '/', theme: 'pid:dark',
    async run(page, h) { await openTab(page, h, ['Orchestration']); await hold(page, 1800); await peruse(page); },
  },
  {
    // The global settings file, and the Appearance section that picks the theme.
    id: '10-settings', url: '/', theme: 'pid:dark',
    async run(page, h) {
      await openTab(page, h, ['Settings']);
      const appearance = page.locator('[data-testid="gs-section-appearance"]');
      await appearance.waitFor({ state: 'visible', timeout: 8000 });
      await appearance.scrollIntoViewIfNeeded();
      await hold(page, 1200);
      await peruse(page, { down: 320, up: 320 });
    },
  },
  {
    // The command palette opens on a double-tap of Shift — no chord, no button.
    id: '11-palette', url: '/', theme: 'pid:dark',
    async run(page) {
      await hold(page, 1000);
      await page.keyboard.press('Shift');
      await page.keyboard.press('Shift');
      const modal = page.locator('[data-testid="palette-modal"]');
      await modal.waitFor({ state: 'visible', timeout: 6000 });
      await hold(page, 1200);
      await page.keyboard.type('theme', { delay: 130 });
      await hold(page, 1500);
      if ((await page.locator('[data-testid="palette-row"]').count()) < 1)
        throw new Error('11 guard: palette matched nothing');
      await page.keyboard.press('ArrowDown');
      await hold(page, 500);
      await page.keyboard.press('ArrowDown');
      await hold(page, 1300);
    },
  },

  // --------------------------------------------------------------- B. Session
  {
    // Peek — a Haiku call that reads the session's live screen and writes a
    // summary onto the card. The summary renders on the *card*, not on the
    // session page: `peek-summary` lives in SessionCardActions, and the drill-in
    // topbar's Peek button only refreshes state. So this is an Activity-feed clip.
    //
    // The call takes ~24s against this daemon, which would otherwise be a gif of
    // a spinner — `trimHead` drops that from the front and lands the clip on the
    // returned summary.
    id: '12-peek', url: '/', theme: 'pid:dark', settle: 2000, trimHead: 17,
    async run(page, h) {
      await openTab(page, h, ['Activity']);
      const peek = page.locator('[data-testid="peek"]').first();
      await peek.waitFor({ state: 'visible', timeout: 8000 });
      await peek.click({ timeout: 3000 });
      await page.locator('[data-testid="peek-summary"]')
        .first()
        .waitFor({ state: 'visible', timeout: 60000 })
        .catch(() => { throw new Error('12 guard: peek never returned a summary'); });
      await hold(page, 3500);
    },
  },
  {
    id: '13-chat', url: `/sessions/${SESS}?tab=chat`, theme: 'pid:dark', settle: 2600,
    async run(page) {
      await hold(page, 1200);
      await page.mouse.wheel(0, 700); await hold(page, 900);
      await page.mouse.wheel(0, 700); await hold(page, 900);
      await page.mouse.wheel(0, -500); await hold(page, 900);
    },
  },
  {
    id: '14-brainstorm', url: `/sessions/${SESS_BOARD}?tab=brainstorm`, theme: 'pid:dark', settle: 1800,
    async run(page, h) {
      const board = page.locator('[data-testid^="brainstorm-subtab-"]').first();
      if ((await board.count()) === 0) {
        // `+` swaps itself for an inline name field rather than opening a modal,
        // so the click alone leaves the rail waiting for a name and no board is
        // ever created — which is exactly how this recorded an empty pane.
        await h.clickTestId(page, 'brainstorm-new');
        const name = page.locator('[data-testid="brainstorm-new-input"]');
        await name.waitFor({ state: 'visible', timeout: 6000 });
        await name.fill('demo-board');
        await hold(page, 500);
        await page.keyboard.press('Enter');
      } else await board.click({ timeout: 3000 });
      await page.locator('[data-testid="canvas-tab"]').waitFor({ state: 'visible', timeout: 18000 });
      await h.clickTestId(page, 'canvas-reset'); await hold(page, 700);
      for (let i = 0; i < 3; i++) { await h.clickTestId(page, 'canvas-add-box'); await hold(page, 520); }
      await h.clickTestId(page, 'canvas-add-file'); await hold(page, 520);
      await h.clickTestId(page, 'canvas-add-link'); await hold(page, 620);
      await h.clickTestId(page, 'canvas-fit'); await hold(page, 1800);
      const n = await page.locator('.react-flow__node').count();
      if (n < 5) throw new Error(`14 guard: expected >=5 nodes, saw ${n}`);
    },
  },
  {
    id: '15-terminal-session', url: `/sessions/${SESS}`, theme: 'pid:dark', settle: 2000,
    async run(page, h) {
      await h.clickAny(page, ['Terminal'], { exact: true });
      await hold(page, 1500);
      await h.reattachTerminal(page);
    },
  },
  {
    id: '16-session-files', url: `/sessions/${SESS_DIFF}`, theme: 'pid:dark', settle: 2800,
    async run(page, h) {
      const tab = page.locator('[data-testid="tab-files"]');
      try { await tab.waitFor({ state: 'visible', timeout: 7000 }); await tab.click({ timeout: 3000 }); }
      catch { await h.clickAny(page, ['Files']); }
      await hold(page, 2400);
      // The session Files tab reuses the project FileTree, empty state and all —
      // without this click the clip is the words "Pick a file to preview".
      const tree = page.locator('[data-testid="project-file-tree"]');
      await tree.waitFor({ state: 'visible', timeout: 8000 });
      const row = tree.getByText('README', { exact: false }).first();
      await row.waitFor({ state: 'visible', timeout: 8000 });
      await row.click({ timeout: 3000 });
      await page.locator('[data-testid="file-preview"]').waitFor({ state: 'visible', timeout: 10000 });
      await hold(page, 2400);
      await peruse(page, { down: 300, up: 300 });
    },
  },

  // --------------------------------------------------------------- C. Project
  {
    id: '17-project-activity', url: `/projects/${PROJ}`, theme: 'pid:dark', settle: 2000,
    async run(page, h) {
      await openTab(page, h, ['Activity'], { exact: false });
      const cards = await page.locator('[data-testid="session-card"]').count();
      if (cards < 1) throw new Error(`17 guard: expected >=1 session card, saw ${cards}`);
      await peruse(page, { down: 340, up: 180 });
    },
  },
  {
    id: '18-github', url: `/projects/${PROJ}`, theme: 'pid:dark', settle: 1800,
    async run(page, h) {
      await openTab(page, h, ['GitHub']);
      await hold(page, 1200);
      const pr = page.locator('[data-testid="gh-pr-toggle"]').first();
      try { await pr.waitFor({ state: 'visible', timeout: 7000 }); await pr.click({ timeout: 3000 }); }
      catch { /* the list alone is still the feature */ }
      await hold(page, 3500);
      await peruse(page, { down: 460, up: 200 });
    },
  },
  {
    id: '19-terminal-project', url: `/projects/${PROJ}`, theme: 'pid:dark', settle: 1800,
    async run(page, h) {
      await openTab(page, h, ['Terminal']);
      await h.reattachTerminal(page);
    },
  },
  {
    id: '20-project-files', url: `/projects/${PROJ}`, theme: 'pid:dark', settle: 1800,
    async run(page, h) {
      await openTab(page, h, ['Files']);
      // The tree splits name and extension into separate spans, so match partially.
      const row = page.locator('[data-testid="project-file-tree"]').getByText('README', { exact: false }).first();
      await row.waitFor({ state: 'visible', timeout: 8000 });
      await row.click({ timeout: 3000 });
      await page.locator('[data-testid="file-preview"]').waitFor({ state: 'visible', timeout: 10000 });
      await hold(page, 2600);
    },
  },
  {
    id: '21-project-claude', url: `/projects/${PROJ}`, theme: 'pid:dark', settle: 1800,
    async run(page, h) { await openTab(page, h, ['Claude']); await hold(page, 1400); await peruse(page, { down: 380, up: 260 }); },
  },
  {
    id: '22-project-library', url: `/projects/${PROJ}`, theme: 'pid:dark', settle: 1800,
    async run(page, h) {
      await openTab(page, h, ['Library']);
      const entry = page.locator('[data-testid^="library-entry-"]').first();
      await entry.waitFor({ state: 'visible', timeout: 8000 });
      await entry.click({ timeout: 3000 });
      await hold(page, 1600);
      await refuseEmpty(page, 'Select an entry to view details.');
      await peruse(page, { down: 220, up: 180 });
    },
  },
  {
    id: '23-project-settings', url: `/projects/${PROJ}`, theme: 'pid:dark', settle: 1800,
    async run(page, h) { await openTab(page, h, ['Settings']); await hold(page, 1600); await peruse(page, { down: 300, up: 300 }); },
  },
  {
    id: '24-fleets', url: `/projects/${PROJ}`, theme: 'pid:dark', settle: 1800,
    async run(page, h) { await openTab(page, h, ['Fleets']); await hold(page, 2000); await peruse(page, { down: 300, up: 300 }); },
  },
  {
    id: '25-specs', url: `/projects/${PROJ}`, theme: 'pid:dark', settle: 1800,
    async run(page, h) { await openTab(page, h, ['Specs']); await hold(page, 2200); await peruse(page, { down: 320, up: 320 }); },
  },

  // ---------------------------------------------------------------- D. Themes
  {
    // Every family and both variants on one page — the review surface itself.
    id: '26-theme-lab', url: '/theme-lab', theme: 'pid:light', settle: 2000,
    async run(page) {
      await page.locator('[data-testid="theme-lab-filter-all"]').waitFor({ state: 'visible', timeout: 8000 });
      await hold(page, 1200);
      for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 620); await hold(page, 850); }
      await page.mouse.wheel(0, -2480);
      await hold(page, 1200);
    },
  },
];

// The theme catalog, mirrored here rather than imported: this file is plain node
// ESM and `theme.core.ts` is TypeScript inside the web workspace. `capture-themes`
// asserts the two agree against the running app before it captures anything, so
// the copy cannot drift silently.
export const FAMILIES = [
  { id: 'pid', label: 'Pid — sky / slate' },
  { id: 'mono', label: 'Mono — grayscale' },
  { id: 'terminal', label: 'Terminal — phosphor green' },
  { id: 'sunset', label: 'Sunset — rose / violet' },
  { id: 'candy', label: 'Candy — bubblegum pink / cyan' },
  { id: 'arcade', label: 'Arcade — electric violet / magenta' },
  { id: 'citrus', label: 'Citrus — orange / lime' },
  { id: 'prism', label: 'Prism — full spectrum' },
  { id: 'neon', label: 'Neon — electric highlighter' },
];
```

</details>

<details>
<summary><code>.demo-tmp/capture-themes.mjs</code> — the theme gallery</summary>

```js
// The theme gallery: every family, both variants, on two surfaces.
//
//   doc/demo/themes/<family>-light.webp / -dark.webp   the real dashboard
//   doc/demo/themes/<family>-lab.webp                  the token + component panel pair
//   doc/demo/gifs/27-themes.gif                        one dashboard, cycling all nine
//
// A colour family is not reviewable from a swatch strip. Five of the seven ink
// tokens only paint when a session has something to report, so the surface that
// tells the truth about a family is a *populated dashboard* — which is why the
// app shot leads and the lab panel backs it up.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FAMILIES } from './shots.mjs';

const BASE = process.env.DEMO_BASE || 'http://localhost:5180';
const ROOT = resolve('.');
const OUT_THEMES = join(ROOT, 'doc', 'demo', 'themes');
const OUT_GIFS = join(ROOT, 'doc', 'demo', 'gifs');
const WORK = join(ROOT, '.demo-tmp', 'theme-frames');
const ONLY_GIF = process.argv.includes('--gif');
const ONLY_SHOTS = process.argv.includes('--shots');

const VIEW = { width: 1440, height: 900 };
const DSF = 2;
// Gallery tiles, not hero images: 1280 keeps 27 of them under ~2.5MB total.
const TILE_W = 1280;
// Narrower and slower than the feature clips, and deliberately so: every pixel
// changes hue on every step, which defeats `diff_mode=rectangle` entirely, so this
// one clip pays full price per frame. At the feature settings it weighed 4MB.
const GIF_W = 980;
const GIF_FPS = 10;

mkdirSync(OUT_THEMES, { recursive: true });
mkdirSync(OUT_GIFS, { recursive: true });
const log = (...a) => console.log('[themes]', ...a);

const toWebp = ({ png, webp, width }) =>
  execFileSync('cwebp', ['-quiet', '-q', '84', '-resize', String(width), '0', png, '-o', webp]);

async function launch() {
  try { return await chromium.launch({ channel: 'chrome', headless: true }); }
  catch { return await chromium.launch({ headless: true }); }
}

const browser = await launch();
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

// ----------------------------------------------------------------- catalogue check
// FAMILIES is a hand-kept copy of `theme.core.ts` (this file is plain node ESM and
// the catalog is TypeScript inside the web workspace). The lab renders one filter
// button per family, so the running app can be asked whether the copy is current —
// a drifted list would silently skip a whole family from the gallery.
{
  const ctx = await browser.newContext({ viewport: VIEW });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/theme-lab`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="theme-lab-filter-all"]').waitFor({ state: 'visible', timeout: 15000 });
  const live = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="theme-lab-filter-"]')]
      .map((b) => b.getAttribute('data-testid').replace('theme-lab-filter-', ''))
      .filter((id) => id !== 'all'));
  const mine = FAMILIES.map((f) => f.id);
  if (live.join(',') !== mine.join(','))
    throw new Error(`theme catalog drift: app has [${live}], shots.mjs has [${mine}]`);
  log(`catalog agrees: ${live.length} families`);
  await ctx.close();
}

const rows = [];

// --------------------------------------------------------------------- app shots
if (!ONLY_GIF) {
  for (const family of FAMILIES) {
    for (const mode of ['light', 'dark']) {
      const ctx = await browser.newContext({
        viewport: VIEW, deviceScaleFactor: DSF, colorScheme: mode,
      });
      await ctx.addInitScript(`localStorage.setItem('pid:ui:theme','${family.id}:${mode}')`);
      const page = await ctx.newPage();
      await page.goto(`${BASE}/?tab=projects`, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForTimeout(2600);
      const applied = await page.evaluate(() => document.documentElement.dataset.theme);
      const want = mode === 'light' ? `${family.id}light` : `${family.id}dark`;
      if (applied !== want) throw new Error(`${family.id}/${mode}: html data-theme is "${applied}", wanted "${want}"`);
      const png = join(WORK, `${family.id}-${mode}.png`);
      await page.screenshot({ path: png, scale: 'device' });
      const webp = join(OUT_THEMES, `${family.id}-${mode}.webp`);
      toWebp({ png, webp, width: TILE_W });
      rows.push({ file: `${family.id}-${mode}.webp`, kb: Math.round(statSync(webp).size / 1024) });
      await ctx.close();
    }
    log(`app  ${family.id} light+dark`);
  }

  // ------------------------------------------------------------------- lab panels
  // One shot per family: the lab already renders light and dark side by side, and
  // the state chips in their idle and reporting columns — the pair that matters.
  for (const family of FAMILIES) {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: DSF });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/theme-lab`, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.locator(`[data-testid="theme-lab-filter-${family.id}"]`).click({ timeout: 8000 });
    await page.waitForTimeout(1400);
    const section = page.locator('section').first();
    const png = join(WORK, `${family.id}-lab.png`);
    await section.screenshot({ path: png, scale: 'device' });
    const webp = join(OUT_THEMES, `${family.id}-lab.webp`);
    toWebp({ png, webp, width: TILE_W });
    rows.push({ file: `${family.id}-lab.webp`, kb: Math.round(statSync(webp).size / 1024) });
    await ctx.close();
    log(`lab  ${family.id}`);
  }
}

// ---------------------------------------------------------------------- cycle gif
// Driven through the command palette's "Theme: next family" rather than the
// Settings picker, because the picker lives on the Settings tab and this clip has
// to repaint the *dashboard* — the surface where the status hues actually paint.
if (!ONLY_SHOTS) {
  const dir = join(WORK, 'cycle');
  mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: DSF, colorScheme: 'light' });
  await ctx.addInitScript(`localStorage.setItem('pid:ui:theme','pid:light')`);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?tab=projects`, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await page.waitForTimeout(2600);

  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  let n = 0;
  cdp.on('Page.screencastFrame', async (ev) => {
    const i = n++;
    writeFileSync(join(dir, `f${String(i).padStart(5, '0')}.jpg`), Buffer.from(ev.data, 'base64'));
    frames.push({ i, t: Date.now() / 1000 });
    try { await cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }); } catch { /* closed */ }
  });
  await cdp.send('Page.startScreencast', {
    format: 'jpeg', quality: 92, everyNthFrame: 1,
    maxWidth: Math.round(VIEW.width * 1.5), maxHeight: Math.round(VIEW.height * 1.5),
  });

  const seen = [];
  for (let i = 0; i < FAMILIES.length; i++) {
    await page.keyboard.press('Shift');
    await page.keyboard.press('Shift');
    await page.locator('[data-testid="palette-modal"]').waitFor({ state: 'visible', timeout: 6000 });
    await page.keyboard.type('next', { delay: 20 });
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1100);
    seen.push(await page.evaluate(() => document.documentElement.dataset.theme));
  }
  await page.waitForTimeout(1200);
  try { await cdp.send('Page.stopScreencast'); } catch { /* closed */ }
  await new Promise((r) => setTimeout(r, 300));

  const distinct = new Set(seen);
  if (distinct.size < FAMILIES.length)
    throw new Error(`cycle guard: only ${distinct.size} distinct themes across ${FAMILIES.length} steps (${seen})`);
  log(`cycled ${[...distinct].join(' -> ')}`);

  // Same fixed-grid resample as capture.mjs: a paint-driven screencast has no
  // frames at all while a theme is being read, so the holds have to be rebuilt.
  const seq = join(dir, 'seq');
  mkdirSync(seq, { recursive: true });
  const t0 = frames[0].t;
  const ticks = Math.round((frames.at(-1).t - t0 + 1.2) * GIF_FPS);
  let cursor = 0;
  for (let k = 0; k < ticks; k++) {
    const at = t0 + k / GIF_FPS;
    while (cursor + 1 < frames.length && frames[cursor + 1].t <= at) cursor++;
    execFileSync('ln', ['-s', join(dir, `f${String(frames[cursor].i).padStart(5, '0')}.jpg`),
      join(seq, `s${String(k).padStart(5, '0')}.jpg`)]);
  }
  const gifPath = join(OUT_GIFS, '27-themes.gif');
  execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-framerate', String(GIF_FPS),
    '-i', join(seq, 's%05d.jpg'),
    // stats_mode=full, not diff: the whole frame changes colour on every step, so
    // a palette weighted toward "what moved" would be weighted toward everything
    // and still have to serve nine palettes at once.
    '-vf', `scale=${GIF_W}:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=full:max_colors=192[p];[b][p]paletteuse=dither=sierra2_4a`,
    '-loop', '0', gifPath]);
  rows.push({ file: '27-themes.gif', kb: Math.round(statSync(gifPath).size / 1024) });
  await ctx.close();
}

await browser.close();
rmSync(WORK, { recursive: true, force: true });
for (const r of rows) log(`${r.file.padEnd(24)} ${String(r.kb).padStart(5)}KB`);
log(`total ${(rows.reduce((a, r) => a + r.kb, 0) / 1024).toFixed(1)}MB`);
```

</details>
