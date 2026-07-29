import { describe, expect, it } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

// Shape is a theme property, not a component property. Each family sets
// `--rounded-box` / `--rounded-btn` / `--rounded-badge` (terminal is fully
// square, sunset is soft, mono is tight), and the only way a component can
// honour that is to size its corners from those vars — which is what
// `rounded-box` / `rounded-btn` / `rounded-badge` and their corner-specific
// forms (`rounded-t-box`, `rounded-tr-btn`, …) do.
//
// A raw `rounded-lg` is therefore the same class of bug the palette ratchet
// exists for: a hardcoded decision a theme cannot reach. Worse, on an element
// that already carries a daisyUI component class (`btn`, `card`, `input`,
// `badge`, `modal-box`) it *overrides* the var the theme just set, so the
// square theme renders round anyway.
//
// Two literals stay allowed because neither is a theme decision:
//   `rounded-full`  — a circle (avatar, dot, icon button) is a circle in every
//                     family; making it square would break the geometry, not
//                     restyle it.
//   `rounded-none`  — a deliberate hard square, usually where a child must sit
//                     flush inside a rounded parent.
//
// Scope is the palette ratchet's (`features/`, `routes/`, `.ts` as well as
// `.tsx`) plus **`lib/`**, which the palette ratchet does not yet cover. That
// third root is not speculative: `lib/tabDock.tsx` holds the class strings for
// the tab dock — the most-looked-at chrome in the app, on the root dashboard,
// every project and every session — and a features-and-routes-only scan sees
// none of it. The first square-theme screenshot had a fully square page with a
// rounded pill still floating in the tab bar.
//
// The lesson generalises: a shared class-name helper is a *component* wherever
// it is filed. Scope this ratchet by what the file contains, not by which
// folder it landed in.

const SRC_DIR = join(import.meta.dir, "..", "..")
const SCAN_ROOTS = ["features", "routes", "lib"] as const

// A `rounded*` utility, wherever it appears. Split apart rather than pattern-
// matched as a whole: a single regex that tries to describe every legal form
// grows holes, and a hole in a ratchet fails open.
const RADIUS_UTIL = /\brounded(?:-[a-z0-9]+)*\b/g

// Logical-property corners included (`rounded-s-*`, `rounded-ee-*`): Tailwind
// emits them and they are just as capable of hardcoding a radius.
const CORNERS = new Set([
  "t",
  "r",
  "b",
  "l",
  "tl",
  "tr",
  "br",
  "bl",
  "s",
  "e",
  "ss",
  "se",
  "es",
  "ee",
])
const VAR_BACKED = new Set(["box", "btn", "badge"])
const NOT_A_THEME_DECISION = new Set(["full", "none"])

// `rounded` is an ordinary English word, so a comment reading "rounded corners"
// would trip a naive scan. The fix is to blank the comments and read everything
// else — NOT to read only single-line string literals, which was the first
// attempt here and failed open on 19 real sites: a `className={`…`}` template
// opened on one line and closed on another leaves the offending line with no
// quote on it at all. Blanking comments keeps those lines in scope.
//
// One alternation, strings *first*: whichever branch matches consumes the text,
// so a `//` inside a string literal (a URL) is eaten as part of the string and
// never mistaken for the start of a comment. Only the two comment branches are
// blanked, and only their non-newline characters — line numbers stay true, and a
// multi-line template literal survives intact because it was never a comment.
// Telling the branches apart needs no capture groups: a string literal always
// opens with a quote, so a match opening with `/` is necessarily one of the two
// comment forms.
const COMMENT_OR_STRING =
  /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\/[^\n]*|\/\*[\s\S]*?\*\//g

const maskComments = (source: string): string =>
  source.replace(COMMENT_OR_STRING, (match) =>
    match.startsWith("/") ? match.replace(/[^\n]/g, " ") : match,
  )

// A line carrying a genuinely-required literal radius opts out with a trailing
// `design-allow: <reason>` comment — same convention as the palette ratchet.
const ESCAPE_HATCH = /design-allow:/

