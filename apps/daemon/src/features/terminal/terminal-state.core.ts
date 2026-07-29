// Pure classification of "what is this agent doing right now" from the raw
// bytes flowing through a terminal WS bridge (see terminal.routes.ts for the
// tap). herdr's core idea transplanted here: read the screen, don't require
// an integration — a `claude` the user started themselves in a plain zellij
// pane is just as classifiable as one the daemon spawned.
//
// Every VERIFIED row in MATCHERS below rests on one of two evidence sources,
// named in the row's own comment:
//   - a captured pty run: a throwaway driver forked a real pty, ran an
//     actual `claude` (2.1.220) or `pi` (0.80.3) CLI inside it, and logged
//     the raw bytes while it answered a prompt / invoked a tool.
//   - the shipped CLI's own source: Claude Code ships as a single compiled
//     binary (`strings -a` on `~/.local/share/claude/versions/2.1.220`,
//     a Mach-O executable) with its UI copy embedded as literal strings;
//     `pi` ships unminified JS (`@earendil-works/pi-coding-agent`'s `dist/`),
//     so the literal is readable straight from source, file:line included.
// A row with neither is marked unverified in its own comment.

export type TerminalStateSlug = "working" | "blocked" | "idle" | "unknown"

// ---- ANSI stripping ---------------------------------------------------

// OSC: ESC ] ... terminated by BEL or ST. Verified real bytes:
// `\x1b]0;✳ herd codebase structure review\x07` (Claude Code's tab-title
// updates). This is a side channel, not screen content — a title never also
// appears in the visible transcript — so it is dropped wholesale rather than
// kept as text.
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI OSC escapes
const OSC_RE = /\x1b\][\s\S]*?(?:\x07|\x1b\\)/g

// CSI: ESC [ <params 0-9:;<=>?>* <intermediates 0x20-0x2f>* <final 0x40-0x7e>.
// Verified real bytes cover all three shapes this needs to survive: cursor
// moves (`\x1b[14G`), true-colour SGR (`\x1b[38;2;220;129;97m`), and
// erase-in-line (`\x1b[K`).
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI CSI escapes
const CSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g

// Bare two-byte escapes (save/restore cursor, charset select) seen around the
// splash screen — don't fit the CSI/OSC shapes above.
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping bare ANSI escapes
const OTHER_ESC_RE = /\x1b[0-9A-Za-z=>]/g

// Real TUIs redraw a status line in place via a bare `\r` (no `\n`, often no
// erase-to-end-of-line either) rather than reprinting a fresh line — verified
// in the captured spinner frames. Modelling a full terminal grid is overkill
// for a matcher that only needs plain text, so approximate it: within each
// `\n`-delimited segment, keep only what was written after the LAST `\r`.
// That is exactly what a real screen shows once redraws settle.
const collapseCarriageReturns = (text: string): string =>
  text
    .split("\n")
    .map((line) => {
      const idx = line.lastIndexOf("\r")
      return idx === -1 ? line : line.slice(idx + 1)
    })
    .join("\n")

export const stripAnsi = (raw: string): string => {
  const noOsc = raw.replace(OSC_RE, "")
  const noCsi = noOsc.replace(CSI_RE, "")
  const noEsc = noCsi.replace(OTHER_ESC_RE, "")
  return collapseCarriageReturns(noEsc)
}

// ---- rolling tail -------------------------------------------------------

// Cheap buffer maintenance only — no ANSI stripping, no regex. Called on
// every chunk off the byte-forward path, so it must stay O(chunk length).
// classifyTail does the (comparatively) expensive work, and only on a
// throttle.
export const appendTail = (input: {
  readonly tail: string
  readonly chunk: string
  readonly maxChars: number
}): string => {
  const combined = input.tail + input.chunk
  if (combined.length <= input.maxChars) return combined
  return combined.slice(combined.length - input.maxChars)
}

// ---- classification -------------------------------------------------------

type Matcher = {
  readonly name: string
  readonly state: TerminalStateSlug
  readonly pattern: RegExp
}

