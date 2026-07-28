# apps/web/src/features/sessions — expertise

## Expertise

Owns the app-shell navigation chrome shared by every page: the desktop sidebar
and its mobile drawer (`Sidebar.tsx`, `MobileNav.tsx`), the pure class helpers
that size them (`navChrome.ts`), and the collapse flag published to pages
(`sidebarRail.tsx`). Collapse state is a per-browser `usePersistedFlag` owned by
`routes/__root.tsx` — one instance shared downward, because two instances of that
hook do not sync inside a single tab. Anything that changes how much room the
chrome takes has to be verified geometrically, not by class name.

### References

- [Conventions](expertise-refs/conventions.md) — collapsed chrome reserves zero width; reopen controls ride in existing rows

### Related Domains

- [apps/e2e](../../../../e2e/CLAUDE.md) — where the geometry assertions run
