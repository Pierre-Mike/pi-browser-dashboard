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
// raw stdout, and the rest are verbatim `zellij action dump-screen` output
// from real sessions. One literal is read out of the shipped binary instead
// and says so at its definition. See terminal-state.core.ts's module comment
// for the full evidence-source breakdown.

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

// Tool call dispatched and still pending: the tool line, then its pending
// marker. Includes the real `\x1b[K` erase-in-line CSI and an embedded `\r`
// (no `\n`) between the two lines.
//
// The pad between the marker and the word is an ordinary space followed by
// U+00A0, and it is written as an ESCAPE below for the same reason PROMPT_LINE
// is: hexdumping a live dump of this line gives `20 20 23bf 20 a0 57 61 …`,
// and a NO-BREAK SPACE is indistinguishable from a space in source. This
// fixture carried the real NBSP all along (it came off a pty) invisibly, so no
// reader could have known which one the matcher had to tolerate.
const TOOL_WAITING_FIXTURE =
  "\r\x1b[7A\x1b[38;2;153;153;153m⏺\x1b[3G\x1b[39m\x1b[1mBash\x1b[22m(echo hello-from-claude)\r\x1b[1B\x1b[38;2;153;153;153m  ⎿ \u00a0Waiting…"

// Turn finished: OSC title update back to the static "✳" glyph, then
// "Churned for 6s" plain text, then a `\x1b[K` before the next redraw.
const TURN_COMPLETE_FIXTURE =
  "\x1b]0;✳ herd codebase structure review\x07\x1b[?25l\x1b[2D\x1b[4B\r\x1b[7A\x1b[38;2;153;153;153m✻\x1b[3GChurned for 6s"

// Real bytes from a second CLI: captured by driving an actual `pi` 0.80.3
// through the same pty driver. "⠋ Working..." — braille spinner SGR, then
// the literal status text — cycling roughly every 100ms for the whole turn.
const PI_WORKING_FIXTURE =
  "\x1b[2K \x1b[38;2;138;190;183m⠋\x1b[39m \x1b[38;2;128;128;128mWorking...\x1b[39m"

// ---- live working-state captures (2026-07-29) ---------------------------
//
// Same method as the dialog captures below: real CLIs inside zellij sessions
// created for the purpose (`polltest-work22*`, `polltest-pi22`), read with
// `zellij action dump-screen --pane-id terminal_0`, plus the raw byte stream of
// the same screens through a forked pty running `zellij attach`.
//
// Claude Code mid-turn, 50-col pane. Two things on screen at once: a tool's own
// progress line, and the rotating status line underneath it. The spinner glyph
// rotates (`·` U+00B7, `✢` U+2722, `✻` U+273B, `✶` U+2726 were all captured), so
// it is NOT what the matcher keys on — the duration in the parenthetical is.
const CC_STATUS_LINE_DUMP = [
  "⏺ Searching for 1 pattern… (ctrl+o to expand)",
  "     (ctrl+b to run in background)",
  "",
  "✶ Slithering… (41s · ↓ 125 tokens)",
].join("\n")

// The same status line as raw redraw bytes: zellij wraps every word in an OSC 8
// hyperlink reset and colours it with true-colour SGR, so `stripAnsi` has to put
// "Slithering…" and "(12s" back together before the row can match. Cut at an
// escape boundary, hence the parenthetical stops after the duration.
const CC_STATUS_LINE_WS_BYTES =
  "\x1b[m\x1b]8;;\x1b\\ \x1b[38;2;215;119;87mSkedaddling…\x1b[m\x1b]8;;\x1b\\ \x1b[38;2;153;153;153m(12s\x1b[m\x1b]8;;\x1b\\"

// A dispatched tool still pending, dump form. Captured from the same session as
// the Bash dialog below — the marker persists for as long as the tool has not
// returned, which includes "the human has not answered the dialog yet", so a
// screen carrying this can be `blocked`; ordering, not this row, decides that.
// The pad is space + U+00A0 again, escaped so a reader can see it.
const CC_TOOL_WAITING_DUMP = [
  "⏺ Bash(touch /tmp/permprobe19/hello.txt)",
  "  ⎿ \u00a0Waiting…",
].join("\n")

