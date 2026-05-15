import { Effect } from "effect"
import { Hono } from "hono"
import { appRuntime } from "../../platform/runtime"
import { ProjectsService } from "./projects.repo"

const app = new Hono().get("/", async (c) => {
  const list = await appRuntime.runPromise(
    Effect.gen(function* () {
      const svc = yield* ProjectsService
      return yield* svc.list()
    }),
  )
  return c.json(list)
})

export const testApp = app
export { app }
