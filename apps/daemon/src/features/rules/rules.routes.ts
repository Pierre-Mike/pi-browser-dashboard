// Hono shell for state-change rules: read through the engine, call nothing
// pure here (the engine already sandwiches its own core), respond. Mirrors
// issue-driver.routes.ts's shape (a status GET plus a pause POST) with one
// addition, `POST /preview` — the dry-run surface `bun run verify` and any
// human editing rules.json reach for before ever trusting `enabled: true`.

import { Hono } from "hono"
import type { RulesEngineApi } from "./rules.io"

export type RulesRouteDeps = {
  readonly engine: RulesEngineApi
}

// Mounted at "/rules" in api.ts, so these become GET /rules, POST
// /rules/pause, POST /rules/preview.
export const createApp = ({ engine }: RulesRouteDeps) =>
  new Hono()
    .get("/", async (c) => c.json(await engine.status()))
    .post("/pause", async (c) => {
      // Body optional; a bare POST defaults to pause=true, same contract as
      // issue-driver.routes.ts's own /pause.
      let paused = true
      try {
        const body: unknown = await c.req.json()
        if (body !== null && typeof body === "object" && "paused" in body) {
          if (typeof body.paused === "boolean") paused = body.paused
        }
      } catch {
        // body optional; default to pause=true
      }
      await engine.pause(paused)
      return c.json({ paused })
    })
    // Evaluates every currently-known session against the on-disk rules file
    // and reports what would happen. Fires nothing — see rules.io.ts's own
    // `preview` doc comment.
    .post("/preview", async (c) => c.json(await engine.preview()))
