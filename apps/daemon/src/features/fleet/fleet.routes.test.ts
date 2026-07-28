import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createApp } from "./fleet.routes"

let root: string

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "fleet-routes-"))

  await mkdir(join(root, "empty"), { recursive: true })

  await mkdir(join(root, "valid", ".pid"), { recursive: true })
  await writeFile(
    join(root, "valid", ".pid", "fleet.json"),
    JSON.stringify({
      fleets: [
        {
          name: "review-and-fix",
          description: "three reviewers, then one fixer",
          steps: [
            { id: "review", intent: "review the working diff for bugs", n: 3 },
            { id: "fix", intent: "fix what the reviewers found", needs: ["review"] },
          ],
        },
      ],
    }),
  )

  await mkdir(join(root, "broken", ".pid"), { recursive: true })
  await writeFile(
    join(root, "broken", ".pid", "fleet.json"),
    JSON.stringify({
      fleets: [
        {
          name: "bad",
          steps: [
            { id: "a", intent: "do a thing" },
            { id: "a", intent: "do another thing", needs: ["ghost"] },
          ],
        },
      ],
    }),
  )

  await mkdir(join(root, "not-json", ".pid"), { recursive: true })
  await writeFile(join(root, "not-json", ".pid", "fleet.json"), "{not json")
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

// The routes take the project root resolution as a function, so a test needs
// no ProjectsService at all — mirrors brainstorms.routes.test.ts. Only ids
// seeded above resolve; anything else is "unknown project".
const SEEDED_IDS = ["empty", "valid", "broken", "not-json"]
const app = createApp((id) => Promise.resolve(SEEDED_IDS.includes(id) ? join(root, id) : undefined))

describe("fleet routes", () => {
  it("GET /:id/fleets returns the schema plus wave grouping for a valid recipe", async () => {
    const res = await app.request("/valid/fleets")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.errors).toEqual([])
    expect(body.fleets).toHaveLength(1)
    expect(body.fleets[0].name).toBe("review-and-fix")
    expect(body.fleets[0].waves).toEqual([["review"], ["fix"]])
    expect(body.fleets[0].steps).toHaveLength(2)
  })

  it("GET /:id/fleets surfaces every validation error at 200, not 500", async () => {
    const res = await app.request("/broken/fleets")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.fleets).toEqual([])
    expect(body.errors).toContainEqual({
      fleet: "bad",
      step: "a",
      message: 'duplicate step id: "a"',
    })
    expect(body.errors).toContainEqual({
      fleet: "bad",
      step: "a",
      message: 'needs unknown step: "ghost"',
    })
  })

  it("GET /:id/fleets reports malformed JSON as a file-level error, not 500", async () => {
    const res = await app.request("/not-json/fleets")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      fleets: [],
      errors: [{ fleet: "(file)", step: undefined, message: "fleet.json is not valid JSON" }],
    })
  })

  it("GET /:id/fleets returns empty fleets/errors when there is no fleet.json at all", async () => {
    const res = await app.request("/empty/fleets")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ fleets: [], errors: [] })
  })

  it("GET /:id/fleets 404s for an unknown project", async () => {
    const res = await app.request("/ghost/fleets")
    expect(res.status).toBe(404)
  })
})