// pi 0.80.3 mid-turn, dump form. Ten distinct braille spinner frames were
// captured (U+2807 U+280B U+280F U+2819 U+2826 U+2827 U+2834 U+2838 U+2839
// U+283C), always immediately before the literal, always one ordinary space
// apart: hexdump `20 2838 20 57 6f 72 6b 69 6e 67 2e 2e 2e`.
const PI_WORKING_DUMP = " ⠸ Working..."

// The same pi line as raw redraw bytes, through zellij.
const PI_WORKING_WS_BYTES =
  "\x1b[?25l\x1b[37;1H\x1b[?25l\x1b[34;1H\x1b[m\x1b[m\x1b]8;;\x1b\\ \x1b[38;2;138;190;183m⠏\x1b[m\x1b]8;;\x1b\\ \x1b[38;2;128;128;128mWorking...\x1b[m\x1b]8;;\x1b\\"

// The screen that produced the live false positive: three lines of the AGENTS.md
// paragraph that documents this very table, quoting the literals it matches on.
// Verbatim from the file as it read before this change.
const WORKING_LITERALS_QUOTED_IN_PROSE = [
  'status-line and dialog shapes — Claude Code\'s `"<Gerund>…(<N>s · …)"` while',
  'generating, `"⎿ Waiting…"` mid-tool-call, `"<PastVerb> for <N>s"` once a turn',
  'permission decision; pi\'s `"Working..."` spinner — against a per-connection',
].join("\n")

// ---- live permission-dialog captures (2026-07-29) -----------------------
//
// These are RENDERS, not `strings` output. A `claude` 2.1.220 was started
// inside a zellij session created for this purpose (`polltest-perm19`, cwd
// /private/tmp/permprobe19) under `--permission-mode manual` plus
// `--settings '{"permissions":{"ask":["Bash"]}}'` / `["Write"]`, so the tool
// call it was asked to make had to stop at a real dialog instead of being
// auto-approved by the box's broad user-level Bash allow-list — the exact
// obstacle that left these rows unrendered the first time round. Each fixture
// below is verbatim `zellij action dump-screen --pane-id terminal_0` output.
//
// Every space in the dialog is an ORDINARY space — checked, not assumed.
// Hexdump of the header plus both option lines of the Bash dialog:
//   20 44 6f 20 79 6f 75 20 77 61 6e 74 20 74 6f 20 70 72 6f 63 65 65 64 3f 0a
//   20 e2 9d af 20 31 2e 20 59 65 73 0a
//   20 20 20 32 2e 20 4e 6f 0a
// i.e. `␠Do you want to proceed?\n␠❯␠1.␠Yes\n␠␠␠2.␠No\n` — no U+00A0 in the
// dialog itself, unlike the resting prompt line and the pending-tool marker
// below, both of which carry one and both of which escape it.
const PERMISSION_DIALOG_BASH_DUMP = [
  "❯ Run the bash command: touch /tmp/permprobe19/hello.txt -- nothing else, no explanation.",
  "",
  "⏺ Bash(touch /tmp/permprobe19/hello.txt)",
  "  ⎿ \u00a0Waiting…",
  "",
  "────────────────────────────────────────────────────────────────────────",
  " Bash command",
  "",
  "   touch /tmp/permprobe19/hello.txt",
  "   Create empty file hello.txt",
  "",
  " Permission rule Bash requires confirmation for this command.",
  " /permissions to update rules",
  "",
  " Do you want to proceed?",
  " ❯ 1. Yes",
  "   2. No",
  "",
  " Esc to cancel · Tab to amend · ctrl+e to explain",
].join("\n")

