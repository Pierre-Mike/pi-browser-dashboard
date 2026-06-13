# Dashboard TODO — issues & improvements

Found by running the live app (`bun run dev`, daemon :8787 + web :5173) and driving
every route/tab with headless Chrome (same method as `doc/demo/`), capturing console
errors, failed requests, and screenshots. Each item has a file:line anchor and a fix
sketch so a future AI can pick it up cold. Ordered by severity.

Probe matrix: home tabs (Activity/Terminal/Claude/Library/Extensions/Tunnel), spawn
modal, session `/sessions/$id` (chat/canvas/terminal/files), project `/projects/$id`
(GitHub/Terminal/Files/Claude/Library), plus invalid `/sessions/deadbeef` and
`/projects/does-not-exist`.

---

## P0 — correctness bugs (reproduced live)

### 1. Nested `<button>` inside `<button>` on every session card
- **Where:** `apps/web/src/features/sessions/SessionCard.tsx:127` — the whole card is a
  `<button onClick={openReply}>` that wraps action `<button>`s (Open/Peek/Send/Kill/Delete,
  lines 169–225) **and** a `SendKeysPanel` `<textarea>` (line 241).
- **Symptom:** React logs `validateDOMNesting: <button> cannot appear as a descendant of
  <button>` on **every** home and project render (caught on all 13 home/project probes).
  Invalid HTML → undefined click target, broken keyboard/AT semantics, focus traps.
- **Fix:** make the card a `<div role="button" tabIndex={0}>` with `onClick` + `onKeyDown`
  (Enter/Space → `openReply`), or restructure so the card surface and the action row are
  siblings, not ancestor/descendant. Drop the `stopPropagation` hack on the action row once
  the outer element is no longer a button.

### 2. Duplicate React keys in chat transcript → messages render multiple times
- **Where:** `apps/web/src/features/transcripts/TranscriptView.tsx:326` —
  `const key = \`msg-${item.timestamp || i}-${item.kind}\``.
- **Symptom:** console `Encountered two children with the same key, msg-2026-06-11T16:42:34…`;
  screenshot of the chat tab shows the **same user message duplicated 3–4 times**. Two
  same-kind messages sharing a second-resolution timestamp collide → React duplicates/omits.
- **Fix:** append the array index: `msg-${item.timestamp || i}-${item.kind}-${i}` (or use a
  stable per-message id from the daemon if one exists). Add a regression test in
  `TranscriptView.test.tsx` with two same-timestamp same-kind messages.

### 3. Invalid session id shows infinite "Loading session…" + live action buttons
- **Where:** `apps/web/src/routes/sessions.$id.tsx:31-40` (queryFn returns `null` on `!res.ok`,
  so `isLoading` is false but `data` is null) and the terminal branch `:336` falls back to
  `Loading session…` forever.
- **Symptom:** `/sessions/deadbeef` → 404s on `/sessions/:id`, `/transcript`, `/files`, header
  prints the raw id `deadbeef`, and Open-in-CLI / Peek / Kill / Delete stay enabled against a
  phantom session.
- **Contrast:** `/projects/does-not-exist` does this correctly — `projects.$id.tsx` renders
  "Project … not found." with an "← All projects" link.
- **Fix:** mirror the project route. Distinguish not-found (`res.status === 404`) from loading;
  render a "Session not found" state with a back link and hide the action bar when `session`
  is null and not loading.

---

## P1 — UX / performance

### 4. All home tab panels mount on load (hidden, not unmounted)
- **Where:** `apps/web/src/routes/index.tsx:148-208` — every panel (`GlobalTerminal`,
  `ClaudeConfigPanel`, `LibraryPanel`, `ExtensionsPanel`, `TunnelPanel`, and every iframe
  `ExtensionHost`) renders unconditionally with `className={tab===… ? … : "hidden"}`.
- **Symptom:** on first paint the app opens a terminal WebSocket, fires Claude-config /
  library / extensions / tunnel queries, and mounts every extension iframe — even though only
  one tab is visible. Wasted sockets, requests, and memory; extension iframes run hidden.
