#!/usr/bin/env bun
/**
 * scaffold:slice — generate a daemon feature slice in the canonical shape.
 *
 * `bun run scaffold:slice <feature>` (kebab-case) writes the five slice files
 * (pure core + its test, the Effect io port, the Hono routes + their test),
 * mounts the route in `apps/daemon/src/api.ts`, and registers the live Layer in
 * `apps/daemon/src/platform/runtime.ts`.
 *
 * Why a generator rather than a written recipe: a recipe is advice and decays,
 * and every hand-copied slice drifts a little from the last one. This emits the
 * exact shape every gate already expects — pure core, co-located tests, a
 * `Context.Tag` service with both a live and a test Layer, the `{ error: tag }`
 * envelope, one parameter per declaration — so a new slice starts green and the
 * canonical shape is what's cheapest to produce.
 *
 * The generated slice is deliberately a *working* trivial feature, not a set of
 * TODOs: `bun run verify` passes immediately after scaffolding, which means any
 * failure you see afterwards is yours.
 *
 * `--door` additionally emits `<feature>.door.ts`, the slice's published surface
 * (the modular-monolith door). Opt-in on purpose: a door nobody imports yet is
 * an unused export, and `bun run audit` fails on dead code. Ask for it when you
 * already know a second module will consume this one, and wire that import in
 * the same change.
 */
import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
const daemonSrc = join(root, "apps/daemon/src")

const fail = (msg: string): never => {
  console.error(`✖ ${msg}`)
  process.exit(1)
}

const usage = "usage: bun run scaffold:slice <feature> [--door]  (kebab-case, e.g. issue-triage)"

const args = process.argv.slice(2)
const unknownFlag = args.find((arg) => arg.startsWith("-") && arg !== "--door")
if (unknownFlag !== undefined) fail(`unknown flag ${unknownFlag}\n${usage}`)

const withDoor = args.includes("--door")
const name = args.find((arg) => !arg.startsWith("-")) ?? ""
if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)) {
  fail(usage)
}

const pascal = name
  .split("-")
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join("")

const camel = pascal.charAt(0).toLowerCase() + pascal.slice(1)

const sliceDir = join(daemonSrc, "features", name)
if (existsSync(sliceDir)) fail(`slice already exists: apps/daemon/src/features/${name}`)

// --- slice templates --------------------------------------------------------
// Modelled on features/pid-settings, the smallest slice that uses every part of
// the pattern: a pure core, a Context.Tag service with live + test Layers, and
// routes that render an Either as the shared error envelope.

const coreTs = `/**
 * Functional core for the \`${name}\` slice — PURE.
 *
 * Plain data in, plain data out. Failures are values (\`Either\`), never thrown:
 * the shell decides whether a Left is a 400, a retry or a log line. No Effect
 * runtime, no I/O, no clock, no environment — biome enforces all of that by the
 * \`.core.ts\` suffix, so keeping this file honest is not optional.
 *
 * Declarations take a single options object (also enforced): a one-object
 * signature stays narrow as the implementation deepens.
 */
import { Either } from "effect"

export type ${pascal}Error = "invalid_id"

export type ${pascal} = {
  readonly id: string
  readonly label: string
}

/** Validate the \`:id\` path param. Invalid input is a Left, never a throw. */
export const parse${pascal}Id = (input: {
  readonly raw: string | undefined
}): Either.Either<string, ${pascal}Error> => {
  const trimmed = (input.raw ?? "").trim()
  if (trimmed === "") return Either.left("invalid_id")
  return Either.right(trimmed)
}

/** Build the response payload from already-read inputs. Pure and total. */
export const build${pascal} = (input: {
  readonly id: string
  readonly label: string | null
}): ${pascal} => ({
  id: input.id,
  label: input.label ?? input.id,
})
`

