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

// Both vocabularies live in `@pid/shared`, not here, because a caller now writes
// them into a request as well as reading them off one: a screen-triggered rule in
// rules.json names a state and optionally a matcher, so `features/rules` must
// validate against the same lists this file classifies with — and a pure core
// cannot import another slice's internals. See shared/src/terminal.ts's header.
// Re-exported so every existing importer of this module is untouched.
import {
  TERMINAL_PANE_SEPARATOR,
  type TerminalMatcherName,
  type TerminalStateSlug,
} from "@pid/shared"

export type { TerminalStateSlug }

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

// `name` is the closed `TerminalMatcherName` vocabulary, not a free string: a
// rules file may target one row by name, so a row named off-vocabulary would be
// unaddressable and a rule naming a row that does not exist would silently never
// fire. The compiler catches the first direction here; the co-located test
// catches the second (a vocabulary entry with no row).
type Matcher = {
  readonly name: TerminalMatcherName
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
    // Anchored the same way, and for the same two reasons, as `turn-complete`
    // below — see the long note on that row: `^[^\S\n]*` under `m` is the single
    // spelling of "starts its row", and `{2}` rather than `{2,}` keeps the
    // padding branch from backtracking a pane-width run at every column.
    pattern: /(?:^[^\S\n]*|[^\S\n]{2})(?:❯[^\S\n]*)?1\.[^\S\n]+Yes, I trust this folder/m,
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
    // THE ANCHOR MUST ANCHOR, NOT SCAN. This row first shipped that requirement
    // as `(?:^|\n[^\S\n]*|[^\S\n]{2,})`, and both halves of that were wrong:
    //  - `[^\S\n]{2,}` MATCHES padding, greedily. A terminal pane is mostly
    //    padding, so the engine opened a candidate at nearly every column and
    //    backtracked the whole run at each one — 267ms per call on an 8 KB tail
    //    of a 400-column pane, against 0.16ms for the form below (measured
    //    2026-07-29). Since the tap classifies every open terminal every 400ms
    //    and the poller classifies every unattended session every pass, that is
    //    a busy CPU core and a dashboard that stops keeping up. `{2}` accepts
    //    exactly the same screens — "at least two spaces precede the verb" is
    //    already decided by where the engine starts the match, so consuming the
    //    rest of the run buys nothing and costs the backtracking.
    //  - `^` next to a separate `\n[^\S\n]*` branch spelled "line start" twice
    //    and differently: only the second branch tolerated an indent, so a
    //    one-space-indented completion line matched mid-tail and NOT at the
    //    tail's start. What gets classified is a truncated window, so that made
    //    the answer depend on where the truncation fell. Under `m`, `^[^\S\n]*`
    //    is the one spelling and covers both.
    // `classifyTail cost` in the co-located test pins the budget.
    //
    // The glyph is captured but OPTIONAL: it was U+273B in all 70 captured frames
    // and in an earlier pty capture, yet the spinner glyphs on the working status
    // line rotate through at least four code points, so requiring this one would
    // be betting on a pattern the neighbouring row already disproved. The glyph
    // clause also tolerates ZERO spaces after the glyph, because a pty capture in
    // the fixtures jumps the cursor between glyph and verb instead of printing
    // one.
    pattern: /(?:^[^\S\n]*|[^\S\n]{2})(?:✻[^\S\n]*)?\p{Lu}[\p{Ll}'-]*ed for \d+s(?=[^\S\n]|$)/mu,
  },
  {
    name: "pi-prompt-resting",
    state: "idle",
    // pi's equivalent of the row below, and it needs its own because pi draws NO
    // prompt glyph: `❯` appears nowhere in its shipped `dist/`, and its editor is
    // two full-width U+2500 rules with an EMPTY row between them. So the row below
    // could never fire on pi, and a resting pi pane classified `unknown` with no
    // screen evidence at all.
    //
    // That gap costs more for pi than the same gap did for claude. pi writes no
    // `state.json`, so the daemon reads state off the shape of pi's transcript, and
    // there `done` plus a live pid has two causes — resting at the prompt, or
    // mid-tool-call, because the assistant's tool-use message stays the last entry
    // until the result returns. Only the screen separates those, so this row is the
    // only thing that ever corroborates a pi `done`.
    //
    // ANCHORED ON THE CONTEXT READING, which is the one part of pi's footer that is
    // always drawn. Verified live at rest (dump + raw redraw bytes) and read out of
    // the shipped source, which is what picked it: every stats field is conditional
    // on a non-zero counter — `if (totalInput)`, `if (totalOutput)`,
    // `if (totalCacheRead)`, `if (totalCacheWrite)`, cost, cache-hit rate, all in
    // pi-coding-agent/dist/modes/interactive/components/footer.js:114-127 — while
    // `statsParts.push(contextPercentStr)` at footer.js:147 has no condition. A pi
    // that has answered nothing yet therefore shows NONE of the arrows, and that is
    // exactly the pane the daemon most needs to read: a freshly dispatched pi
    // sitting at its prompt. A row anchored on the arrows would have passed a
    // capture and missed the case that matters.
    //
    // Both rendered forms are covered: `<pct>%/<window>` and the `?/<window>` pi
    // draws before it knows the percentage. The window always carries a `k`/`M`
    // suffix because `formatTokens` (footer.js:19-29) only omits it below 1000
    // tokens, and no model's context window is that small — requiring the suffix is
    // what keeps this off an ordinary percentage that happens to precede a slash.
    //
    // MUST STAY BELOW `pi-working`, for the same reason the row below sits last:
    // the footer is on screen throughout a turn, so a mid-tool-call pi carries it
    // too. A live capture of that exact frame — spinner and footer together — is in
    // the co-located test, asserting the order rather than the pattern. This row
    // reads as "a pi TUI is up and nothing above matched".
    //
    // KNOWN COST, captured rather than inferred: pi draws this footer UNDERNEATH
    // its modal overlays, where claude's prompt box disappears behind its dialogs.
    // So a pi parked on a selector that is waiting for a keypress — `/trust` was
    // captured live doing exactly this — now reads `idle` where it used to read
    // `unknown`. Two reasons that is still the better trade: a pi at rest is the
    // common case and had NO evidence at all before, while the modal case needs a
    // human to have opened a modal and walked away; and `unknown` was not honest
    // either, it was just vague. The real fix is a `blocked` row for pi's modals,
    // above this one, and it is deliberately NOT bolted on here: the three
    // components that share the `↑↓ navigate` hint (trust-selector,
    // extension-selector, first-time-setup) are three of 56 selector components in
    // pi's `dist/`, so a row anchored on that hint would swap one wrong answer for
    // an unknown number of them. It wants its own change and its own captures.
    pattern: /(?:^|[^\S\n])(?:\d+(?:\.\d+)?%|\?)\/\d+(?:\.\d+)?[kM](?=[^\S\n]|$)/m,
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
    // CLAUDE ONLY, by construction: this is claude's prompt glyph. pi draws no
    // glyph at all, so its rest is the row above; the two are disjoint and both
    // are last-resort.
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

// The priority order the table is evaluated in, exposed so the invariants the
// rows document in prose ("MUST STAY LAST", the blocked rows above
// `tool-call-waiting`) can be asserted directly, and so the co-located test can
// check the table against the shared name vocabulary in both directions.
export const TERMINAL_MATCHER_ORDER: ReadonlyArray<TerminalMatcherName> = MATCHERS.map(
  (m) => m.name,
)

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

// The freshness half of a stored reading — see TerminalStateRecord in
// terminal.routes.ts for why a record carries two timestamps and not one.
export type ScreenReadStamped = { readonly screenReadAt: string }

// Stamp "the screen was read again just now" onto a record whose CLASSIFICATION
// did not change, leaving every other field — the state, the matcher, the
// evidence, and `stateChangedAt` — exactly as it was.
//
// Two rules, both load-bearing:
//   - Nothing else moves. A re-read that found the same thing is new evidence
//     about freshness only; rewriting `stateChangedAt` here would erase how long
//     the pane has been sitting in this state, which is the other half of what a
//     reader needs.
//   - An absent record stays absent (`undefined` in, `undefined` out). "Nothing
//     has classified this terminal" is a real answer that `readTerminalState`,
//     `explain` and `pid terminals` all rely on, so a read that found no
//     classification must not invent a row with no state in it.
export const freshenScreenRead = <T extends ScreenReadStamped>(input: {
  readonly record: T | undefined
  readonly readAt: string
}): T | undefined =>
  input.record === undefined ? undefined : { ...input.record, screenReadAt: input.readAt }

// Registry key for GET /terminal/states and the terminal.state SSE payload —
// centralised so the route and any consumer agree on the same shape.
export const terminalStateKey = (input: { readonly scope: string; readonly id: string }): string =>
  `${input.scope}:${input.id}`

// A zellij session can hold more than one terminal pane, and an agent running
// in the second one is a terminal in its own right. Rather than invent a second
// key format, a second map or a second SSE event type for panes, a pane row IS
// a terminal row whose `id` carries the zellij pane id: the session-level row
// stays exactly `<scope>:<id>` (which is what every wait, rule, chip and
// `pid terminals` call built so far addresses), and the pane rows sit beside it
// under `<scope>:<id>#<paneId>`.
//
// `#` rather than a second `:`: `:` already separates scope from id, so
// `session:ab12:terminal_1` would be ambiguous with an id that contains a
// colon. Nothing ever parses a pane key back apart — the only use is prefix
// matching to find one terminal's pane rows — so an id that itself contained a
// `#` could at worst over-match its own rows, never another terminal's.
//
// The separator itself lives in `@pid/shared` (with `isTerminalPaneRowId`)
// because it turned out to be a wire fact, not a private key format: both row
// kinds ride the same `terminal.state` event, and a consumer that ADDRESSES
// sessions — `features/rules` — has to tell a pane row's `id` from a session
// short before acting on it.

export const terminalPaneRowId = (input: {
  readonly id: string
  readonly paneId: string
}): string => `${input.id}${TERMINAL_PANE_SEPARATOR}${input.paneId}`

// Every pane row of one terminal starts with this, and its session-level row
// does not — deliberately, because that row has a second producer (the WS
// classifier tap) and dropping it would blank a live chip.
export const terminalPaneKeyPrefix = (input: {
  readonly scope: string
  readonly id: string
}): string => `${terminalStateKey(input)}${TERMINAL_PANE_SEPARATOR}`
