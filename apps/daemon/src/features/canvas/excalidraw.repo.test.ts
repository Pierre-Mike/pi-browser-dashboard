import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { ExcalidrawDoc } from "./excalidraw.core"
import { __resetExcalidrawRoomsForTests, getExcalidrawRoomAt } from "./excalidraw.repo"

const makeTempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "pid-excalidraw-"))

// A doc with Excalidraw-native keys the daemon has no schema for — they must
// survive the room round-trip untouched.
const freehandDoc = (id: string): ExcalidrawDoc => ({
  type: "excalidraw",
  version: 2,
  source: "https://excalidraw.com",
  elements: [
    {
      id,
      type: "freedraw",
      points: [
        [0, 0],
        [2, 5],
      ],
      pressures: [0.1, 0.9],
      simulatePressure: false,
    },
  ],
  appState: { viewBackgroundColor: "#fffce8" },
  files: {},
})

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

describe("getExcalidrawRoomAt", () => {
  let dir: string

  beforeEach(() => {
    dir = makeTempDir()
  })

  afterEach(() => {
    __resetExcalidrawRoomsForTests()
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // best effort
    }
  })

  it("returns the empty native document when the file doesn't exist yet", async () => {
    const room = await getExcalidrawRoomAt(path.join(dir, "sketch.excalidraw"))
    const doc = room.snapshot()
    expect(doc.elements).toEqual([])
    expect(doc.type).toBe("excalidraw")
  })

  it("persists publish() output byte-preserving to the file it was opened at", async () => {
    const file = path.join(dir, "proj", ".pid", "brainstorms", "sketch.excalidraw")
    const room = await getExcalidrawRoomAt(file)
    const doc = freehandDoc("stroke-1")
    await room.publish(doc, null)
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(doc)
  })

  it("delivers an external file write (an agent's Write tool) to subscribers", async () => {
    const file = path.join(dir, "sketch.excalidraw")
    const room = await getExcalidrawRoomAt(file)
    const seen: ExcalidrawDoc[] = []
    room.subscribe((doc) => {
      seen.push(doc)
    })
    fs.writeFileSync(file, JSON.stringify(freehandDoc("agent-stroke")))
    // Allow the polling watcher (500ms) one cycle plus jitter.
    await wait(900)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toEqual(freehandDoc("agent-stroke"))
  })

  it("shares one room per path: a publish reaches a subscriber from a second open", async () => {
    const file = path.join(dir, "shared.excalidraw")
    const a = await getExcalidrawRoomAt(file)
    const b = await getExcalidrawRoomAt(file)
    const seen: ExcalidrawDoc[] = []
    b.subscribe((doc) => {
      seen.push(doc)
    })
    await a.publish(freehandDoc("shared-stroke"), null)
    expect(seen).toEqual([freehandDoc("shared-stroke")])
  })
})
