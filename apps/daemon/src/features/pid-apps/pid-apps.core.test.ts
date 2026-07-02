import { describe, expect, it } from "bun:test"
import { NAME_RE } from "../../platform/extensions/manifest"
import {
  applyPidAppManifest,
  appRootFor,
  buildStarterHtml,
  DEFAULT_APP_ID,
  DEFAULT_ENTRY,
  discoverPidApps,
  discoverSpecApps,
  isCreatableAppName,
  isReservedDefaultAsset,
  isValidAppId,
  mergeAppSources,
  PID_APP_CSP,
  type PidApp,
  type PidAppDirEntry,
  parsePidAppManifest,
  RESERVED_PID_ENTRIES,
} from "./pid-apps.core"

const dir = (name: string, hasIndexHtml = true): PidAppDirEntry => ({
  name,
  isDir: true,
  hasIndexHtml,
})
const file = (name: string): PidAppDirEntry => ({ name, isDir: false, hasIndexHtml: false })

describe("discoverPidApps", () => {
  it("treats a bare .pid/index.html as the implicit 'default' app", () => {
    expect(discoverPidApps([], true)).toEqual([
      { id: "default", label: "default", entry: "index.html", root: "", source: "pid" },
    ])
  })

  it("returns no apps with neither a root index nor any app dir", () => {
    expect(discoverPidApps([], false)).toEqual([])
    expect(discoverPidApps([dir("notes", false), file("readme.md")], false)).toEqual([])
  })

  it("treats each subdir containing an index.html as an app keyed by dir name", () => {
    expect(discoverPidApps([dir("spec"), dir("dashboard")], false)).toEqual([
      {
        id: "dashboard",
        label: "dashboard",
        entry: "index.html",
        root: "dashboard",
        source: "pid",
      },
      { id: "spec", label: "spec", entry: "index.html", root: "spec", source: "pid" },
    ])
  })

  it("omits subdirs without an index.html and non-dir entries", () => {
    expect(discoverPidApps([dir("empty", false), file("index.html")], false)).toEqual([])
  })

  it("never surfaces reserved pid internals as apps", () => {
    const entries = [
      dir("extensions"),
      file("extensions-state.json"),
      file("settings.json"),
      dir("settings.json"),
    ]
    expect(discoverPidApps(entries, false)).toEqual([])
  })

  it("skips dir names that fail NAME_RE without throwing", () => {
    const entries = [dir("Bad Name"), dir("../x"), dir("UPPER"), dir("ok-1.2")]
    expect(discoverPidApps(entries, false)).toEqual([
      { id: "ok-1.2", label: "ok-1.2", entry: "index.html", root: "ok-1.2", source: "pid" },
    ])
  })

  it("orders deterministically: default first, then subdir apps alphabetical", () => {
    const out = discoverPidApps([dir("zeta"), dir("alpha")], true)
    expect(out.map((a) => a.id)).toEqual(["default", "alpha", "zeta"])
  })

  it("lets the bare-root default win over a subdir literally named 'default'", () => {
    expect(discoverPidApps([dir("default")], true)).toEqual([
      { id: "default", label: "default", entry: "index.html", root: "", source: "pid" },
    ])
  })

  it("ignores a subdir named 'default' when there is no bare-root index", () => {
    expect(discoverPidApps([dir("default")], false)).toEqual([])
  })
})

describe("RESERVED_PID_ENTRIES", () => {
  it("reserves the pid internals and the 'default' dir name", () => {
    expect(RESERVED_PID_ENTRIES.has("extensions")).toBe(true)
    expect(RESERVED_PID_ENTRIES.has("extensions-state.json")).toBe(true)
    expect(RESERVED_PID_ENTRIES.has("settings.json")).toBe(true)
    expect(RESERVED_PID_ENTRIES.has("default")).toBe(true)
    expect(RESERVED_PID_ENTRIES.has("spec")).toBe(false)
  })
})

