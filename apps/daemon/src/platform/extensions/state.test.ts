import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import {
  grantsFor,
  isEnabled,
  permissionKeysFromGrants,
  readState,
  setEnabled,
  setGrants,
  stateFileFor,
  writeState,
} from "./state"

const tmpFile = (): string =>
  join(tmpdir(), `pid-ext-state-${Math.random().toString(36).slice(2)}.json`)

let file: string

beforeEach(() => {
  file = tmpFile()
})

afterEach(() => {
  try {
    rmSync(file, { force: true })
  } catch {
    // ignore
  }
})

describe("readState", () => {
  it("returns {} for missing file", () => {
    expect(readState(join(tmpdir(), "does-not-exist-xyz.json"))).toEqual({})
  })

  it("returns {} for corrupt file", () => {
    writeFileSync(file, "not json{{{")
    expect(readState(file)).toEqual({})
  })

  it("returns {} for non-object JSON", () => {
    writeFileSync(file, JSON.stringify([1, 2, 3]))
    expect(readState(file)).toEqual({})
  })

  it("reads a valid state file", () => {
    const state = { alpha: { enabled: true, grants: { fs: ["/tmp"] } } }
    writeFileSync(file, JSON.stringify(state))
    expect(readState(file)).toEqual(state)
  })
})

describe("writeState", () => {
  it("writes and reads back correctly", () => {
    const state = { beta: { enabled: false, grants: { exec: ["git"] } } }
    writeState(file, state)
    expect(readState(file)).toEqual(state)
  })

  it("creates parent directories", () => {
    const subDir = `pid-nested-${Math.random().toString(36).slice(2)}`
    const nested = join(tmpdir(), subDir, "state.json")
    try {
      writeState(nested, { x: { enabled: true, grants: {} } })
      expect(readState(nested)).toEqual({ x: { enabled: true, grants: {} } })
    } finally {
      try {
        rmSync(join(tmpdir(), subDir), { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
  })
})

describe("setEnabled", () => {
  it("writes enabled=true and reads back", () => {
    setEnabled(file, "myext", true)
    const s = readState(file)
    expect(s.myext?.enabled).toBe(true)
  })

  it("writes enabled=false and reads back", () => {
    setEnabled(file, "myext", false)
    const s = readState(file)
    expect(s.myext?.enabled).toBe(false)
  })

  it("preserves existing grants when toggling enabled", () => {
    writeState(file, { myext: { enabled: true, grants: { fs: ["/tmp"] } } })
    setEnabled(file, "myext", false)
    expect(readState(file).myext?.grants).toEqual({ fs: ["/tmp"] })
  })

  it("returns the updated state", () => {
    const result = setEnabled(file, "myext", false)
    expect(result.myext?.enabled).toBe(false)
  })
})

describe("setGrants", () => {
  it("writes grants and reads back", () => {
    setGrants(file, "myext", { fs: ["/tmp"], events: true })
    const s = readState(file)
    expect(s.myext?.grants).toEqual({ fs: ["/tmp"], events: true })
  })

  it("preserves existing enabled when updating grants", () => {
    writeState(file, { myext: { enabled: false, grants: {} } })
    setGrants(file, "myext", { exec: ["ls"] })
    expect(readState(file).myext?.enabled).toBe(false)
  })

  it("returns the updated state", () => {
    const result = setGrants(file, "myext", { net: ["api.example.com"] })
    expect(result.myext?.grants).toEqual({ net: ["api.example.com"] })
  })
})

describe("isEnabled", () => {
  it("defaults to true when name absent", () => {
    expect(isEnabled({}, "missing")).toBe(true)
  })

  it("returns false when explicitly disabled", () => {
    expect(isEnabled({ myext: { enabled: false, grants: {} } }, "myext")).toBe(false)
  })

  it("returns true when explicitly enabled", () => {
    expect(isEnabled({ myext: { enabled: true, grants: {} } }, "myext")).toBe(true)
  })
})

describe("grantsFor", () => {
  it("defaults to {} when name absent", () => {
    expect(grantsFor({}, "missing")).toEqual({})
  })

  it("returns stored grants", () => {
    const state = { myext: { enabled: true, grants: { fs: ["/tmp"], events: true } } }
    expect(grantsFor(state, "myext")).toEqual({ fs: ["/tmp"], events: true })
  })
})

describe("stateFileFor", () => {
  const savedEnv = process.env.PID_EXT_STATE_FILE

  afterEach(() => {
    if (savedEnv === undefined) {
      // biome-ignore lint/performance/noDelete: keep env clean for sibling tests
      delete process.env.PID_EXT_STATE_FILE
    } else {
      process.env.PID_EXT_STATE_FILE = savedEnv
    }
  })

  it("global scope resolves to the shared home state file", () => {
    // biome-ignore lint/performance/noDelete: ensure no override is in effect
    delete process.env.PID_EXT_STATE_FILE
    expect(stateFileFor({ scope: "global", dir: "/anything/here" })).toBe(
      join(homedir(), ".pid/extensions-state.json"),
    )
  })

  it("local scope resolves to the project's .pid directory, not home", () => {
    // biome-ignore lint/performance/noDelete: ensure no override is in effect
    delete process.env.PID_EXT_STATE_FILE
    const dir = "/projA/.pid/extensions/my-ext"
    expect(stateFileFor({ scope: "local", dir })).toBe("/projA/.pid/extensions-state.json")
  })

  it("local extensions in different projects resolve to different state files", () => {
    // biome-ignore lint/performance/noDelete: ensure no override is in effect
    delete process.env.PID_EXT_STATE_FILE
    const a = stateFileFor({ scope: "local", dir: "/projA/.pid/extensions/shared" })
    const b = stateFileFor({ scope: "local", dir: "/projB/.pid/extensions/shared" })
    expect(a).not.toBe(b)
  })

  it("PID_EXT_STATE_FILE overrides both scopes", () => {
    process.env.PID_EXT_STATE_FILE = "/override/state.json"
    expect(stateFileFor({ scope: "global", dir: "/x" })).toBe("/override/state.json")
    expect(stateFileFor({ scope: "local", dir: "/projA/.pid/extensions/e" })).toBe(
      "/override/state.json",
    )
  })
})

describe("permissionKeysFromGrants", () => {
  it("returns empty array for empty grants", () => {
    expect(permissionKeysFromGrants({})).toEqual([])
  })

  it("includes fs key when fs paths present", () => {
    expect(permissionKeysFromGrants({ fs: ["/tmp"] })).toContain("fs")
  })

  it("includes exec, net, events keys", () => {
    const keys = permissionKeysFromGrants({ exec: ["git"], net: ["api.com"], events: true })
    expect(keys).toContain("exec")
    expect(keys).toContain("net")
    expect(keys).toContain("events")
  })

  it("excludes keys with empty arrays", () => {
    expect(permissionKeysFromGrants({ fs: [] })).not.toContain("fs")
  })
})
