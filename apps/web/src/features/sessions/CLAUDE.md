# apps/web/src/features/sessions — expertise

## Expertise

Owns the app-shell navigation chrome shared by every page: the static sidebar
(`lg` and up) and the slide-in drawer that replaces it below that
(`Sidebar.tsx`, `MobileNav.tsx`), the pure class helpers that size them
(`navChrome.ts`), and the two nav flags published to pages (`sidebarRail.tsx` →
`NavChromeChips`, which renders the drawer's hamburger and the rail's reopen chip
as exact complements). Both flags are owned by `routes/__root.tsx` — the rail's as
a per-browser `usePersistedFlag`, one instance shared downward because two
instances of that hook do not sync inside a single tab; the drawer's as plain
unpersisted `useState`, because the toggle renders inside `<main>` while the
drawer panel is a sibling of it. Anything that changes how much room the chrome
takes — width **or** height — has to be verified geometrically, not by class
name.

### References

- [Conventions](expertise-refs/conventions.md) — collapsed chrome reserves zero width *and* zero height; reopen/drawer controls ride in existing rows; `lg` gates room, `pointer-fine` gates hover

### Related Domains

- [apps/e2e](../../../../e2e/CLAUDE.md) — where the geometry assertions run