const coreTestTs = `import { describe, expect, it } from "bun:test"
import { Either } from "effect"
import { build${pascal}, parse${pascal}Id } from "./${name}.core"

describe("parse${pascal}Id", () => {
  it("accepts a non-empty id", () => {
    expect(parse${pascal}Id({ raw: "abc" })).toEqual(Either.right("abc"))
  })

  it("trims surrounding whitespace", () => {
    expect(parse${pascal}Id({ raw: "  abc  " })).toEqual(Either.right("abc"))
  })

  it("returns a Left for a missing id — error as value, not a throw", () => {
    expect(parse${pascal}Id({ raw: undefined })).toEqual(Either.left("invalid_id"))
  })

  it("returns a Left for a whitespace-only id", () => {
    expect(parse${pascal}Id({ raw: "   " })).toEqual(Either.left("invalid_id"))
  })
})

describe("build${pascal}", () => {
  it("uses the stored label when there is one", () => {
    expect(build${pascal}({ id: "abc", label: "Abc" })).toEqual({ id: "abc", label: "Abc" })
  })

  it("falls back to the id when the label is absent", () => {
    expect(build${pascal}({ id: "abc", label: null })).toEqual({ id: "abc", label: "abc" })
  })
})
`

const ioTs = `/**
 * Imperative shell for the \`${name}\` slice — its I/O port, in the hexagonal
 * sense: any effectful dependency belongs here (filesystem, subprocess, HTTP,
 * clock), not just persistence.
 *
 * Routes depend on the \`Context.Tag\`, never on this module's implementation, so
 * the live Layer can be swapped for \`${pascal}IoTest\` in a test — or, one day,
 * for a Layer that talks to another process — without touching a call site.
 *
 * Replace the in-memory store below with the real thing.
 */
import { Context, Effect, Layer } from "effect"
import type { ${pascal}Error } from "./${name}.core"

${withDoor ? "export " : ""}type ${pascal}ServiceApi = {
  readonly labelFor: (id: string) => Effect.Effect<string | null, ${pascal}Error, never>
}

export class ${pascal}Service extends Context.Tag("${pascal}Service")<
  ${pascal}Service,
  ${pascal}ServiceApi
>() {}

export const ${pascal}IoLive: Layer.Layer<${pascal}Service> = Layer.succeed(${pascal}Service, {
  labelFor: () => Effect.succeed(null),
})

/** Test Layer over the same Tag — inject a store instead of stubbing routes. */
export const ${pascal}IoTest = (
  store: Record<string, string> = {},
): Layer.Layer<${pascal}Service> =>
  Layer.succeed(${pascal}Service, {
    labelFor: (id) => Effect.succeed(store[id] ?? null),
  })
`

const routesTs = `/**
 * Hono shell for the \`${name}\` slice — the impureim sandwich:
 * impure read through the service, pure core in the middle, one response shape
 * on the way out.
 *
 * \`createApp\` takes the runner so the test can build the *real* handlers over a
 * test Layer instead of re-implementing them; \`app\` is the live wiring.
 *
 * Failures cross HTTP as \`{ error: "<machine_tag>" }\` — the shared
 * \`ApiErrorBody\` contract in \`@pid/shared\`. Keep the tag snake_case and stable:
 * clients branch on it.
 */
import { Effect } from "effect"
import { Hono } from "hono"
import { appRuntime } from "../../platform/runtime"
import { build${pascal}, parse${pascal}Id, type ${pascal}Error } from "./${name}.core"
import { ${pascal}Service } from "./${name}.io"

// An allowlist, not a fallback: adding a tag to ${pascal}Error without adding it
// here is a type error, so a new failure mode cannot silently inherit someone
// else's status code.
const STATUS_BY_ERROR: Record<${pascal}Error, 400 | 403 | 404> = {
  invalid_id: 400,
}

type RunPromise = <A>(effect: Effect.Effect<A, never, ${pascal}Service>) => Promise<A>

export const createApp = (run: RunPromise) =>
  new Hono().get("/:id", async (c) => {
    const program = Effect.gen(function* () {
      const id = yield* parse${pascal}Id({ raw: c.req.param("id") })
      const service = yield* ${pascal}Service
      const label = yield* service.labelFor(id)
      return build${pascal}({ id, label })
    })

    const result = await run(Effect.either(program))
    if (result._tag === "Left") {
      return c.json({ error: result.left }, STATUS_BY_ERROR[result.left])
    }
    return c.json(result.right)
  })

const app = createApp((effect) => appRuntime.runPromise(effect))

export { app }
`

