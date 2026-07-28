import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readFleetFile } from "./fleet.io"

let root: string

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "fleet-io-"))

  await mkdir(join(root, "empty"), { recursive: true })

  await mkdir(join(root, "valid", ".pid"), { recursive: true })
  await writeFile(
    join(root, "valid", ".pid", "fleet.json"),
    JSON.stringify({ fleets: [{ name: "f", steps: [{ id: "a", intent: "do it" }] }] }),
  )

  await mkdir(join(root, "not-json", ".pid"), { recursive: true })
  await writeFile(join(root, "not-json", ".pid", "fleet.json"), "{not json")

  await mkdir(join(root, "invalid", ".pid"), { recursive: true })
  await writeFile(
    join(root, "invalid", ".pid", "fleet.json"),
    JSON.stringify({ fleets: [{ steps: [] }] }),
  )
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("readFleetFile", () => {
  it("returns empty fleets/errors when there is no fleet.json", async () => {
    expect(await readFleetFile(join(root, "empty"))).toEqual({ fleets: [], errors: [] })
  })

  it("returns empty fleets/errors for a root that doesn't exist at all", async () => {
    expect(await readFleetFile(join(root, "does-not-exist"))).toEqual({ fleets: [], errors: [] })
  })

  it("parses a valid stored recipe", async () => {
    const res = await readFleetFile(join(root, "valid"))
    expect(res.errors).toEqual([])
    expect(res.fleets).toHaveLength(1)
    expect(res.fleets[0]?.name).toBe("f")
  })

  it("surfaces malformed JSON as a file-level error rather than throwing", async () => {
    expect(await readFleetFile(join(root, "not-json"))).toEqual({
      fleets: [],
      errors: [{ fleet: "(file)", step: undefined, message: "fleet.json is not valid JSON" }],
    })
  })

  it("surfaces the validator's own errors for an invalid schema", async () => {
    const res = await readFleetFile(join(root, "invalid"))
    expect(res.fleets).toEqual([])
    expect(res.errors.length).toBeGreaterThan(0)
  })
})
