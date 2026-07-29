import { describe, expect, it } from "bun:test"
import {
  appendTail,
  classifyTail,
  decideTransition,
  stripAnsi,
  terminalStateKey,
} from "./terminal-state.core"

// Real evidence, not hand-typed: most fixtures below are exact byte slices
// captured by driving an actual `claude` 2.1.220 or `pi` 0.80.3 CLI through a
// forked pty (throwaway driver script, not part of this repo) and logging
// raw stdout. The two PERMISSION_* literals are the exception — see their
// own comment. See terminal-state.core.ts's module comment for the full
// evidence-source breakdown.

// Startup splash: heavy true-colour SGR + cursor-column-absolute CSI + one
// OSC title update, no ellipsis/gerund content — exercises stripAnsi without
// tripping any matcher.
const SPLASH_FIXTURE =
  "\x1b7\x1b[r\x1b8\x1b[?25h\x1b[?25l\x1b[?2004h\x1b[?1004h\x1b[?2031h\x1b]0;✳ Claude Code\x07\x1b[38;2;215;119;87m ▐\x1b[48;2;0;0;0m▛███▜\x1b[49m▌\x1b[12G\x1b[39m\x1b[1mClaude\x1b[19GCode\x1b[24G\x1b[22m\x1b[38;2;153;153;153mv2.1.220\x1b[39m"

// Mid-generation spinner frame: "Burrowing…" and "(3s · ↓4 tokens)" are two
// separate writes split by a `\x1b[14G` cursor jump — stripAnsi must join
// them back into one contiguous phrase for thinking-gerund to match.
const THINKING_FIXTURE =
  "\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\x1b[2C\x1b[4A\x1b[?25h\x1b[?25l\x1b[2D\x1b[4B\r\x1b[7A\x1b[38;2;215;119;87m·\x1b[3G\x1b[38;2;220;129;97mBurrowing…\x1b[14G\x1b[38;2;153;153;153m(3s · ↓\x1b[22G4 tokens)"

// Tool call in flight: "⏺ Bash(echo hello-from-claude) … ⎿  Waiting…",
// including the real `\x1b[K` erase-in-line CSI and an embedded `\r`
// (no `\n`) between the tool line and the "Waiting…" line.
const TOOL_WAITING_FIXTURE =
  "\r\x1b[7A\x1b[38;2;153;153;153m⏺\x1b[3G\x1b[39m\x1b[1mBash\x1b[22m(echo hello-from-claude)\r\x1b[1B\x1b[38;2;153;153;153m  ⎿  Waiting…"

// Turn finished: OSC title update back to the static "✳" glyph, then
// "Churned for 6s" plain text, then a `\x1b[K` before the next redraw.
const TURN_COMPLETE_FIXTURE =
  "\x1b]0;✳ herd codebase structure review\x07\x1b[?25l\x1b[2D\x1b[4B\r\x1b[7A\x1b[38;2;153;153;153m✻\x1b[3GChurned for 6s"

// Real bytes from a second CLI: captured by driving an actual `pi` 0.80.3
// through the same pty driver. "⠋ Working..." — braille spinner SGR, then
// the literal status text — cycling roughly every 100ms for the whole turn.
const PI_WORKING_FIXTURE =
  "\x1b[2K \x1b[38;2;138;190;183m⠋\x1b[39m \x1b[38;2;128;128;128mWorking...\x1b[39m"

// NOT a captured render — these two are read directly out of the shipped
// Claude Code 2.1.220 binary (`strings -a` on
// ~/.local/share/claude/versions/2.1.220), which is how permission-prompt
// and permission-prompt-reject-option in the matcher table are verified.
// See the module comment and each matcher's own comment for the full
// evidence trail. Plain strings (no ANSI) because that's exactly what
// `strings` extracts — the CLI never rendered this text to a live terminal
// during this investigation (auto-approved past the dialog every time).
const PERMISSION_PROMPT_LITERAL = "Do you want to proceed?"
const PERMISSION_REJECT_OPTION_LITERAL = "No, and tell Claude what to do differently"

// A real `zellij action dump-screen` of a Claude Code session RESTING at its
// prompt: no turn in flight, and its last "…ed for Ns" line long since scrolled
// out of the viewport. Captured 2026-07-29 from an unattended session on the dev
// box (session 4d76edc1, Claude Code 2.1.220). Before this frame classified,
// this was the single most common screen on the machine and every one of them
// read `unknown`.
//
// The pad is written as an ESCAPE on purpose. Hexdumping a real dump shows the
// input line is `e2 9d af c2 a0 0a` — `❯` followed by U+00A0 NO-BREAK SPACE,
// which is indistinguishable from an ordinary space in source. The first
// version of this fixture hand-typed a plain space, passed, and shipped a
// matcher that then fired on exactly 1 of 27 live screens.
const PROMPT_LINE = "❯\u00a0"