const routesTestTs = `/**
 * Route test over a test Layer: the real handlers, fake I/O. Asserts both the
 * happy path and that the failure branch conforms to the shared error envelope
 * (\`decodeApiErrorBody\` throws if it does not) — so a slice cannot quietly
 * invent its own error shape.
 */
import { describe, expect, it } from "bun:test"
import { decodeApiErrorBody } from "@pid/shared"
import { Layer, ManagedRuntime } from "effect"
import { ${pascal}IoTest } from "./${name}.io"
import { createApp } from "./${name}.routes"

const appOver = (store: Record<string, string>) => {
  const runtime = ManagedRuntime.make(Layer.mergeAll(${pascal}IoTest(store)))
  return createApp((effect) => runtime.runPromise(effect))
}

describe("GET /${name}/:id", () => {
  it("returns the stored label", async () => {
    const res = await appOver({ abc: "Abc" }).request("/abc")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: "abc", label: "Abc" })
  })

  it("falls back to the id when nothing is stored", async () => {
    const res = await appOver({}).request("/abc")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: "abc", label: "abc" })
  })

  it("renders a core Left as the shared error envelope", async () => {
    const res = await appOver({}).request("/%20")
    expect(res.status).toBe(400)
    const body = decodeApiErrorBody(await res.json())
    expect(body.error).toBe("invalid_id")
  })
})
`

const doorTs = `/**
 * Published door for the \`${name}\` slice (modular monolith) — the ONE file
 * another feature slice may import. Every other cross-slice path is a
 * back-channel that \`bun run axiom-debt\` counts as debt, and a pure
 * \`*.core.ts\` may not import a door at all: a door re-exports a
 * \`Context.Tag\`, so consuming one would drag the Effect runtime into pure
 * code (biome bans it by shape).
 *
 * It publishes the service \`Context.Tag\` and its interface type, never the
 * implementation, so a consumer couples to the Tag: swapping \`${pascal}IoLive\`
 * — for a test Layer, or for a client that talks to another process the day this
 * module ships as its own deployment — is a Layer change at the composition
 * root, not a call-site change.
 *
 * Keep it narrow: whatever this file exports is what other modules couple to.
 * Data crossing the door belongs in \`shared/src\` as an effect \`Schema\`;
 * promote it there and re-export it here so consumers have a single import
 * site, e.g. \`export { type ${pascal} } from "@pid/shared"\`.
 */
export { ${pascal}Service, type ${pascal}ServiceApi } from "./${name}.io"
`

// --- write the slice --------------------------------------------------------

await mkdir(sliceDir, { recursive: true })
const files: Record<string, string> = {
  [`${name}.core.ts`]: coreTs,
  [`${name}.core.test.ts`]: coreTestTs,
  [`${name}.io.ts`]: ioTs,
  [`${name}.routes.ts`]: routesTs,
  [`${name}.routes.test.ts`]: routesTestTs,
  ...(withDoor ? { [`${name}.door.ts`]: doorTs } : {}),
}
for (const [file, content] of Object.entries(files)) {
  await Bun.write(join(sliceDir, file), content)
  console.error(`created apps/daemon/src/features/${name}/${file}`)
}

// --- mount the route in api.ts ----------------------------------------------
// Both anchors match the LAST occurrence of their shape (the trailing negative
// lookahead is what makes "last" work in a dialect with no reverse search), so
// insertion stays position-stable however the file grows.

const apiPath = join(daemonSrc, "api.ts")
let api = await Bun.file(apiPath).text()

const importAnchor =
  /import \* as \w+Route from "\.\/features\/[^\n]*\n(?![\s\S]*import \* as \w+Route from)/
const importMatch = api.match(importAnchor)
if (!importMatch || importMatch.index === undefined) {
  fail('api.ts anchor not found: expected an `import * as <x>Route from "./features/..."` line')
}
const importEnd = (importMatch?.index ?? 0) + (importMatch?.[0].length ?? 0)
api = `${api.slice(0, importEnd)}import * as ${camel}Route from "./features/${name}/${name}.routes"\n${api.slice(importEnd)}`

