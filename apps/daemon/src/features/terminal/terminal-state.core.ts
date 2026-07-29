// Pure classification of "what is this agent doing right now" from the raw
// bytes flowing through a terminal WS bridge (see terminal.routes.ts for the
// tap). herdr's core idea transplanted here: read the screen, don't require
// an integration — a `claude` the user started themselves in a plain zellij
// pane is just as classifiable as one the daemon spawned.
//
// Every VERIFIED row in MATCHERS below rests on one of three evidence sources,
// named in the row's own comment:
//   - a captured pty run: a throwaway driver forked a real pty, ran an
//     actual `claude` (2.1.220) or `pi` (0.80.3) CLI inside it, and logged
//     the raw bytes while it answered a prompt / invoked a tool.
//   - a live screen dump: `zellij action dump-screen --pane-id terminal_0`
//     against a real session, which is the exact text the unattended poller
//     folds through this module (`terminal-poll.io.ts`).
//   - the shipped CLI's own source: Claude Code ships as a single compiled
//     binary (`strings -a` on `~/.local/share/claude/versions/2.1.220`,
//     a Mach-O executable) with its UI copy embedded as literal strings;
//     `pi` ships unminified JS (`@earendil-works/pi-coding-agent`'s `dist/`),
//     so the literal is readable straight from source, file:line included.
// A row with neither is marked unverified in its own comment. The two shapes
// are not interchangeable: a binary literal proves the string EXISTS, only a
// render proves it reaches a screen, and only a render shows what surrounds it.
// The permission rows were rewritten on 2026-07-29 for exactly that reason.

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
    // Verified by LIVE RENDER, 2026-07-29, and that is what this pattern's
    // shape is for. Two real dialogs were captured with `zellij action
    // dump-screen --pane-id terminal_0` against sessions created for the
    // purpose, plus the raw pty byte stream of the first one:
    //
    //    Do you want to proceed?          |   Do you want to create hello2.txt?
    //    ❯ 1. Yes                         |   ❯ 1. Yes
    //      2. No                          |     2. Yes, allow all edits during …
    //                                     |     3. No
    //
    // Getting them on screen took `--permission-mode manual` plus an explicit
    // `--settings '{"permissions":{"ask":["Bash"]}}'`; without the `ask` rule
    // the box's broad user-level allow-list auto-approves the call and no
    // dialog is ever drawn, which is why the first version of this row had
    // only `strings -a` evidence from the shipped 2.1.220 binary.
    //
    // Both captures corrected a claim the binary strings could not:
    //  - The header is NOT one fixed sentence. A Write approval says "Do you
    //    want to create hello2.txt?" and never prints "proceed", so matching
    //    that sentence read a genuinely blocked live screen as `unknown`.
    //    Hence `Do you want to …?` as a shape.
    //  - A header alone is a sentence ANY terminal can print. Matching it
    //    self-referentially classified every agent that edited this table,
    //    reviewed the diff or displayed AGENTS.md as blocked on a human
    //    (caught live 2026-07-29 on a session that only ran `sed` over these
    //    two files). So the header only counts when the dialog's own option
    //    list follows it: `1.` is always the first item, whichever option the
    //    `❯` cursor sits on.
    //
    // The gap between header and option list is whitespace-only but NOT
    // reliably a newline: the dump has `\n`, while the attached WS path gets
    // zellij's redraw, which jumps rows with an absolute cursor CSI
    // (`\x1b[29;1H`) and pads with spaces, so after stripAnsi both live on one
    // line 97 spaces apart (measured, 120-col pane). `\s{0,500}?` covers a
    // newline and up to ~two rows of padding on a wide pane; a rendered dialog
    // has nothing but padding in there.
    //
    // Evidence stays the header line: the option list is required through a
    // lookahead, so `found[0]` is one readable line for a chip tooltip.
    //
    // Known gap, live-captured rather than assumed: a pane narrow enough to wrap
    // the question itself would break this row's adjacency requirement. The
    // workspace-trust dialog wraps its question at EVERY width and so could never
    // match here — it gets its own row below rather than a widened pattern here.
    pattern: /(?:^|[^\S\n])(?:Do you want to [^\n]*?\?)(?=\s{0,500}?(?:❯[^\S\n]*)?1\.[^\S\n]+\S)/m,
  },
  {
    name: "permission-prompt-reject-option",
    state: "blocked",
    // Binary-string evidence only, and now said plainly: `strings -a` on the
    // shipped 2.1.220 binary carries the option label "No, and tell Claude
    // what to do differently" four times, but NEITHER live dialog captured
    // above rendered it — 2.1.220 drew a bare "No" in both. Kept as the
    // bottom-of-dialog fallback for the variant that does render it (the tail
    // is 8k chars against a ~2.7k screen, so in practice the header is still
    // in the window), and unlike before it cannot fire on a screen that is
    // merely *printing* the label: a rendered option carries its list number,
    // a source listing or a doc paragraph does not.
    pattern: /(?:^|[^\S\n])\d+\.[^\S\n]+No, and tell Claude what to do differently/m,
  },
  {
    name: "workspace-trust-prompt",
    state: "blocked",
    // Verified by LIVE RENDER at two widths, 2026-07-29. Before a `claude` in a
    // directory with no trust record will run anything, it asks whether the folder
    // is trusted, and waits. That is as blocked on a human as a permission dialog
    // is — a session parked here makes zero progress and, until this row existed,
    // reported `unknown`, so nothing upstream could tell.
    //
    // Captured from a session created for it, in a directory with no trust record,
    // at 50 and 120 columns plus the raw redraw bytes. Anchored on the first
    // OPTION line (`<N>. Yes, I trust this folder`), not on the question, and the
    // width is why:
    //  - The question never ends its row. At both captured widths the prose that
    //    follows it continues on the same line, so the "question line, then the
    //    option list" shape the permission row uses cannot see this dialog at all.
    //    That is what made it a documented gap rather than a quick copy of that
    //    row.
    //  - The distance from question to option list was MEASURED at 845 characters
    //    on the attached path (padding runs of 7, 146, 179 and 226 between the
    //    rows, 120-col pane), and it scales with pane width — so any bounded
    //    "question … then option" conjunct would false-negative on a wider
    //    terminal. Better one anchor that holds at every width than two that
    //    silently stop holding at 160 columns.
    //
    // The list number and the row boundary are what keep this from firing on a
    // screen that merely mentions the label: a rendered option starts its row
    // (line start, or a run of padding on the collapsed attached path), while a
    // quotation sits mid-sentence behind a delimiter. Residual, and inherent: a
    // doc that pastes the rendered option list verbatim as a numbered list is
    // indistinguishable from the dialog. Hence the house rule — placeholders in
    // prose, renders only in fixtures.
    pattern: /(?:^|\n[^\S\n]*|[^\S\n]{2,})(?:❯[^\S\n]*)?1\.[^\S\n]+Yes, I trust this folder/,
  },
  // The three rows below are `working`, and they were anchored on 2026-07-29 for
  // the same reason the two above were: a bare literal is a string any terminal
  // can print, including one that is only DISCUSSING this table. Measuring the
  // blocked fix caught a live pane reading `working` because the screen was
  // showing the AGENTS.md paragraph that quotes these very literals. So each row
  // now requires the shape a render has and a quotation does not, verified
  // against fresh dumps and raw redraw bytes of real `claude` 2.1.220 and `pi`
  // 0.80.3 turns.
  //
  // House rule that follows from it: describe these lines with placeholders in
  // comments and docs, never paste a complete rendered line. A pasted render is
  // indistinguishable from a render — the fixtures in the test file are verbatim
  // captures on purpose, and that file is the one place where that is correct.
  {
    name: "tool-call-waiting",
    state: "working",
    // Verified live (dump + raw redraw bytes): the pending marker a dispatched
    // tool leaves on screen until it returns. Anchored three ways, each measured
    // rather than guessed:
    //  - the marker is preceded by line start or whitespace, and the word is
    //    followed by whitespace or line end — i.e. it OWNS its line. A quotation
    //    has a delimiter on at least one side.
    //  - the pad between marker and word is TWO characters in every capture, and
    //    they are not two spaces: hexdump gives `20 20 23bf 20 a0 57 …`, an
    //    ordinary space then U+00A0. `[^\S\n]` covers both (JS `\s` includes
    //    NBSP); requiring two also excludes the one-space form docs use.
    //  - `[^\S\n]` never crosses a line, so this cannot span a redraw row.
    // Note this marker also sits on screen while a permission dialog holds the
    // tool up, so a blocked screen carries it too — the blocked rows are ordered
    // above this one for that reason, and a test pins that ordering.
    pattern: /(?:^|[^\S\n])⎿[^\S\n]{2,}Waiting…(?=[^\S\n]|$)/m,
  },
  {
    name: "thinking-gerund",
    state: "working",
    // Verified live: Claude Code's status line is a rotating spinner glyph, an
    // invented gerund, and a live reading in parentheses — `<Gerund>…(<N>s · ↓<N>
    // tokens)`, sometimes with `· thinking`. The verb is randomized and
    // effectively unbounded, so the row matches the shape, not a word list.
    //
    // The anchor is the ELAPSED TIME, not the glyph: the glyph rotates through at
    // least U+00B7, U+2722, U+273B and U+2726 (all four captured in one turn), so
    // pinning it would be pinning noise. Every captured status line carried the
    // duration — 7 of 7 across two sessions, dumps and raw bytes — and a gerund
    // WITHOUT one is either prose or a tool's own progress line (captured live:
    // `⏺ Searching for 1 pattern… (ctrl+o to expand)`, whose parenthetical is a
    // key hint, not a clock). `\d+[hm]` covers the `<N>m <N>s` form a long turn
    // reaches.
    //
    // The duration is required through a lookahead so the evidence stays the
    // gerund: a tooltip that changes every frame is noise in an SSE payload.
    //
    // The verb class is `\p{Lu}[\p{Ll}'-]*`, not `[A-Z][a-z]+`, because the
    // shipped vocabulary is not plain ASCII — see the turn-complete row below,
    // where a live capture of an accented verb is what turned that up. The two
    // rows share the vocabulary, so they share the class.
    pattern: /\b\p{Lu}[\p{Ll}'-]*ing…(?=[^\S\n]*\((?:\d+[hm][^\S\n]+)*\d+s\b)/u,
  },
  {
    name: "pi-working",
    state: "working",
    // Verified live (dump + raw redraw bytes) on a real `pi` 0.80.3 turn: a
    // braille spinner glyph immediately before the literal, cycling roughly every
    // 100ms. Ten distinct glyphs were captured in one turn, all inside the braille
    // block U+2800–U+28FF, always one ordinary space from the word, so the glyph
    // class — not one frame of it — is the anchor. Without it the row fired on any
    // screen printing the word, this file's own docs included.
    //
    // The literal itself is `defaultWorkingMessage` in
    // pi-coding-agent/dist/modes/interactive/interactive-mode.js:161 (pi ships
    // unminified, so source and render agree). The same file sometimes appends an
    // interrupt hint (interactive-mode.js:1472, keybinding `app.interrupt` →
    // "escape", core/keybindings.js:7) — in source, never observed in a capture,
    // and it does not matter here: the hint follows the literal, so this row
    // covers both forms.
    pattern: /[⠀-⣿][^\S\n]*Working\.\.\./,
  },
  {
    name: "turn-complete",
    state: "idle",
    // Printed once a turn finishes and control returns to the prompt —
    // `<PastVerb> for <N>s` behind a glyph, the same randomized-verb shape as
    // thinking-gerund in past tense. Verified live (dump + raw redraw bytes) on a
    // fresh capture, which is where two things turned up:
    //
    //  - THE VERB IS NOT ASCII-ONLY. The captured line read `Sautéed for 3s`, and
    //    `[A-Z][a-z]+` matches no such word, so a real completion line did not
    //    match this row at all. `strings -a` on the 2.1.220 binary confirms the
    //    vocabulary carries `Saut\xE9ed`/`Saut\xE9ing`, and of the 185 capitalised
    //    verbs visible in that region five more are hyphenated
    //    (`Dilly-dallying`, `Fiddle-faddling`, `Razzle-dazzling`, `Sock-hopping`,
    //    `Topsy-turvying`) — six known misses. Hence `\p{Lu}[\p{Ll}'-]*` and the
    //    `u` flag, here and in thinking-gerund.
    //    The screen still read `idle` while this was broken, but through
    //    `prompt-resting` — the row of last resort — so the state was right by
    //    luck and would have gone `unknown` the moment the human typed anything
    //    into the prompt box.
    //  - IT HAS TO OWN ITS ROW. `wait --via screen` can resolve a real wait on
    //    `idle`, so a screen merely PRINTING a completion line could unblock an
    //    agent early. A rendered line starts its row (line start on a dump, a run
    //    of padding on the collapsed attached path) and ends it; a quotation sits
    //    mid-sentence behind a delimiter, or one space after a word.
    //
    // The glyph is captured but OPTIONAL: it was U+273B in all 70 captured frames
    // and in an earlier pty capture, yet the spinner glyphs on the working status
    // line rotate through at least four code points, so requiring this one would
    // be betting on a pattern the neighbouring row already disproved. The glyph
    // clause also tolerates ZERO spaces after the glyph, because a pty capture in
    // the fixtures jumps the cursor between glyph and verb instead of printing
    // one.
    pattern:
      /(?:^|\n[^\S\n]*|[^\S\n]{2,})(?:✻[^\S\n]*)?\p{Lu}[\p{Ll}'-]*ed for \d+s(?=[^\S\n]|$)/mu,
  },
  {
    name: "prompt-resting",
    state: "idle",
    // Verified by HEXDUMP, not by eye: the empty input line in a real
    // `zellij action dump-screen` is `e2 9d af c2 a0 0a` — `❯` (U+276F) followed
    // by a NO-BREAK SPACE (U+00A0), not an ordinary space. The first version of
    // this row matched `[ \t]*`, passed a hand-typed fixture, and then fired on
    // exactly 1 of 27 live screens. `[^\S\n]*` covers every horizontal
    // whitespace character including U+00A0 while still refusing to run past the
    // line end.
    //
    // This is what a finished session looks like once its "…ed for Ns" line has
    // scrolled out of the viewport, which on a long-lived box is most of them.
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
    pattern: /^❯[^\S\n]*$/m,
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