const PROMPT_RESTING_DUMP = [
  "  Ran 3 shell commands",
  PROMPT_LINE,
  "──────────────────────────────────────────────────────",
  "    [Opus 5 (1M context)] 22% | $14.88 | 🌿 main | 📬 30 PRs | 🧠 default",
  "  ⏵⏵ auto mode on (shift+tab to cycle) · ← 85 agents · PR #403",
].join("\n")

// The same prompt box, on a session that is very much WORKING: captured from
// session f7199556 mid-turn, with the spinner line six lines above the box. The
// prompt box is drawn identically whether or not a turn is in flight, which is
// exactly why the resting matcher has to sit BELOW every working matcher.
const PROMPT_WORKING_DUMP = [
  "  Ran 2 shell commands",
  "✢ Recombobulating… (9m 14s · ↓ 24.4k tokens)",
  "  ⎿  Tip: Control this session from the Claude mobile app · run /remote-control",
  "──────────────────────────── herd codebase structure review ──",
  PROMPT_LINE,
  "──────────────────────────────────────────────────────",
  "    [Opus 5 (1M context)] 25% | $274.42 | 🌿 feat/session-card-terminal-chip",
  "  ⏵⏵ auto mode on (shift+tab to cycle) · ← 85 agents · PR #430",
].join("\n")

describe("stripAnsi", () => {
  it("drops OSC title sequences (BEL-terminated) and CSI true-colour/cursor codes", () => {
    // The box-drawing glyphs are the splash logo itself, not a stripping bug.
    expect(stripAnsi(SPLASH_FIXTURE)).toBe(" ▐▛███▜▌ClaudeCodev2.1.220")
  })

  it("joins text split by a cursor-jump CSI back into one phrase", () => {
    expect(stripAnsi(THINKING_FIXTURE)).toContain("Burrowing…(3s · ↓4 tokens)")
  })

  it("survives an erase-in-line CSI (\\x1b[K) and a bare \\r with no trailing \\n", () => {
    // The real bytes here move the cursor down a row (`\x1b[1B`) rather than
    // reprinting the same row — with no `\n` to mark that as a new line, the
    // simplified last-write-after-\r model (see collapseCarriageReturns)
    // drops the "Bash(...)" text that came before the `\r`. Documented
    // rather than hidden: it doesn't matter for classifyTail, since the
    // matcher below only needs "Waiting…" to fire, but it's a real gap if
    // this module ever needs to report surrounding context.
    const plain = stripAnsi(TOOL_WAITING_FIXTURE)
    expect(plain).toContain("Waiting…")
    expect(plain).not.toContain("Bash")
  })

  it("collapses a carriage-return overwrite to the last write on that line", () => {
    // "AAAAAA" then a bare \r rewinds to column 0, then "BB" overwrites the
    // first two cells — a real screen shows "BBAAAA", but the simplified
    // last-write-wins model (good enough for substring matching) keeps only
    // what followed the final \r: "BB".
    expect(stripAnsi("AAAAAA\rBB")).toBe("BB")
  })

  it("leaves lines with no \\r untouched", () => {
    expect(stripAnsi("line one\nline two")).toBe("line one\nline two")
  })

  it("strips a real pi spinner frame down to the spinner glyph and status text", () => {
    expect(stripAnsi(PI_WORKING_FIXTURE)).toBe(" ⠋ Working...")
  })
})

describe("appendTail", () => {
  it("concatenates chunks under the cap", () => {
    expect(appendTail({ tail: "abc", chunk: "def", maxChars: 100 })).toBe("abcdef")
  })

  it("caps the result to the last maxChars characters", () => {
    expect(appendTail({ tail: "abcde", chunk: "fgh", maxChars: 4 })).toBe("efgh")
  })

  it("a chunk longer than maxChars still keeps only its own tail", () => {
    expect(appendTail({ tail: "", chunk: "0123456789", maxChars: 3 })).toBe("789")
  })
})

