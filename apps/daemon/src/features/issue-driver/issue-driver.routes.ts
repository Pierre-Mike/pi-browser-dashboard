import { Effect } from "effect"
import { Hono } from "hono"
import { appRuntime } from "../../platform/runtime"
import { IssueDriverService } from "./issue-driver.repo"

const app = new Hono()
  .get("/status", async (c) => {
    const status = await appRuntime.runPromise(
      Effect.flatMap(IssueDriverService, (s) => s.status()),
    )
    return c.json(status)
  })
  .post("/poll", async (c) => {
    await appRuntime.runPromise(Effect.flatMap(IssueDriverService, (s) => s.tick()))
    return c.json({ ok: true })
  })
  .post("/pause", async (c) => {
    let paused = true
    try {
      const body = (await c.req.json()) as { paused?: unknown }
      if (typeof body.paused === "boolean") paused = body.paused
    } catch {
      // body optional; default to pause=true
    }
    await appRuntime.runPromise(Effect.flatMap(IssueDriverService, (s) => s.pause(paused)))
    return c.json({ paused })
  })

export const testApp = app
export { app }
