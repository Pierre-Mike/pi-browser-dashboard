import { describe, expect, it } from "bun:test"
import {
  BRAINSTORM_DIR,
  brainstormDocFromPath,
  brainstormEditorFor,
  brainstormKindFromPath,
  brainstormLabelFor,
  brainstormPathsForName,
  discoverBrainstormDocs,
  isCreatableBrainstormName,
  newBrainstormPath,
} from "./brainstorms.core"

describe("brainstormKindFromPath", () => {
  it("reads the format off the suffix", () => {
    expect(brainstormKindFromPath("brainstorms/auth.canvas")).toBe("canvas")
    expect(brainstormKindFromPath("notes/sketch.excalidraw")).toBe("excalidraw")
  })

  it("keeps .canvas.json apart from .canvas — the longer suffix wins", () => {
    expect(brainstormKindFromPath(".pid/brainstorms/legacy.canvas.json")).toBe("canvasJson")
  })

  it("is null for anything that is not a board", () => {
    for (const path of ["README.md", "src/canvas.ts", "canvas", "a.canvas.md", "x.json"]) {
      expect(brainstormKindFromPath(path)).toBeNull()
    }
  })

  it("needs a non-empty stem — a bare suffix is not a board", () => {
    expect(brainstormKindFromPath(".canvas")).toBeNull()
    expect(brainstormKindFromPath("dir/.excalidraw")).toBeNull()
    expect(brainstormKindFromPath(".canvas.json")).toBeNull()
  })
})

describe("brainstormEditorFor", () => {
  it("opens both canvas encodings in the canvas editor", () => {
    expect(brainstormEditorFor("canvas")).toBe("canvas")
    expect(brainstormEditorFor("canvasJson")).toBe("canvas")
    expect(brainstormEditorFor("excalidraw")).toBe("excalidraw")
  })
})

describe("brainstormLabelFor", () => {
  it("drops the suffix and the default directory prefix", () => {
    expect(brainstormLabelFor("brainstorms/auth.canvas")).toBe("auth")
  })

  it("keeps the path of a board that lives elsewhere, so two stems never read alike", () => {
    expect(brainstormLabelFor("docs/arch.canvas")).toBe("docs/arch")
    expect(brainstormLabelFor(".pid/brainstorms/legacy.canvas.json")).toBe(
      ".pid/brainstorms/legacy",
    )
  })

  it("keeps a nested board's path under the default directory", () => {
    expect(brainstormLabelFor("brainstorms/q3/plan.canvas")).toBe("q3/plan")
  })

  it("labels a board at the tree root with its bare stem", () => {
    expect(brainstormLabelFor("sketch.excalidraw")).toBe("sketch")
  })
})

describe("brainstormDocFromPath", () => {
  it("carries the path as the board's identity", () => {
    expect(brainstormDocFromPath("brainstorms/auth.canvas")).toEqual({
      path: "brainstorms/auth.canvas",
      label: "auth",
      kind: "canvas",
    })
  })

  it("is null for a non-board path", () => {
    expect(brainstormDocFromPath("src/index.ts")).toBeNull()
  })
})

describe("discoverBrainstormDocs", () => {
  it("finds every board anywhere in the tree, not just the default directory", () => {
    const docs = discoverBrainstormDocs([
      "README.md",
      "docs/arch.canvas",
      "brainstorms/auth.canvas",
      ".pid/brainstorms/legacy.canvas.json",
      "notes/sketch.excalidraw",
      "apps/web/src/canvas.tsx",
    ])
    expect(docs.map((d) => d.path)).toEqual([
      ".pid/brainstorms/legacy.canvas.json",
      "brainstorms/auth.canvas",
      "docs/arch.canvas",
      "notes/sketch.excalidraw",
    ])
  })

  it("orders by path so the rail is stable across listings", () => {
    expect(
      discoverBrainstormDocs(["b.canvas", "a.canvas", "c/a.canvas"]).map((d) => d.path),
    ).toEqual(["a.canvas", "b.canvas", "c/a.canvas"])
  })

  it("drops a duplicate path rather than listing one board twice", () => {
    expect(discoverBrainstormDocs(["a.canvas", "a.canvas"])).toHaveLength(1)
  })

  it("returns nothing for a tree with no boards", () => {
    expect(discoverBrainstormDocs(["src/index.ts"])).toEqual([])
  })
})

describe("isCreatableBrainstormName", () => {
  it("accepts a plain slug", () => {
    expect(isCreatableBrainstormName("auth-flow")).toBe(true)
    expect(isCreatableBrainstormName("q3.plan")).toBe(true)
    expect(isCreatableBrainstormName("a")).toBe(true)
  })

  it("refuses names that would escape or nest the default directory", () => {
    for (const bad of ["", "../escape", "a/b", "UPPER", "-lead", "with space", "a\\b", ".hidden"]) {
      expect(isCreatableBrainstormName(bad)).toBe(false)
    }
  })
})

describe("newBrainstormPath", () => {
  it("lands a new board in the default brainstorms directory", () => {
    expect(newBrainstormPath({ name: "auth", kind: "canvas" })).toBe(
      `${BRAINSTORM_DIR}/auth.canvas`,
    )
    expect(newBrainstormPath({ name: "auth", kind: "excalidraw" })).toBe(
      `${BRAINSTORM_DIR}/auth.excalidraw`,
    )
  })
})

describe("brainstormPathsForName", () => {
  it("lists every format the name could already be taken by", () => {
    expect(brainstormPathsForName("auth")).toEqual([
      `${BRAINSTORM_DIR}/auth.canvas`,
      `${BRAINSTORM_DIR}/auth.canvas.json`,
      `${BRAINSTORM_DIR}/auth.excalidraw`,
    ])
  })
})
