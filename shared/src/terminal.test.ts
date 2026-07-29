import { describe, expect, it } from "bun:test"
import { SESSION_STATE_SLUGS } from "./session"
import {
  isTerminalMatcherName,
  isTerminalPaneRowId,
  isTerminalStateSlug,
  TERMINAL_MATCHER_NAMES,
  TERMINAL_PANE_SEPARATOR,
  TERMINAL_STATE_SLUGS,
} from "./terminal"

describe("isTerminalStateSlug", () => {
  it("accepts every slug in the vocabulary", () => {
    for (const slug of TERMINAL_STATE_SLUGS) expect(isTerminalStateSlug(slug)).toBe(true)
  })

  // The screen cannot tell these apart — done, failed and stopped all sit at a
  // resting prompt — so it must not be able to claim them.
  it("rejects the supervisor-only slugs a screen can never observe", () => {
    expect(isTerminalStateSlug("done")).toBe(false)
    expect(isTerminalStateSlug("failed")).toBe(false)
    expect(isTerminalStateSlug("stopped")).toBe(false)
    expect(isTerminalStateSlug("needs_input")).toBe(false)
  })

  it("rejects non-strings without throwing", () => {
    expect(isTerminalStateSlug(undefined)).toBe(false)
    expect(isTerminalStateSlug(0)).toBe(false)
    expect(isTerminalStateSlug({ state: "idle" })).toBe(false)
  })
})

describe("TERMINAL_STATE_SLUGS", () => {
  it("has no duplicates", () => {
    expect(new Set(TERMINAL_STATE_SLUGS).size).toBe(TERMINAL_STATE_SLUGS.length)
  })

  // Not decoration: `GET /sessions/:id/explain` compares one vocabulary against
  // the other to decide whether the screen contradicts the supervisor, and a
  // screen slug with no session counterpart could never be compared at all.
  it("is a strict subset of the session-state vocabulary", () => {
    const sessionSlugs = new Set<string>(SESSION_STATE_SLUGS)
    for (const slug of TERMINAL_STATE_SLUGS) expect(sessionSlugs.has(slug)).toBe(true)
    expect(TERMINAL_STATE_SLUGS.length).toBeLessThan(SESSION_STATE_SLUGS.length)
  })
})

describe("isTerminalMatcherName", () => {
  it("accepts every name in the vocabulary", () => {
    for (const name of TERMINAL_MATCHER_NAMES) expect(isTerminalMatcherName(name)).toBe(true)
  })

  it("rejects a name that is not in the vocabulary", () => {
    expect(isTerminalMatcherName("permission_prompt")).toBe(false)
    expect(isTerminalMatcherName("")).toBe(false)
  })

  it("rejects non-strings without throwing", () => {
    expect(isTerminalMatcherName(undefined)).toBe(false)
    expect(isTerminalMatcherName(["permission-prompt"])).toBe(false)
  })
})

describe("isTerminalPaneRowId", () => {
  it("recognizes a pane row's id", () => {
    expect(isTerminalPaneRowId(`ab12${TERMINAL_PANE_SEPARATOR}terminal_1`)).toBe(true)
  })

  // The distinction a consumer that addresses sessions depends on: a session-level
  // id is a short a `keys` or `stop` can reach, a pane row's is not.
  it("leaves a session-level id alone", () => {
    expect(isTerminalPaneRowId("ab12")).toBe(false)
    expect(isTerminalPaneRowId("global")).toBe(false)
  })
})

describe("TERMINAL_MATCHER_NAMES", () => {
  it("has no duplicates", () => {
    expect(new Set(TERMINAL_MATCHER_NAMES).size).toBe(TERMINAL_MATCHER_NAMES.length)
  })

  // The two dialogs a rule most plausibly wants to tell apart. If a rename ever
  // lands, this fails and whoever renamed also updates the rules files and the
  // worked example in AGENTS.md, rather than discovering the drift at 3am.
  it("keeps the two blocked-on-a-human dialogs individually addressable", () => {
    expect(isTerminalMatcherName("permission-prompt")).toBe(true)
    expect(isTerminalMatcherName("workspace-trust-prompt")).toBe(true)
  })
})
