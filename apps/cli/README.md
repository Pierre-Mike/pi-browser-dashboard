# pid-dashboard

Browser dashboard for Claude Code background agent sessions — one command, no setup.

```
bunx pid-dashboard
```

That's it. It boots the daemon and the SPA on one port and opens your browser.
Requires [Bun](https://bun.sh) (the whole stack is Bun-native — `Bun.serve`,
`Bun.spawn`, `Bun.watch`).

## Options

```
pid-dashboard [options]

  -p, --port <n>   Port to listen on (default: 8787)
  --no-open        Don't open the browser automatically
  -h, --help       Show this help
```

## How it's packaged

This package ships as a single, dependency-free file (`dist/main.js`) built
with `bun build --target bun`, which inlines `@pid/daemon` and every one of
its dependencies (hono, effect, ...). The prebuilt `apps/web` SPA ships
alongside it as static assets (`dist-web/`). Installing/running the package
pulls down nothing else.

The daemon serves the SPA from `/` and moves its own API behind `/__api` —
the same same-origin prefix `apps/web/src/lib/apiBase.ts` already falls back
to when there's no `VITE_API_URL` override (previously only exercised by the
Cloudflare-tunnel dev proxy). See `apps/daemon/src/api.ts`'s `buildApp()`.

## Building from source (monorepo)

```
bun run build:cli   # from the repo root
```

Builds `apps/web` (no `VITE_API_URL` — same-origin build), copies its `dist`
into `dist-web/`, then bundles `apps/cli/src/main.ts` into `dist/main.js`.

```
bun run start:cli    # build + run in one step, from the repo root
```
