// Headless-Chrome demo recorder for pi-browser-dashboard.
// One Playwright context per feature -> one .webm -> ffmpeg -> light .gif in doc/demo/gifs/.
//
// Prereqs (not committed as repo deps):
//   bun add -d playwright      # or: npm i -D playwright  (uses your installed Chrome via channel)
//   ffmpeg on PATH
// Run from repo root, with the dev app up (bun run dev -> http://localhost:5173):
//   node doc/demo/scripts/record.mjs            # all features
//   node doc/demo/scripts/record.mjs 11         # only files whose name starts with "11"
//   DEMO_SESSION=<id> DEMO_PROJECT=<slug> node doc/demo/scripts/record.mjs
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const BASE = 'http://localhost:5173';
const ROOT = resolve('.');
const VID = mkdtempSync(join(tmpdir(), 'pid-demo-'));
const GIFS = join(ROOT, 'doc', 'demo', 'gifs');
mkdirSync(GIFS, { recursive: true });

// real session/project discovered from the running app (override via env)
const SESS = process.env.DEMO_SESSION || 'c80aff91';
const PROJ = process.env.DEMO_PROJECT || 'pi-browser-dashboard';
const VW = { width: 1280, height: 800 };
const log = (...a) => console.log('[rec]', ...a);

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
          log('clicked', JSON.stringify(label));
          return true;
        }
      } catch { /* try next strategy */ }
    }
  }
  log('NOTE: could not click any of', JSON.stringify(labels));
  return false;
}

async function hoverFirstCard(page) {
  for (const sel of ['a[href*="/sessions/"]', '[class*="card"]', 'a[href*="/projects/"]']) {
    const loc = page.locator(sel).first();
    try { if (await loc.count()) { await loc.hover({ timeout: 1500 }); return; } } catch {}
  }
}

const features = [
  { file: '01-activity-feed', url: '/', async run(page) {
      await page.waitForTimeout(1500); await clickAny(page, ['Activity'], { exact: true }); await page.waitForTimeout(1500);
      await hoverFirstCard(page); await page.waitForTimeout(900);
      await page.mouse.wheel(0, 350); await page.waitForTimeout(900); await page.mouse.wheel(0, -350); await page.waitForTimeout(800);
  }},
  { file: '02-sidebar', url: '/', async run(page) {
      await page.waitForTimeout(1500); await clickAny(page, ['Show 5 more', 'Show 2 more', 'Show 1 more']);
      await page.waitForTimeout(1200); await page.mouse.wheel(0, 400); await page.waitForTimeout(1000);
  }},
  { file: '03-spawn-modal', url: '/', async run(page) {
      await page.waitForTimeout(1500); await clickAny(page, ['Spawn session', 'Spawn', 'New session', '+']);
      await page.waitForTimeout(2000); await page.keyboard.press('Escape'); await page.waitForTimeout(700);
  }},
  { file: '04-terminal-global', url: '/', async run(page) {
      await page.waitForTimeout(1200); await clickAny(page, ['Terminal'], { exact: true }); await page.waitForTimeout(2500);
  }},
  { file: '05-claude-config', url: '/', async run(page) {
      await page.waitForTimeout(1200); await clickAny(page, ['Claude'], { exact: true }); await page.waitForTimeout(2200);
      await page.mouse.wheel(0, 400); await page.waitForTimeout(900);
  }},
  { file: '06-library', url: '/', async run(page) {
      await page.waitForTimeout(1200); await clickAny(page, ['Library'], { exact: true }); await page.waitForTimeout(2200);
      await page.mouse.wheel(0, 350); await page.waitForTimeout(900);
  }},
  { file: '07-extensions', url: '/', async run(page) {
      await page.waitForTimeout(1200); await clickAny(page, ['Extensions'], { exact: true }); await page.waitForTimeout(2200);
  }},
  { file: '08-tunnel', url: '/', async run(page) {
      await page.waitForTimeout(1200); await clickAny(page, ['Tunnel'], { exact: true }); await page.waitForTimeout(2200);
  }},
  { file: '09-session-controls', url: `/sessions/${SESS}`, async run(page) {
      await page.waitForTimeout(2000); await clickAny(page, ['Peek']); await page.waitForTimeout(2500);
  }},
  { file: '10-chat', url: `/sessions/${SESS}`, async run(page) {
      await page.waitForTimeout(1500); await clickAny(page, ['chat', 'Chat'], { exact: true }); await page.waitForTimeout(1500);
      await page.mouse.wheel(0, 600); await page.waitForTimeout(900); await page.mouse.wheel(0, 600); await page.waitForTimeout(900);
  }},
  { file: '11-canvas', url: `/sessions/${SESS}`, async run(page) {
      await page.waitForTimeout(1500); await clickAny(page, ['canvas', 'Canvas'], { exact: true }); await page.waitForTimeout(2500);
      await page.mouse.wheel(0, 200); await page.waitForTimeout(800);
  }},
  { file: '12-terminal-session', url: `/sessions/${SESS}`, async run(page) {
      await page.waitForTimeout(1500); await clickAny(page, ['terminal', 'Terminal'], { exact: true }); await page.waitForTimeout(2500);
  }},
  { file: '13-files-diff', url: `/sessions/${SESS}`, async run(page) {
      await page.waitForTimeout(1500); await clickAny(page, ['Files', 'files'], { exact: true }); await page.waitForTimeout(2200);
      await page.mouse.wheel(0, 400); await page.waitForTimeout(800);
  }},
  { file: '14-project-sessions', url: `/projects/${PROJ}`, async run(page) {
      await page.waitForTimeout(2000); await hoverFirstCard(page); await page.waitForTimeout(900);
      await page.mouse.wheel(0, 350); await page.waitForTimeout(900);
  }},
  { file: '15-github', url: `/projects/${PROJ}`, async run(page) {
      await page.waitForTimeout(1500); await clickAny(page, ['GitHub'], { exact: true }); await page.waitForTimeout(2500);
      await page.mouse.wheel(0, 400); await page.waitForTimeout(900);
  }},
  { file: '16-terminal-project', url: `/projects/${PROJ}`, async run(page) {
      await page.waitForTimeout(1500); await clickAny(page, ['Terminal'], { exact: true }); await page.waitForTimeout(2500);
  }},
  { file: '17-files-tree', url: `/projects/${PROJ}`, async run(page) {
      await page.waitForTimeout(1500); await clickAny(page, ['Files'], { exact: true }); await page.waitForTimeout(2000);
      await page.mouse.wheel(0, 300); await page.waitForTimeout(900);
  }},
  { file: '18-claude-project', url: `/projects/${PROJ}`, async run(page) {
      await page.waitForTimeout(1500); await clickAny(page, ['Claude'], { exact: true }); await page.waitForTimeout(2200);
      await page.mouse.wheel(0, 350); await page.waitForTimeout(900);
  }},
  { file: '19-library-project', url: `/projects/${PROJ}`, async run(page) {
      await page.waitForTimeout(1500); await clickAny(page, ['Library'], { exact: true }); await page.waitForTimeout(2200);
  }},
];

