import { describe, expect, it } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ThemeLabPanel } from "./ThemeLabPanel"
import { IDLE_STATES, REPORTING_STATES } from "./themeLab"

const html = renderToStaticMarkup(
  createElement(ThemeLabPanel, { theme: "candylight", family: "candy" }),
)

describe("ThemeLabPanel", () => {
  it("scopes itself with data-theme, which is what puts eighteen themes on one page", () => {
    // daisyUI emits each theme as a `[data-theme=…]` rule, so a nested div is a
    // whole theme. Without this the lab would need a picker and a reload per
    // family, which is the review it replaces.
    expect(html).toContain('data-theme="candylight"')
    expect(html).toContain('data-testid="theme-lab-panel-candylight"')
  })

  it("paints the shell gradient the app actually uses, not a flat surface", () => {
    // routes/__root.tsx paints `from-base-100 to-base-200`; a lab panel on a flat
    // base-100 would hide exactly the two-stop wash `prism` and `neon` are built
    // around.
    expect(html).toContain("from-base-100")
    expect(html).toContain("to-base-200")
  })

  it("shows the state chips in two columns, idle and reporting", () => {
    expect(html).toContain("idle — what a quiet page shows")
    expect(html).toContain("reporting — only when a session says so")
    // Every state, both columns, with its real label from `stateColor`.
    for (const label of ["Idle", "Stopped", "Unknown", "Working", "Done", "Failed", "Blocked"]) {
      expect(html, `${label} chip is missing`).toContain(label)
    }
    expect(IDLE_STATES.length + REPORTING_STATES.length).toBe(8)
  })

  it("renders the state tones through stateColor rather than re-deriving them", () => {
    // The `/15` opacity convention the whole app uses for tinted chips. If this
    // panel invented its own tones, the lab would be reviewing the lab.
    expect(html).toContain("bg-success/15")
    expect(html).toContain("text-warning")
    expect(html).toContain("bg-info/15")
  })

  it("renders every daisyUI component this app uses", () => {
    for (const cls of [
      "btn btn-primary",
      "badge",
      "input input-bordered",
      "select select-bordered",
      "card-body",
      "modal-box",
      "menu",
      "tab tab-active",
      "alert alert-info",
      "alert alert-error",
    ]) {
      expect(html, `${cls} is missing from the lab`).toContain(cls)
    }
  })

  it("renders all three radius roles, so a shape tuple is reviewable", () => {
    for (const cls of ["rounded-box", "rounded-btn", "rounded-badge"]) {
      expect(html, `${cls} is missing`).toContain(cls)
    }
  })

  it("puts primary-content on primary, the one pair with a gate on it", () => {
    expect(html).toContain("text-primary-content")
  })
})