// The SAME dialog machinery for a Write tool call, captured the same way from
// `polltest-perm19b`. Its header is not "Do you want to proceed?" at all — it
// names the action — which is why matching that one sentence missed this whole
// class of live blocked screen (it read `unknown` before this change).
const PERMISSION_DIALOG_WRITE_DUMP = [
  "⏺ Write(hello2.txt)",
  "",
  "──────────────────────────────────────────────────",
  " Create file",
  " hello2.txt",
  "╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌",
  "  1 hi",
  "╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌",
  " Do you want to create hello2.txt?",
  " ❯ 1. Yes",
  "   2. Yes, allow all edits during this session",
  "      (shift+tab)",
  "   3. No",
  "",
  " Esc to cancel · Tab to amend",
].join("\n")

// The byte stream, not the settled screen: 428 bytes copied verbatim out of the
// pty log of that same dialog (a forked pty ran `zellij attach polltest-perm19`
// and logged every byte). This is the shape the WS tap sees, and it is NOT the
// dump's shape — the TUI moves to the next row with an absolute cursor-position
// CSI (`\x1b[29;1H`) and pads with spaces instead of emitting `\n`, and wraps
// every word in an OSC 8 hyperlink reset. After stripAnsi the header and its
// option list therefore end up on ONE line separated by 97 spaces, so a matcher
// anchored on a line break between them fires on the dump and silently misses
// every attached terminal.
const PERMISSION_DIALOG_WS_BYTES =
  "Do you want to proceed?                                                                                                \x1b[29;1H\x1b[m\x1b[m\x1b]8;;\x1b\\ \x1b[38;2;177;185;249m❯\x1b[m\x1b]8;;\x1b\\ \x1b[38;2;153;153;153m1.\x1b[m\x1b]8;;\x1b\\ \x1b[38;2;177;185;249mYes\x1b[m\x1b]8;;\x1b\\                                                                                                               \x1b[30;1H\x1b[m\x1b[m\x1b]8;;\x1b\\   \x1b[38;2;153;153;153m2.\x1b[m\x1b]8;;\x1b\\ No                         "

// ---- live workspace-trust captures (2026-07-29) -------------------------
//
// A different dialog, and a different kind of block: before a `claude` in an
// unfamiliar directory will do anything at all, it asks whether the folder is
// trusted. A session parked here makes zero progress and nothing upstream can
// tell — it read `unknown` until this row existed.
//
// Captured from `polltest-trust23` (cwd /private/tmp/trustprobe23, a directory
// with no trust record) at TWO widths on purpose, because the wrap point is what
// makes this dialog different from the permission one: the question runs into the
// prose that follows it on the same row at both widths, so a matcher anchored on
// "question line, then options" cannot ever see it.
const TRUST_DIALOG_DUMP = [
  "──────────────────────────────────────────────────",
  " Accessing workspace:",
  "",
  " /private/tmp/trustprobe23",
  "",
  " Quick safety check: Is this a project you",
  " created or one you trust? (Like your own code, a",
  " well-known open source project, or work from",
  " your team). If not, take a moment to review",
  " what's in this folder first.",
  "",
  " Claude Code'll be able to read, edit, and",
  " execute files here.",
  "",
  " Security guide",
  "",
  " ❯ 1. Yes, I trust this folder",
  "   2. No, exit",
  "",
  " Enter to confirm · Esc to cancel",
].join("\n")

// The same dialog at 120 columns. The question still does not end its line.
const TRUST_DIALOG_WIDE_DUMP = [
  " Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source",
  " project, or work from your team). If not, take a moment to review what's in this folder first.",
  "",
  " Claude Code'll be able to read, edit, and execute files here.",
  "",
  " Security guide",
  "",
  " ❯ 1. Yes, I trust this folder",
  "   2. No, exit",
  "",
  " Enter to confirm · Esc to cancel",
].join("\n")