// First-match-wins, evaluated top to bottom against the current (bounded)
// tail — there is no position/recency tracking, so ordering doubles as
// priority: `blocked` outranks a stale `working` line still inside the
// window, and `working` outranks a stale `idle` line. See individual
// comments for which rows are backed by a captured byte sample.
const MATCHERS: ReadonlyArray<Matcher> = [
  {
    name: "permission-prompt",
    state: "blocked",
    // Verified against the shipped binary: `strings -a` on
    // `~/.local/share/claude/versions/2.1.220` (Claude Code 2.1.220, Mach-O
    // arm64) contains the literal "Do you want to proceed?" five times, each
    // adjacent to unambiguous tool-approval identifiers — "Bash command
    // (unsandboxed)", "PowerShell command (unsandboxed)", "accept-once",
    // "accept-session", "reject", "confirm:yes", "confirm:no" — confirming
    // it is the dialog's own copy, not a comment or doc string. Could not
    // additionally confirm by *rendering* it: every attempt to trigger the
    // dialog against a real `claude` process in this sandbox auto-approved
    // the tool call first (a broad user-level Bash allow-list), so this row
    // has binary-string evidence but no captured live-render evidence.
    pattern: /Do you want to proceed\?/,
  },
  {
    name: "permission-prompt-reject-option",
    state: "blocked",
    // Verified the same way, same binary offsets: the dialog's third option
    // literal, "No, and tell Claude what to do differently". Covers the case
    // where the tail window caught only the bottom of a long dialog and the
    // "Do you want to proceed?" header already scrolled out of the
    // (bounded) tail.
    pattern: /No, and tell Claude what to do differently/,
  },
  {
    name: "tool-call-waiting",
    state: "working",
    // Verified: captured mid-tool-call — "⏺ Bash(echo hello-from-claude) …
    // ⎿  Waiting…" — printed while a tool the agent invoked is still
    // running (not the same thing as waiting on a human).
    pattern: /⎿\s*Waiting…/,
  },
  {
    name: "thinking-gerund",
    state: "working",
    // Verified: Claude Code's status line rotates through invented gerunds
    // while generating, e.g. "Burrowing…(3s · ↓4 tokens)", "Elucidating…",
    // "Shenaniganing…". The verb is randomized and effectively unbounded, so
    // match the shape (capitalized word ending "ing" + ellipsis) rather than
    // any fixed word list.
    pattern: /\b[A-Z][a-z]+ing…/,
  },
  {
    name: "pi-working",
    state: "working",
    // Verified: captured a real `pi` 0.80.3 run — the screen shows
    // "⠋ Working..." (braille spinner + this exact literal) for the whole
    // turn, cycling spinner frames every ~100ms. Matches
    // `defaultWorkingMessage = "Working..."` in
    // pi-coding-agent/dist/modes/interactive/interactive-mode.js:161 (pi
    // ships unminified, so the source and the rendered text agree). The
    // same file sometimes appends "(escape to interrupt)" to this message
    // (interactive-mode.js:1472, via keybinding `app.interrupt` →
    // default key "escape", core/keybindings.js:7) — confirmed in source
    // but not observed in the captured run, so no separate rule for it: the
    // plain "Working..." match already covers both forms as a substring.
    pattern: /\bWorking\.\.\./,
  },
  {
    name: "turn-complete",
    state: "idle",
    // Verified: printed once a turn finishes and control returns to the
    // prompt, e.g. "Cogitated for 3s", "Churned for 6s" — same
    // randomized-verb shape as thinking-gerund, past tense.
    pattern: /\b[A-Z][a-z]+ed for \d+s\b/,
  },
  {
    name: "prompt-resting",
    state: "idle",
    // Verified: `zellij action dump-screen` of real unattended sessions on
    // 2026-07-29 — an empty input line, `❯` followed only by the box's padding
    // spaces. This is what a finished session looks like once its "…ed for Ns"
    // line has scrolled out of the viewport, which on a long-lived box is most
    // of them: before this row, 19 of 25 polled terminals classified `unknown`.
    //
    // MUST STAY LAST. The prompt box is drawn during a turn as well — the same
    // dump on a working session showed this exact empty `❯` line six lines
    // below a live "Recombobulating…" spinner — so this row is only correct
    // because first-match-wins puts every `blocked` and `working` matcher ahead
    // of it. It reads as "the UI is up and nothing else matched".
    //
    // Two known costs, both accepted deliberately: a bare shell whose own
    // prompt is `❯` (starship, zsh) also matches, which is defensible — an
    // empty shell IS idle; and a working frame that happens to carry no spinner
    // would read idle for one poll interval before the next pass corrects it.
    // A Claude Code version that draws a left border inside the box
    // (`│ ❯`) would stop matching, and would need this pattern widened against
    // a fresh capture rather than on speculation.
    pattern: /^❯[ \t]*$/m,
  },
]

export type Classification = {
  readonly state: TerminalStateSlug
  readonly matcher: string | undefined
  readonly evidence: string | undefined
}

// Long enough to be useful in a title tooltip, short enough that a matched
// line with megabytes of accidental repetition (unlikely, but the tail is
// attacker-adjacent — it's remote-process output) can't bloat an SSE payload.
const EVIDENCE_MAX_CHARS = 200

const trimEvidence = (matched: string): string => {
  const line = matched.trim()
  return line.length > EVIDENCE_MAX_CHARS ? `${line.slice(0, EVIDENCE_MAX_CHARS)}…` : line
}

export const classifyTail = (input: { readonly tail: string }): Classification => {
  const plain = stripAnsi(input.tail)
  for (const matcher of MATCHERS) {
    const found = matcher.pattern.exec(plain)
    if (found) {
      return { state: matcher.state, matcher: matcher.name, evidence: trimEvidence(found[0]) }
    }
  }
  return { state: "unknown", matcher: undefined, evidence: undefined }
}

// Publish only on an actual state change — a matcher/evidence update that
// leaves the state the same (e.g. one gerund replaced by another while still
// "working") is not a transition, and a client watching chips doesn't need
// an SSE event per keystroke.
export const decideTransition = (input: {
  readonly prior: TerminalStateSlug | undefined
  readonly next: Classification
}): { readonly publish: boolean } => ({
  publish: input.prior !== input.next.state,
})

// Registry key for GET /terminal/states and the terminal.state SSE payload —
// centralised so the route and any consumer agree on the same shape.
export const terminalStateKey = (input: { readonly scope: string; readonly id: string }): string =>
  `${input.scope}:${input.id}`
