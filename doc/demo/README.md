# pi-browser-dashboard — Feature Demo Recordings

Animated-GIF walkthroughs of every feature, recorded against the local dev app
(`bun run dev` → http://localhost:5173) by driving **headless Google Chrome** with
Playwright. One feature per recording, one browser context (tab) per recording —
kept lightweight (single panel in view, 760px / 7fps / ≤100-colour gifs).

GIFs live in [`gifs/`](./gifs/). The recorder lives in [`scripts/`](./scripts/).

## How these were made / how to re-record

```bash
# prereqs (NOT committed as repo deps — install ad hoc):
bun add -d playwright          # launches your installed Chrome via channel:'chrome'
# ffmpeg must be on PATH

bun run dev                    # start the app on :5173 (in another shell)
node doc/demo/scripts/record.mjs        # record all 19 features
node doc/demo/scripts/record.mjs 11     # re-record only feature 11 (canvas)
DEMO_SESSION=<id> DEMO_PROJECT=<slug> node doc/demo/scripts/record.mjs
```

Each clip: navigate → 3–6 deliberate actions with ~1s waits → context close flushes a
`.webm` → `ffmpeg` trims the blank pre-mount intro (`-ss 1.0`) and encodes a light gif.
`scripts/discover.mjs` dumps the live session/project IDs used as demo targets.

> The Claude-in-Chrome **extension was not connected** in this environment, so recording
> was done via headless Chrome + Playwright instead — fully automated, no extension needed.

## Feature inventory, recording scripts & gifs

### A. Home dashboard — `/`

| # | Feature | gif | What it shows |
|---|---------|-----|---------------|
| 1 | Activity feed | [`01-activity-feed.gif`](./gifs/01-activity-feed.gif) | Sessions/projects grid, live state badges, card hover. |
| 2 | Sidebar nav | [`02-sidebar.gif`](./gifs/02-sidebar.gif) | Project buckets, pinned + by-state grouping, "show more". |
| 3 | Spawn modal | [`03-spawn-modal.gif`](./gifs/03-spawn-modal.gif) | Dispatch bar: prompt box, skill chips, permission mode, N-sessions. |
| 4 | Global terminal | [`04-terminal-global.gif`](./gifs/04-terminal-global.gif) | Attached zellij "default" shell. |
| 5 | Claude config | [`05-claude-config.gif`](./gifs/05-claude-config.gif) | hooks/skills/settings.json/CLAUDE.md from ~/.claude. |
| 6 | Library | [`06-library.gif`](./gifs/06-library.gif) | Skills/agents/tools catalog + install entries. |
| 7 | Extensions | [`07-extensions.gif`](./gifs/07-extensions.gif) | Installed extensions + capability toggles. |
| 8 | Tunnel | [`08-tunnel.gif`](./gifs/08-tunnel.gif) | Cloudflare tunnel start/stop + URL controls. |

### B. Session detail — `/sessions/$id`

| # | Feature | gif | What it shows |
|---|---------|-----|---------------|
| 9 | Session controls + Peek | [`09-session-controls.gif`](./gifs/09-session-controls.gif) | Header (name/state/short id/cwd), Open-in-CLI/Peek/Delete; Peek summary. |
| 10 | Chat transcript | [`10-chat.gif`](./gifs/10-chat.gif) | JSONL transcript: tool-use / tool-result / assistant blocks. |
| 11 | Canvas | [`11-canvas.gif`](./gifs/11-canvas.gif) | JSON-Canvas editor: toolbar (Box/Link/File/Group/Export), grid, minimap, zoom. |
| 12 | Session terminal | [`12-terminal-session.gif`](./gifs/12-terminal-session.gif) | xterm attached to per-session zellij. |
| 13 | Files diff | [`13-files-diff.gif`](./gifs/13-files-diff.gif) | Worktree diff viewer. |

### C. Project detail — `/projects/$id`

| # | Feature | gif | What it shows |
|---|---------|-----|---------------|
| 14 | Project sessions | [`14-project-sessions.gif`](./gifs/14-project-sessions.gif) | Session-card grid + state pills + spawn button. |
| 15 | GitHub / PR diff | [`15-github.gif`](./gifs/15-github.gif) | PR list + inline PR-diff viewer. |
| 16 | Project terminal | [`16-terminal-project.gif`](./gifs/16-terminal-project.gif) | Shell rooted at project path. |
| 17 | Project files tree | [`17-files-tree.gif`](./gifs/17-files-tree.gif) | File tree + file preview. |
| 18 | Project Claude config | [`18-claude-project.gif`](./gifs/18-claude-project.gif) | Project `.claude` hooks/skills/settings. |
| 19 | Project Library | [`19-library-project.gif`](./gifs/19-library-project.gif) | Catalog + scope selector (all/global/local). |

## Gallery

### A. Home
![Activity feed](./gifs/01-activity-feed.gif)
![Sidebar](./gifs/02-sidebar.gif)
![Spawn modal](./gifs/03-spawn-modal.gif)
![Global terminal](./gifs/04-terminal-global.gif)
![Claude config](./gifs/05-claude-config.gif)
![Library](./gifs/06-library.gif)
![Extensions](./gifs/07-extensions.gif)
![Tunnel](./gifs/08-tunnel.gif)

### B. Session
![Session controls + Peek](./gifs/09-session-controls.gif)
![Chat transcript](./gifs/10-chat.gif)
![Canvas](./gifs/11-canvas.gif)
![Session terminal](./gifs/12-terminal-session.gif)
![Files diff](./gifs/13-files-diff.gif)

### C. Project
![Project sessions](./gifs/14-project-sessions.gif)
![GitHub PR diff](./gifs/15-github.gif)
![Project terminal](./gifs/16-terminal-project.gif)
![Files tree](./gifs/17-files-tree.gif)
![Project Claude config](./gifs/18-claude-project.gif)
![Project Library](./gifs/19-library-project.gif)
