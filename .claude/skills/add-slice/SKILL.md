---
name: add-slice
description: Add a feature slice to the daemon (and optionally its web route) in this repo's canonical shape. Use when the user asks for a new backend feature, a new API endpoint, or a new vertical slice.
---

# Add a feature slice

Never hand-copy an existing slice. Run the generator:

```bash
bun run scaffold:slice <feature>     # kebab-case, e.g. issue-triage
```

It writes the five files in canonical shape, mounts the route in
`apps/daemon/src/api.ts`, registers the live `Layer` in
`apps/daemon/src/platform/runtime.ts`, and formats the result. `bun run verify`
passes immediately after scaffolding — so any failure after this point is
something you introduced, which is the whole reason to start from a green slice.

```
apps/daemon/src/features/<feature>/
  <feature>.core.ts        # PURE decision logic; failures are Either lefts
  <feature>.core.test.ts   # co-located, data-in/data-out
  <feature>.io.ts          # Context.Tag service + IoLive + IoTest layers
  <feature>.routes.ts      # createApp(run) + the live `app`
  <feature>.routes.test.ts # real handlers over the IoTest layer
```

## Then, in order

1. **Grow the core first.** If the rule can be written as data-in/data-out, it
   belongs in `<feature>.core.ts` with a test — not in a route handler. The core
   may not `throw`, `await`, read the clock or the environment, or import
   `Effect`/`Layer`/`Context`; biome enforces every one of those by the
   `.core.ts` suffix. Return `Either.left("snake_case_tag")` and let the shell
   decide the status code.
2. **Replace the stub I/O** in `<feature>.io.ts`. Every effectful dependency
   goes here — filesystem, subprocess, HTTP, clock — not just persistence.
   Keep `<Feature>IoTest` in step with the live Layer; the route test uses it.
3. **Widen the error allowlist.** New failure tags go in `<Feature>Error` *and*
   in `STATUS_BY_ERROR` in the routes file. Adding one without the other is a
   type error on purpose — a new failure cannot inherit someone else's status.
4. **Promote shared types.** The moment `apps/web` needs a type, move it to
   `shared/src/` as an effect `Schema` and re-export it from
   `shared/src/index.ts`. Do **not** hand-copy it into the web app: that is
   exactly the "local mirror" that had already drifted for `SessionState` and
   `Project` before `shared/` existed.
5. **Web side**, if the feature has UI: add
   `apps/web/src/features/<feature>/`, talk to the daemon through the typed RPC
   client (`apps/web/src/lib/api.ts`), and decode responses with the shared
   `decode*` helper. No raw `fetch`, no `as SomeType` on a `.json()`.
6. `bun run verify`.

## Do not

- Reach into another slice's `*.core.ts` / `*.io.ts` / `*.routes.ts`. Import its
  published door — the service `Context.Tag`, or a contract in `shared/`. If two
  slices need the same pure helper, it goes in `platform/`.
- Add a raw `fetch` or a `(await res.json()) as T`. Both are tracked by
  `bun run axiom-debt`, which fails on any new occurrence.
- Skip the co-located test. `bun run test` gates on a sibling `*.core.test.ts`
  for every `*.core.ts`, and the pre-commit hook blocks a source-only commit.