const only = process.argv[2];

function toGif(webm, gifPath) {
  // -ss 1.0 trims the blank pre-React-mount intro; lighten: 7fps, 760px, 100 colors
  const vf = 'fps=7,scale=760:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=100[p];[s1][p]paletteuse=dither=bayer';
  execFileSync('ffmpeg', ['-y', '-ss', '1.0', '-i', webm, '-vf', vf, '-loop', '0', gifPath], { stdio: 'ignore' });
}

async function launch() {
  try { return await chromium.launch({ channel: 'chrome', headless: true }); }
  catch { return await chromium.launch({ headless: true }); }
}

const browser = await launch();
const results = [];
for (const f of features) {
  if (only && !f.file.startsWith(only)) continue;
  const ctx = await browser.newContext({ viewport: VW, recordVideo: { dir: VID, size: VW } });
  const page = await ctx.newPage();
  let err = null;
  try {
    await page.goto(BASE + f.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await f.run(page);
  } catch (e) { err = e.message; log(f.file, 'ERROR', e.message); }
  const video = page.video();
  await ctx.close(); // flushes video to disk
  let gif = null, bytes = 0;
  try {
    const webm = await video.path();
    const gifPath = join(GIFS, `${f.file}.gif`);
    toGif(webm, gifPath);
    bytes = statSync(gifPath).size;
    gif = `${f.file}.gif`;
  } catch (e) { err = `${err ? `${err} | ` : ''}gif:${e.message}`; }
  log(`done ${f.file} gif=${gif} ${(bytes / 1024).toFixed(0)}KB ${err ? `ERR=${err}` : ''}`);
  results.push({ file: f.file, gif, kb: Math.round(bytes / 1024), err });
}
await browser.close();
rmSync(VID, { recursive: true, force: true });
console.log(`RESULTS_JSON=${JSON.stringify(results)}`);
