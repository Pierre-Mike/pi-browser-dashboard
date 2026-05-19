# projects

Per-project dashboard + read-only file browser.

- `useProjects` / `useProjectFiles` — TanStack Query hooks for `GET /projects`, `GET /projects/:id/files?path=`, `GET /projects/:id/file?path=`. File endpoints bypass `hc` and hit `VITE_API_URL` directly because the hc client's path-param + query-string shape is awkward for them. Stale times: projects 30 s, dir 15 s, file 30 s.
- `FileTree.tsx` — lazy tree (each `DirNode` fetches its own listing on expand, root opens by default) + right-pane preview. Binary files (NUL-byte server-side sniff) show a placeholder instead of garbled text.
- `ProjectDashboard.tsx` — header with git/no-isolation badge, state-count pills filtered to `s.cwd === project.path`, `SessionCard` grid, and the `FileTree` below. Spawn-new button opens `SpawnModal` pre-bound to this project.
- `treeUtil.ts` — `joinPath`, `parentOf`, `formatSize` (1024-base, locale-naive), `isTextLike`.