// The WS/attached shape of that same screen, and the reason this row anchors on
// the option line rather than on the question: `stripAnsi` of the raw redraw
// capture puts the whole dialog on ONE line, and the padding runs between the
// rows were MEASURED at 7, 146, 179 and 226 characters (120-col pane), putting
// 845 characters between the question and the option label. That distance scales
// with pane width, so any bounded "question … then options" conjunct would
// false-negative on a wider terminal — hence the option line carries the row on
// its own. Space runs are written as explicit repeats so the measurement is
// visible instead of hiding in a wall of whitespace.
const TRUST_DIALOG_WS_ONE_LINE = [
  "Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source",
  " ".repeat(7),
  "project, or work from your team). If not, take a moment to review what's in this folder first.",
  " ".repeat(146),
  "Claude Code'll be able to read, edit, and execute files here.",
  " ".repeat(179),
  "Security guide",
  " ".repeat(226),
  "❯ 1. Yes, I trust this folder",
].join("")

// A screen that merely DISPLAYS this matcher table and the AGENTS.md paragraph
// about it — captured live from a zellij session (`polltest-selfref19`) that ran
// `sed -n` over those two files and then idled. Under the pre-2026-07-29 rows
// this classified `blocked`, which is how the self-referential false positive
// was found: every agent editing, diffing or documenting this file looked like
// an agent waiting on a permission decision.
const SELF_REFERENCE_DUMP = [
  "    // has binary-string evidence but no captured live-render evidence.",
  "    pattern: /Do you want to proceed\\?/,",
  "  },",
  "  {",
  '    name: "permission-prompt-reject-option",',
  '    state: "blocked",',
  "    // Verified the same way, same binary offsets: the dialog's third option",
  '    // literal, "No, and tell Claude what to do differently". Covers the case',
  "    // where the tail window caught only the bottom of a long dialog and the",
  '    // "Do you want to proceed?" header already scrolled out of the',
  "    pattern: /No, and tell Claude what to do differently/,",
  "  },",
  'ends, `"Do you want to proceed?"` (or its reject option) while blocked on a',
  'permission decision; pi\'s `"Working..."` spinner — against a per-connection',
].join("\n")