// The lookahead repeats the *whole* newline-anchored shape rather than just the
// `.route(...)` tail. api.ts also mounts routes inline inside `buildApp`
// (`return wrapper.route("/events", eventsRoute.app).route("/", …)`), and a
// looser lookahead matches those too — which makes every newline-anchored
// candidate look non-final, so the anchor never resolves.
const routeAnchor =
  /\n(\s*)\.route\("[^"]+", \w+Route\.app\)(?![\s\S]*\n\s*\.route\("[^"]+", \w+Route\.app\))/
const routeMatch = api.match(routeAnchor)
if (!routeMatch || routeMatch.index === undefined) {
  fail('api.ts anchor not found: expected an existing `.route("/<x>", <x>Route.app)` call')
}
const routeEnd = (routeMatch?.index ?? 0) + (routeMatch?.[0].length ?? 0)
api = `${api.slice(0, routeEnd)}\n${routeMatch?.[1] ?? "  "}.route("/${name}", ${camel}Route.app)${api.slice(routeEnd)}`

await Bun.write(apiPath, api)
console.error(`mounted /${name} in apps/daemon/src/api.ts`)

// --- register the live Layer in platform/runtime.ts -------------------------

const runtimePath = join(daemonSrc, "platform/runtime.ts")
let runtime = await Bun.file(runtimePath).text()
if (!runtime.includes("Layer.mergeAll(")) {
  fail("runtime.ts anchor not found: expected `Layer.mergeAll(`")
}

const layerImportAnchor =
  /import \{ \w+IoLive \} from "\.\.\/features\/[^\n]*\n(?![\s\S]*import \{ \w+IoLive \} from "\.\.\/features\/)/
if (!layerImportAnchor.test(runtime)) {
  fail(
    'runtime.ts anchor not found: expected an `import { <X>IoLive } from "../features/..."` line',
  )
}
runtime = runtime.replace(
  layerImportAnchor,
  (m) => `${m}import { ${pascal}IoLive } from "../features/${name}/${name}.io"\n`,
)

// Prepended as the FIRST mergeAll argument on purpose: appending before the
// closing paren would need paren-balanced matching, and the existing arguments
// include nested calls (`Layer.provide(PiIoLive, PiSessionsIoLive)`).
runtime = runtime.replace(/Layer\.mergeAll\(\n/, `Layer.mergeAll(\n  ${pascal}IoLive,\n`)
await Bun.write(runtimePath, runtime)
console.error(`registered ${pascal}IoLive in apps/daemon/src/platform/runtime.ts`)

// --- normalize formatting so the result is lint:ci-clean out of the box -----

Bun.spawnSync(
  ["bunx", "biome", "check", "--write", "--no-errors-on-unmatched", sliceDir, apiPath, runtimePath],
  { cwd: root, stdout: "inherit", stderr: "inherit" },
)

console.error(`
next steps:
  1. replace the in-memory store in ${name}.io.ts with the real I/O
  2. grow the pure decision logic in ${name}.core.ts + its co-located test
  3. widen ${pascal}Error and STATUS_BY_ERROR together as new failure modes
     appear — keep the tags snake_case, clients branch on them
  4. promote any type apps/web also needs to shared/src (one declaration, not a
     hand-copied mirror), and re-export it from shared/src/index.ts
  5. (web) add the query hook + route under apps/web/src/features/${name}/,
     going through the typed RPC client in apps/web/src/lib/api.ts
  6. bun run verify
${
  withDoor
    ? `
door: ${name}.door.ts is this slice's published surface — the only file another
      slice may import. Re-export the shared Schema contract there too, and add
      the consuming import NOW: an unconsumed door is an unused export and
      \`bun run audit\` fails on dead code.
`
    : `
door: this slice publishes nothing yet. When a second module needs it, re-run
      with --door (or add ${name}.door.ts by hand) rather than letting the
      consumer reach into .core / .io / .routes.
`
}`)
