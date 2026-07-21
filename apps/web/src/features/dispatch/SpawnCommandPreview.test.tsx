import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { SpawnCommandPreview } from "./SpawnCommandPreview"

const render = (
  over: {
    harness?: "claude" | "pi"
    intent?: string
    effort?: string
    thinking?: string
    model?: string
    tools?: readonly string[]
    cwd?: string
  } = {},
): string =>
  renderToStaticMarkup(
    createElement(SpawnCommandPreview, {
      harness: over.harness ?? "claude",
      intent: over.intent ?? "go",
      effort: over.effort,
      thinking: over.thinking,
      model: over.model,
      tools: over.tools,
      cwd: over.cwd,
    }),
  )

describe("SpawnCommandPreview", () => {
  test("shows the bare claude --bg command by default", () => {
    expect(render()).toContain("claude --bg go")
  })

  test("reflects an effort level", () => {
    expect(render({ effort: "high" })).toContain("claude --bg --effort high go")
  })

  test("single-quotes an intent containing spaces", () => {
    // renderToStaticMarkup HTML-entity-encodes the literal quote characters.
    expect(render({ intent: "fix the login bug" })).toContain("&#x27;fix the login bug&#x27;")
  })

  test("reflects a model alias", () => {
    expect(render({ model: "opus" })).toContain("claude --bg --model opus go")
  })

  test("reflects an explicit tools list with the -- terminator", () => {
    expect(render({ tools: ["Bash", "Edit"] })).toContain("--tools Bash,Edit --")
  })

  test("shows the target cwd when provided", () => {
    expect(render({ cwd: "/repo/project" })).toContain("cwd: /repo/project")
  })

  test("omits the cwd line when not provided", () => {
    expect(render()).not.toContain("cwd:")
  })

  test("is collapsed by default, matching the tools/skills pickers", () => {
    const html = render()
    expect(html).toContain("<details")
    expect(html).not.toContain("open=")
  })

  describe("pi harness", () => {
    // The daemon runs pi INTERACTIVELY inside a zellij session (no `-p`) so the
    // terminal can attach; the preview mirrors that — intent as a positional.
    test("shows the bare interactive pi command (no -p)", () => {
      expect(render({ harness: "pi" })).toContain("pi go")
    })

    test("reflects thinking level, model, and pi tools", () => {
      const html = render({
        harness: "pi",
        thinking: "high",
        model: "anthropic/claude-sonnet-5",
        tools: ["read", "bash"],
      })
      expect(html).toContain(
        "pi --thinking high --model anthropic/claude-sonnet-5 --tools read,bash go",
      )
    })

    test("ignores the claude-only effort level on the pi preview", () => {
      expect(render({ harness: "pi", effort: "high" })).toContain("pi go")
    })
  })
})