describe("classifyTail", () => {
  it("classifies real Claude Code thinking output as working (thinking-gerund)", () => {
    const result = classifyTail({ tail: THINKING_FIXTURE })
    expect(result.state).toBe("working")
    expect(result.matcher).toBe("thinking-gerund")
    expect(result.evidence).toContain("Burrowing")
  })

  it("classifies a real tool-call-in-flight line as working (tool-call-waiting)", () => {
    const result = classifyTail({ tail: TOOL_WAITING_FIXTURE })
    expect(result.state).toBe("working")
    expect(result.matcher).toBe("tool-call-waiting")
  })

  it("classifies a real turn-complete line as idle (turn-complete)", () => {
    const result = classifyTail({ tail: TURN_COMPLETE_FIXTURE })
    expect(result.state).toBe("idle")
    expect(result.matcher).toBe("turn-complete")
    expect(result.evidence).toBe("Churned for 6s")
  })

  it("classifies a session resting at its prompt as idle (prompt-resting)", () => {
    const result = classifyTail({ tail: PROMPT_RESTING_DUMP })
    expect(result.state).toBe("idle")
    expect(result.matcher).toBe("prompt-resting")
  })

  it("matches the prompt line whichever horizontal whitespace pads it", () => {
    // The pad Claude Code actually emits is U+00A0 (see PROMPT_LINE); a pattern
    // written against an ordinary space silently matches almost nothing on a real
    // box. Every horizontal form must classify, and the NBSP one is the one that
    // occurs in practice.
    expect(classifyTail({ tail: PROMPT_LINE }).matcher).toBe("prompt-resting")
    expect(classifyTail({ tail: "❯\u00a0\u00a0\u00a0" }).matcher).toBe("prompt-resting")
    expect(classifyTail({ tail: "❯   " }).matcher).toBe("prompt-resting")
    expect(classifyTail({ tail: "❯\t" }).matcher).toBe("prompt-resting")
    // Bare, no pad at all.
    expect(classifyTail({ tail: "❯" }).matcher).toBe("prompt-resting")
  })

  // The prompt box is on screen during a turn too, so ordering is the only thing
  // keeping this from reporting a busy agent as idle. Assert the order, not just
  // the rows.
  it("still reports working when the prompt box shares the frame with a spinner", () => {
    const result = classifyTail({ tail: PROMPT_WORKING_DUMP })
    expect(result.state).toBe("working")
    expect(result.matcher).toBe("thinking-gerund")
  })

  it("still reports blocked when the prompt box shares the frame with a permission dialog", () => {
    const result = classifyTail({ tail: `${PERMISSION_PROMPT_LITERAL}\n${PROMPT_RESTING_DUMP}` })
    expect(result.state).toBe("blocked")
    expect(result.matcher).toBe("permission-prompt")
  })

  // A half-typed prompt is not a resting one: the user is mid-thought, and
  // claiming "idle" would be a guess. Unknown stays the honest answer.
  it("does not treat a prompt with typed text as resting", () => {
    const result = classifyTail({ tail: "❯ what is the plan\n────────────────" })
    expect(result.state).toBe("unknown")
  })

  it("classifies a real pi spinner frame as working (pi-working)", () => {
    const result = classifyTail({ tail: PI_WORKING_FIXTURE })
    expect(result.state).toBe("working")
    expect(result.matcher).toBe("pi-working")
    expect(result.evidence).toBe("Working...")
  })

  it("classifies the Claude Code permission-prompt header as blocked", () => {
    const result = classifyTail({ tail: PERMISSION_PROMPT_LITERAL })
    expect(result.state).toBe("blocked")
    expect(result.matcher).toBe("permission-prompt")
  })

  it("classifies the permission-prompt reject option as blocked on its own", () => {
    // Simulates the tail catching only the bottom of a long dialog — the
    // header has already scrolled out of the bounded window.
    const result = classifyTail({ tail: PERMISSION_REJECT_OPTION_LITERAL })
    expect(result.state).toBe("blocked")
    expect(result.matcher).toBe("permission-prompt-reject-option")
  })

  it("returns unknown — not a guess — when nothing recognizable is in the tail", () => {
    const result = classifyTail({ tail: stripAnsi(SPLASH_FIXTURE) })
    expect(result).toEqual({ state: "unknown", matcher: undefined, evidence: undefined })
  })

  it("prefers blocked over a stale working line still inside the window", () => {
    const tail = `${THINKING_FIXTURE} Do you want to proceed?`
    expect(classifyTail({ tail }).state).toBe("blocked")
  })

  it("prefers working over a stale idle line still inside the window", () => {
    const tail = `${TURN_COMPLETE_FIXTURE} ${THINKING_FIXTURE}`
    expect(classifyTail({ tail }).state).toBe("working")
  })

  it("caps evidence length so one runaway line can't bloat the payload", () => {
    const longVerb = `A${"b".repeat(250)}ing…`
    const result = classifyTail({ tail: longVerb })
    expect(result.state).toBe("working")
    expect(result.evidence?.length).toBe(201)
    expect(result.evidence?.endsWith("…")).toBe(true)
  })
})

describe("decideTransition", () => {
  const classification = (
    state: "working" | "blocked" | "idle" | "unknown",
  ): ReturnType<typeof classifyTail> => ({ state, matcher: "x", evidence: "y" })

  it("publishes on a genuine state change", () => {
    expect(decideTransition({ prior: "idle", next: classification("working") })).toEqual({
      publish: true,
    })
  })

  it("does not publish when the state is unchanged, even with new evidence", () => {
    expect(decideTransition({ prior: "working", next: classification("working") })).toEqual({
      publish: false,
    })
  })

  it("publishes the first classification ever seen (prior undefined)", () => {
    expect(decideTransition({ prior: undefined, next: classification("idle") })).toEqual({
      publish: true,
    })
  })
})

describe("terminalStateKey", () => {
  it("joins scope and id with a colon", () => {
    expect(terminalStateKey({ scope: "session", id: "ab12cd34" })).toBe("session:ab12cd34")
  })
})