describe("parsePidAppManifest", () => {
  it("returns {} for null, undefined, empty, malformed, or non-object JSON", () => {
    for (const bad of [null, undefined, "", "   ", "{not json", "[1,2,3]", '"a string"', "42"]) {
      expect(parsePidAppManifest(bad)).toEqual({})
    }
  })

  it("keeps a valid title and icon, drops blank or wrong-typed ones", () => {
    expect(parsePidAppManifest('{"title":"Spec v3","icon":"📄"}')).toEqual({
      title: "Spec v3",
      icon: "📄",
    })
    expect(parsePidAppManifest('{"title":"  ","icon":5}')).toEqual({})
  })

  it("accepts an entry that is a single *.html/*.htm segment", () => {
    expect(parsePidAppManifest('{"entry":"main.html"}')).toEqual({ entry: "main.html" })
    expect(parsePidAppManifest('{"entry":"page.htm"}')).toEqual({ entry: "page.htm" })
  })

  it("drops an entry that traverses, nests, is non-html, or empty", () => {
    for (const e of ["../x.html", "a/b.html", "evil.svg", "index.js", "", "no-ext"]) {
      expect(parsePidAppManifest(JSON.stringify({ entry: e }))).toEqual({})
    }
  })
})

describe("applyPidAppManifest", () => {
  const base: PidApp = {
    id: "spec",
    label: "spec",
    entry: "index.html",
    root: "spec",
    source: "pid",
  }

  it("overrides label/entry/icon from the manifest", () => {
    expect(applyPidAppManifest(base, { title: "My Spec", entry: "main.html", icon: "📄" })).toEqual(
      {
        id: "spec",
        label: "My Spec",
        entry: "main.html",
        root: "spec",
        source: "pid",
        icon: "📄",
      },
    )
  })

  it("falls back to the app's own values when the manifest is empty", () => {
    expect(applyPidAppManifest(base, {})).toEqual(base)
  })
})

describe("PID_APP_CSP", () => {
  it("locks the untrusted-HTML policy: no default source, no network", () => {
    expect(PID_APP_CSP).toContain("default-src 'none'")
    expect(PID_APP_CSP).toContain("connect-src 'none'")
  })

  it("matches the exact agreed value", () => {
    expect(PID_APP_CSP).toBe(
      "default-src 'none'; img-src data: 'self'; style-src 'unsafe-inline' 'self'; " +
        "script-src 'unsafe-inline' 'self'; font-src data: 'self'; connect-src 'none'",
    )
  })
})

describe("constants", () => {
  it("exposes the default app id and entry", () => {
    expect(DEFAULT_APP_ID).toBe("default")
    expect(DEFAULT_ENTRY).toBe("index.html")
  })
})

describe("NAME_RE reuse", () => {
  it("is the shared extension name regex (imported, not redefined)", () => {
    expect(NAME_RE.test("ok-1.2")).toBe(true)
    expect(NAME_RE.test("Bad")).toBe(false)
  })
})

describe("appRootFor", () => {
  it("maps the default app to the .pid root and others to their own subdir", () => {
    expect(appRootFor("default")).toBe("")
    expect(appRootFor("spec")).toBe("spec")
  })
})

describe("isValidAppId", () => {
  it("accepts the literal default app and valid non-reserved ids", () => {
    expect(isValidAppId("default")).toBe(true)
    expect(isValidAppId("spec")).toBe(true)
    expect(isValidAppId("my-plan.v2")).toBe(true)
  })

  it("rejects reserved names so the serve route can't leak pid internals", () => {
    expect(isValidAppId("extensions")).toBe(false)
    expect(isValidAppId("settings.json")).toBe(false)
    expect(isValidAppId("extensions-state.json")).toBe(false)
  })

  it("rejects NAME_RE-invalid ids (uppercase, spaces, traversal)", () => {
    expect(isValidAppId("UPPER")).toBe(false)
    expect(isValidAppId("bad name")).toBe(false)
    expect(isValidAppId("..")).toBe(false)
    expect(isValidAppId("")).toBe(false)
  })
})

describe("isReservedDefaultAsset", () => {
  it("flags assets whose top segment is a reserved pid internal", () => {
    expect(isReservedDefaultAsset("settings.json")).toBe(true)
    expect(isReservedDefaultAsset("extensions/foo/manifest.json")).toBe(true)
    expect(isReservedDefaultAsset("extensions-state.json")).toBe(true)
  })

  it("allows ordinary asset paths under the default app", () => {
    expect(isReservedDefaultAsset("index.html")).toBe(false)
    expect(isReservedDefaultAsset("assets/app.js")).toBe(false)
    expect(isReservedDefaultAsset("myplan/index.html")).toBe(false)
  })
})

