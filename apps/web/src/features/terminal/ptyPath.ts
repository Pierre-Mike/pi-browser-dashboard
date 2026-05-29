// Wrap a filesystem path in single quotes so it is safe to inject into a
// shell via the pty. Paths containing spaces (e.g. "my doc.txt") are
// otherwise split into multiple shell words on the next Enter.
//
// Safety: single-quote-wrapping is sound only when the path itself cannot
// contain a single quote. The daemon's `sanitiseName` function permits spaces
// but maps every single quote to "_" (via the `[^\w.\-+ ]` regex), so no
// server-returned path can close the quote early.
//
// Paths with no spaces are returned unchanged — quoting is a no-op for them
// in the shell, but we avoid the extra characters for cleaner UX.
export const shellQuotePath = (path: string): string => {
  if (!path.includes(" ")) return path
  return `'${path}'`
}
