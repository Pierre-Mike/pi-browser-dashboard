# @pid/web

Vite + React + TanStack Router (file-based) + TanStack Query SPA. Reads `/sessions`, `/projects`, transcript JSONL from `@pid/daemon` via the typed `hc<AppType>` client; SSE patcher (`lib/sse.ts`) keeps the TanStack Query cache live; mutations (spawn / stop / rm / peek / send) go through hc with optimistic `invalidateQueries` calls — SSE remains the truth. Terminal tab opens a WebSocket directly at `/terminal/:short`. `VITE_API_URL` overrides the daemon URL (default `http://localhost:8787`). Tailwind for styling, no Zustand yet — TanStack Query owns server state.
