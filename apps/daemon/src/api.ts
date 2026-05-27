import { Hono } from "hono"
import { cors } from "hono/cors"
import * as canvasRoute from "./features/canvas/canvas.routes"
import * as claudeConfigRoute from "./features/claude-config/claude-config.routes"
import * as dispatchRoute from "./features/dispatch/dispatch.routes"
import * as dropsRoute from "./features/drops/drops.routes"
import * as eventsRoute from "./features/events/events.routes"
import * as issueDriverRoute from "./features/issue-driver/issue-driver.routes"
import * as libraryRoute from "./features/library/library.routes"
import * as projectsRoute from "./features/projects/projects.routes"
import * as sessionsRoute from "./features/sessions/sessions.routes"
import * as terminalRoute from "./features/terminal/terminal.routes"
import * as uploadsRoute from "./features/uploads/uploads.routes"

const DEFAULT_ORIGINS = ["http://localhost:5173"]
const extraOrigins = (process.env.PID_CORS_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
const allowedOrigins = [...DEFAULT_ORIGINS, ...extraOrigins]

const app = new Hono()
  .use(
    "*",
    cors({
      origin: allowedOrigins,
      allowHeaders: ["Content-Type", "Last-Event-ID"],
      allowMethods: ["GET", "POST", "OPTIONS"],
      credentials: false,
    }),
  )
  .get("/health", (c) => c.json({ ok: true }))
  .route("/sessions", sessionsRoute.app)
  .route("/projects", projectsRoute.app)
  .route("/dispatch", dispatchRoute.app)
  .route("/drops", dropsRoute.app)
  .route("/events", eventsRoute.app)
  .route("/terminal", terminalRoute.app)
  .route("/canvas", canvasRoute.app)
  .route("/issue-driver", issueDriverRoute.app)
  .route("/claude-config", claudeConfigRoute.app)
  .route("/library", libraryRoute.app)
  .route("/uploads", uploadsRoute.app)

export type AppType = typeof app
export { app }
export { websocket } from "./platform/ws"
export default app