const sizeOf = (util: string): string => {
  const parts = util.split("-").slice(1)
  const [head] = parts
  return (head !== undefined && CORNERS.has(head) ? parts.slice(1) : parts).join("-")
}

const isThemeable = (util: string): boolean => {
  const size = sizeOf(util)
  return VAR_BACKED.has(size) || NOT_A_THEME_DECISION.has(size)
}

const collectSources = (dir: string): string[] => {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...collectSources(full))
    } else if (
      /\.tsx?$/.test(entry) &&
      !/\.test\.tsx?$/.test(entry) &&
      entry !== "routeTree.gen.ts"
    ) {
      out.push(full)
    }
  }
  return out
}

const rel = (full: string) => full.slice(SRC_DIR.length + 1)

const offendersIn = (source: string): string[] => {
  const offenders: string[] = []
  // The escape hatch is read off the raw line — it lives in a comment, and the
  // masked copy has no comments left to read.
  const raw = source.split("\n")
  maskComments(source)
    .split("\n")
    .forEach((line, i) => {
      if (ESCAPE_HATCH.test(raw[i] ?? "")) return
      const hits = (line.match(RADIUS_UTIL) ?? []).filter((util) => !isThemeable(util))
      if (hits.length > 0) offenders.push(`  L${i + 1}: ${hits.join(", ")}`)
    })
  return offenders
}

describe("component shape comes from the theme, not from a hardcoded radius", () => {
  const files = SCAN_ROOTS.flatMap((root) => collectSources(join(SRC_DIR, root)))

  it("scans a non-trivial number of components", () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it("covers the tab dock, the chrome a features-only scan cannot see", () => {
    expect(files.map(rel)).toContain("lib/tabDock.tsx")
  })

  for (const file of files) {
    const relPath = rel(file)

    it(`${relPath} sizes its corners from the theme`, () => {
      const offenders = offendersIn(readFileSync(file, "utf8"))
      expect(
        offenders,
        `${relPath} hardcodes a radius a theme cannot reach:\n${offenders.join("\n")}`,
      ).toEqual([])
    })
  }
})

describe("the ratchet itself", () => {
  it("accepts every var-backed form, including corner-specific ones", () => {
    for (const util of [
      "rounded-box",
      "rounded-btn",
      "rounded-badge",
      "rounded-t-box",
      "rounded-tr-btn",
      "rounded-bl-badge",
      "rounded-l-box",
      "rounded-full",
      "rounded-none",
    ]) {
      expect(offendersIn(`<div className="${util}" />`), util).toEqual([])
    }
  })

  it("rejects a bare `rounded` and every raw step of the scale", () => {
    for (const util of [
      "rounded",
      "rounded-sm",
      "rounded-md",
      "rounded-lg",
      "rounded-xl",
      "rounded-2xl",
      "rounded-3xl",
      "rounded-t",
      "rounded-t-lg",
      "rounded-tr-sm",
    ]) {
      expect(offendersIn(`<div className="${util}" />`), util).not.toEqual([])
    }
  })

  it("ignores prose, so a comment about rounded corners is not a violation", () => {
    expect(offendersIn("// the card has rounded corners in every family")).toEqual([])
    expect(offendersIn("/*\n * a rounded card\n */")).toEqual([])
  })

  it("still sees a className inside a template literal opened on an earlier line", () => {
    // The regression that made the first version of this ratchet fail open on
    // 19 real sites. Reading only single-line string literals missed every one.
    const source = [
      "<div",
      "  className={`rounded-lg border ${",
      "    on ? 'a' : 'b'",
      "  }`}",
      "/>",
    ].join("\n")
    expect(offendersIn(source)).toEqual(["  L2: rounded-lg"])
  })

  it("does not let a URL blank the rest of its line", () => {
    expect(offendersIn(`<a href="https://x.dev" className="rounded-md" />`)).toEqual([
      "  L1: rounded-md",
    ])
  })

  it("honours the escape hatch", () => {
    expect(offendersIn(`<div className="rounded-sm" /> // design-allow: reason`)).toEqual([])
  })
})