// Read out of the shipped binary, NOT rendered: `strings -a` on
// ~/.local/share/claude/versions/2.1.220 contains this option label four
// times, but neither live dialog above used it — 2.1.220 renders a bare "No".
// It stays as a bottom-of-dialog fallback for the variant that does render it,
// and the `3.` prefix is the part that makes it a rendered option line rather
// than a string anyone can print.
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
    const result = classifyTail({
      tail: `${PERMISSION_DIALOG_BASH_DUMP}\n${PROMPT_RESTING_DUMP}`,
    })
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
    expect(result.evidence).toBe("⠋ Working...")
  })

  it("classifies a live-captured Claude Code status line as working", () => {
    const result = classifyTail({ tail: CC_STATUS_LINE_DUMP })
    expect(result.state).toBe("working")
    expect(result.matcher).toBe("thinking-gerund")
    // Evidence is the gerund alone: the duration is required by a lookahead, so
    // the tooltip does not carry a token count that changes every frame.
    expect(result.evidence).toBe("Slithering…")
  })

  it("classifies the status line from raw redraw bytes, not just a settled dump", () => {
    const result = classifyTail({ tail: CC_STATUS_LINE_WS_BYTES })
    expect(result.state).toBe("working")
    expect(result.matcher).toBe("thinking-gerund")
  })

  it("classifies a live-captured pending tool call as working", () => {
    const result = classifyTail({ tail: CC_TOOL_WAITING_DUMP })
    expect(result.state).toBe("working")
    expect(result.matcher).toBe("tool-call-waiting")
  })

  it("classifies a live-captured pi spinner line as working, dump and raw alike", () => {
    expect(classifyTail({ tail: PI_WORKING_DUMP }).matcher).toBe("pi-working")
    expect(classifyTail({ tail: PI_WORKING_WS_BYTES }).matcher).toBe("pi-working")
  })

  // The same defect the blocked rows had, on the working side: a screen that
  // merely QUOTES these literals is not a working agent. Caught by measuring —
  // one live pane was reading `working` for exactly this reason.
  it("does not report working for a screen that merely quotes the literals", () => {
    expect(classifyTail({ tail: WORKING_LITERALS_QUOTED_IN_PROSE }).state).toBe("unknown")
  })

  it("does not report working for a gerund with no elapsed-time reading", () => {
    // Prose, and a placeholder in a doc: both end in "ing…" and neither is a
    // status line. The rendered one always carries "(<N>s …)".
    expect(classifyTail({ tail: "Elucidating… soon, I hope" }).state).toBe("unknown")
    expect(classifyTail({ tail: 'Claude Code\'s `"<Gerund>…(<N>s · …)"` while' }).state).toBe(
      "unknown",
    )
    // A tool's own progress line, captured live above, is not the status line:
    // its parenthetical is a key hint, not a duration.
    expect(classifyTail({ tail: "⏺ Searching for 1 pattern… (ctrl+o to expand)" }).state).toBe(
      "unknown",
    )
  })

  it("does not report working for the pending marker quoted with one pad space", () => {
    // The doc writes it `"⎿ Waiting…"`; the render pads with two characters and
    // stands alone on its line.
    expect(classifyTail({ tail: 'the `"⎿ Waiting…"` marker means a tool is running' }).state).toBe(
      "unknown",
    )
  })

  it("does not report working for the pi literal without its spinner glyph", () => {
    expect(classifyTail({ tail: 'pi\'s `"Working..."` spinner' }).state).toBe("unknown")
    expect(classifyTail({ tail: "Working on it, boss" }).state).toBe("unknown")
  })

  it("classifies a live-captured Bash permission dialog as blocked", () => {
    const result = classifyTail({ tail: PERMISSION_DIALOG_BASH_DUMP })
    expect(result.state).toBe("blocked")
    expect(result.matcher).toBe("permission-prompt")
    // Evidence is the header line only — the option list is required by a
    // lookahead, so a chip tooltip stays one readable line.
    expect(result.evidence).toBe("Do you want to proceed?")
  })

  it("classifies a live-captured Write permission dialog as blocked, header and all", () => {
    // The old row matched the single sentence "Do you want to proceed?", which
    // this real dialog never prints: it read `unknown` on a live box.
    const result = classifyTail({ tail: PERMISSION_DIALOG_WRITE_DUMP })
    expect(result.state).toBe("blocked")
    expect(result.matcher).toBe("permission-prompt")
    expect(result.evidence).toBe("Do you want to create hello2.txt?")
  })

  it("classifies the dialog from raw WS bytes, where the redraw emits no newline", () => {
    // The attached path never sees the dump's line breaks (see the fixture
    // comment): header and options arrive on one line, 97 spaces apart.
    const result = classifyTail({ tail: PERMISSION_DIALOG_WS_BYTES })
    expect(result.state).toBe("blocked")
    expect(result.matcher).toBe("permission-prompt")
  })

  // The bug this row was rewritten for: the header is a sentence any terminal
  // can print — an agent editing this table, reviewing the diff or reading
  // AGENTS.md printed it and was classified as blocked on a human.
  it("does not report blocked for a screen that merely displays the header text", () => {
    expect(classifyTail({ tail: "Do you want to proceed?" }).state).toBe("unknown")
    // This used to assert only "not blocked", because the same paragraph quotes
    // `"⎿ Waiting…"` and `"Working..."` and so still read `working`. Both rows
    // are anchored on a rendered shape now, so the honest answer is `unknown`:
    // a screen discussing the matchers matches nothing at all.
    expect(classifyTail({ tail: SELF_REFERENCE_DUMP }).state).toBe("unknown")
  })

  // Ordering, not the pattern: the real dialog above is drawn UNDER a still-live
  // "⎿  Waiting…" tool line, so the tail carries a working match too. Only
  // first-match-wins with the blocked rows on top keeps this blocked.
  it("reports blocked, not working, when the dialog sits under a live tool-call line", () => {
    expect(PERMISSION_DIALOG_BASH_DUMP).toContain("⎿ \u00a0Waiting…")
    expect(classifyTail({ tail: PERMISSION_DIALOG_BASH_DUMP }).matcher).toBe("permission-prompt")
  })

  it("classifies the workspace-trust dialog as blocked at both captured widths", () => {
    for (const dump of [TRUST_DIALOG_DUMP, TRUST_DIALOG_WIDE_DUMP]) {
      const result = classifyTail({ tail: dump })
      expect(result.state).toBe("blocked")
      expect(result.matcher).toBe("workspace-trust-prompt")
      // Evidence is the option line, because it says what answering means.
      expect(result.evidence).toBe("❯ 1. Yes, I trust this folder")
    }
  })

  it("classifies the trust dialog on the attached path, where the screen is one line", () => {
    const result = classifyTail({ tail: TRUST_DIALOG_WS_ONE_LINE })
    expect(result.state).toBe("blocked")
    expect(result.matcher).toBe("workspace-trust-prompt")
  })

  it("does not report blocked for prose that quotes the trust option", () => {
    // The rendered option starts its row; a quotation sits mid-sentence behind a
    // delimiter. Both forms below are lines this repo actually contains.
    expect(
      classifyTail({
        tail: "  dialog (`Quick safety check: … trust?` + `❯ 1. Yes, I trust this folder`)",
      }).state,
    ).toBe("unknown")
    expect(classifyTail({ tail: "answer Yes, I trust this folder to continue" }).state).toBe(
      "unknown",
    )
  })

  it("keeps the trust row above the working rows and below the permission rows", () => {
    // Ordering is priority here as everywhere. A trust dialog with a stale
    // spinner still in the window is blocked, not working…
    expect(classifyTail({ tail: `${THINKING_FIXTURE}\n${TRUST_DIALOG_DUMP}` }).matcher).toBe(
      "workspace-trust-prompt",
    )
    // …and a permission dialog is still reported as the permission dialog, not
    // mistaken for a trust prompt, when both are somehow in the tail.
    expect(
      classifyTail({ tail: `${TRUST_DIALOG_DUMP}\n${PERMISSION_DIALOG_BASH_DUMP}` }).matcher,
    ).toBe("permission-prompt")
  })

  it("classifies a numbered reject option as blocked when the header scrolled out", () => {
    // Simulates the tail catching only the bottom of a long dialog. The `3.` is
    // load-bearing: it is what a rendered option list has and a source listing
    // does not.
    const result = classifyTail({ tail: `   3. ${PERMISSION_REJECT_OPTION_LITERAL} (esc)` })
    expect(result.state).toBe("blocked")
    expect(result.matcher).toBe("permission-prompt-reject-option")
  })

  it("does not report blocked for the bare reject-option label with no option number", () => {
    expect(classifyTail({ tail: PERMISSION_REJECT_OPTION_LITERAL }).state).toBe("unknown")
    expect(classifyTail({ tail: `pattern: /${PERMISSION_REJECT_OPTION_LITERAL}/,` }).state).toBe(
      "unknown",
    )
  })

  it("returns unknown — not a guess — when nothing recognizable is in the tail", () => {
    const result = classifyTail({ tail: stripAnsi(SPLASH_FIXTURE) })
    expect(result).toEqual({ state: "unknown", matcher: undefined, evidence: undefined })
  })

  it("prefers blocked over a stale working line still inside the window", () => {
    const tail = `${THINKING_FIXTURE}\n${PERMISSION_DIALOG_BASH_DUMP}`
    expect(classifyTail({ tail }).state).toBe("blocked")
  })

  it("prefers working over a stale idle line still inside the window", () => {
    const tail = `${TURN_COMPLETE_FIXTURE} ${THINKING_FIXTURE}`
    expect(classifyTail({ tail }).state).toBe("working")
  })

  it("caps evidence length so one runaway line can't bloat the payload", () => {
    const longVerb = `A${"b".repeat(250)}ing… (3s · ↓4 tokens)`
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