- **Fix:** gate expensive panels behind `tab === key` (conditional mount) or a
  mount-once-then-hide wrapper so inactive panels don't open sockets/iframes until first
  visited. Keep the `hidden` approach only for cheap panels.

### 5. Default landing tab is `terminal`, not the activity overview
- **Where:** `apps/web/src/routes/index.tsx:80` (`const { tab = "terminal" }`).
- **Symptom:** opening `/` drops you into a raw global terminal; the sessions/projects
  Activity feed — the dashboard's primary value — is one click away and not the default.
- **Fix:** default to `projects` (Activity), or persist the last-used tab. Low-risk, high-impact
  first-impression change. (Confirm with the maintainer; this is a product call.)

### 6. Transcript auto-scroll hijacks manual scroll-up
- **Where:** `apps/web/src/routes/sessions.$id.tsx:173-178` — `scrollIntoView` on every
  `messageCount` change.
- **Symptom:** while reading older transcript history, any new message yanks the view to the
  bottom.
- **Fix:** only auto-scroll when the user is already pinned near the bottom (track a
  `isNearBottom` ref from the scroll container); otherwise show a "jump to latest" affordance.

### 7. "Peek" spends Haiku quota with no confirmation
- **Where:** `SessionCard.tsx:177` and `sessions.$id.tsx:213` — tooltip says "costs one call
  against your quota" but a single click fires it.
- **Fix:** either a lightweight confirm on first use per session, or a visible cost hint inline
  (not just a `title=`), or debounce/disable for N seconds after a peek.

---

## P2 — polish

### 8. Missing favicon → 404 on every page load
- **Where:** `apps/web/index.html` has no `<link rel="icon">`; `/favicon.ico` → 404
  (`/vite.svg` and `/manifest.json` both 200, so an icon asset already exists).
- **Fix:** add `<link rel="icon" href="/vite.svg" />` (or a real icon) to `index.html`.

### 9. Terminal renders missing-glyph boxes (▯) in the zellij status bar
- **Where:** xterm font stack in the terminal feature (`apps/web/src/features/terminal/`,
  session `TerminalTab`, project/global terminals).
- **Symptom:** zellij's powerline/Nerd-Font glyphs (tab markers, LOCK/PANE/TAB icons) show as
  replacement boxes because the web terminal font lacks them.
- **Fix:** ship/configure a Nerd Font (e.g. a bundled patched mono) in the xterm `fontFamily`,
  or strip the glyphs. Cosmetic but visible in every terminal view.

---

## Cross-cutting / tech-debt

### 10. End-to-end Hono RPC types are erased — ~25 `as any` casts
- **Where:** ~25 `// biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on
  daemon AppType resolution` across `apps/web/src/features/**` and `routes/sessions.$id.tsx`.
  Every API call casts the `hc` client to `any`, so request params and response bodies are
  unchecked (responses are hand-cast with `as SessionState` etc.).
- **Why it matters:** the daemon-to-web type contract — the main payoff of Hono RPC — is not
  being enforced; a route/shape change won't fail the build, it'll fail at runtime.
- **Fix:** resolve the `AppType` export so `hc<AppType>` types the client (often a
  `typeof app` export ordering / `satisfies` issue, or splitting route apps so the inferred
  type isn't `any`). Removing the casts then gives compile-time coverage of #2/#3-class bugs.

---

## How to re-run this audit

```bash
bun run dev                       # daemon :8787 + web :5173
# install playwright ad hoc (not a repo dep), then drive each route with
# waitUntil:'domcontentloaded' (NOT 'networkidle' — the app holds an SSE
# /events connection open forever, so networkidle never fires).
# Listen for: page 'console' (error/warning), 'pageerror', 'requestfailed',
# and 'response' status>=400; screenshot each tab; probe an invalid
# /sessions/<bad> and /projects/<bad> for not-found handling.
```