describe("isCreatableAppName", () => {
  it("accepts valid, non-reserved names", () => {
    expect(isCreatableAppName("spec")).toBe(true)
    expect(isCreatableAppName("my-plan.v2")).toBe(true)
  })

  it("rejects reserved pid internals and the 'default' dir name", () => {
    expect(isCreatableAppName("extensions")).toBe(false)
    expect(isCreatableAppName("extensions-state.json")).toBe(false)
    expect(isCreatableAppName("settings.json")).toBe(false)
    expect(isCreatableAppName("default")).toBe(false)
  })

  it("rejects NAME_RE-invalid names (uppercase, spaces, traversal, empty)", () => {
    expect(isCreatableAppName("UPPER")).toBe(false)
    expect(isCreatableAppName("bad name")).toBe(false)
    expect(isCreatableAppName("..")).toBe(false)
    expect(isCreatableAppName("")).toBe(false)
  })
})

describe("buildStarterHtml", () => {
  it("embeds the app name as the document title", () => {
    expect(buildStarterHtml("spec")).toContain("<title>spec</title>")
  })

  it("ships no script or postMessage wiring — pid-apps stay capability-free", () => {
    const html = buildStarterHtml("spec")
    expect(html).not.toContain("<script")
    expect(html).not.toContain("postMessage")
  })
})

describe("discoverSpecApps", () => {
  it("keeps only *.html/*.htm filenames, skipping other extensions", () => {
    expect(discoverSpecApps(["readme.md", "notes.txt", "plan.html", "spec.htm"])).toEqual([
      { id: "plan", label: "plan", entry: "plan.html", root: "specs", source: "specs" },
      { id: "spec", label: "spec", entry: "spec.htm", root: "specs", source: "specs" },
    ])
  })

  it("skips basenames that fail NAME_RE without throwing", () => {
    expect(
      discoverSpecApps(["Bad Name.html", "UPPER.html", "../x.html", "ok-1.2.html", ".html"]),
    ).toEqual([
      { id: "ok-1.2", label: "ok-1.2", entry: "ok-1.2.html", root: "specs", source: "specs" },
    ])
  })

  it("orders deterministically: alphabetical by id", () => {
    const out = discoverSpecApps(["zeta.html", "alpha.htm"])
    expect(out.map((a) => a.id)).toEqual(["alpha", "zeta"])
  })

  it("returns [] for an empty filename list", () => {
    expect(discoverSpecApps([])).toEqual([])
  })
})

describe("mergeAppSources", () => {
  const pidApp = (id: string): PidApp => ({
    id,
    label: id,
    entry: "index.html",
    root: id === DEFAULT_APP_ID ? "" : id,
    source: "pid",
  })
  const specApp = (id: string): PidApp => ({
    id,
    label: id,
    entry: `${id}.html`,
    root: "specs",
    source: "specs",
  })

  it("drops a specApps entry whose id collides with a pidApps entry (.pid/ wins)", () => {
    const pidApps = [pidApp("default"), pidApp("foo")]
    const specApps = [specApp("bar"), specApp("foo")]
    expect(mergeAppSources(pidApps, specApps)).toEqual([
      pidApp("default"),
      pidApp("foo"),
      specApp("bar"),
    ])
  })

  it("keeps both sets when disjoint: pidApps order preserved, then specApps", () => {
    const pidApps = [pidApp("zeta"), pidApp("alpha")] // deliberately not alphabetical
    const specApps = [specApp("bar"), specApp("foo")]
    expect(mergeAppSources(pidApps, specApps)).toEqual([...pidApps, ...specApps])
  })

  it("returns each side unchanged when the other is empty", () => {
    const pidApps = [pidApp("a")]
    const specApps = [specApp("b")]
    expect(mergeAppSources(pidApps, [])).toEqual(pidApps)
    expect(mergeAppSources([], specApps)).toEqual(specApps)
  })
})
