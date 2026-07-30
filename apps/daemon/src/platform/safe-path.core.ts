/**
 * Path-traversal guards, shared across slices. PURE — no I/O.
 *
 * One question: *given a root and untrusted relative input, is this safe, and
 * where does it resolve?* All three exports are answers to it at different
 * granularities — a full resolve, a string-layer reject, and the single-segment
 * case — so they belong together and nowhere else.
 *
 * They lived in `features/projects/projects.core.ts` and
 * `features/claude-config/claude-config.core.ts`, which meant every other slice
 * needing a traversal guard had to reach into a sibling's internals (counted by
 * `bun run axiom-debt`) or copy the function. `isSafeSegment` had already been
 * copied — byte-identically, into `features/library/library.core.ts`, whose own
 * comment admitted it "mirrors claude-config.core". The canon prescribes this
 * destination: if two slices need the same pure helper, it goes in `platform/`.
 *
 * The `.core.ts` suffix is deliberate rather than incidental. It buys the whole
 * core-purity ban set by *shape* — no `throw`, no `await`, no
 * `Date`/`process`/`Promise`/`console`/`fetch`, one options object per exported
 * declaration — and it obliges a co-located test. A plain `platform/safe-path.ts`
 * would inherit none of that, which for path-traversal code is the wrong trade.
 */

import { isAbsolute, normalize, relative, resolve, sep } from "node:path"

export type ResolveOk = { readonly ok: true; readonly absPath: string; readonly relPath: string }
export type ResolveErr = { readonly ok: false; readonly reason: "escape" | "absolute" | "invalid" }
export type ResolveResult = ResolveOk | ResolveErr

// Resolve a user-supplied path against a project root and refuse anything that
// escapes the root (via "..", absolute paths, or symlink-looking tricks at the
// string layer). Symlink resolution at the filesystem layer is the repo's job.
export const resolveProjectPath = (args: {
  readonly root: string
  readonly input: string | undefined
}): ResolveResult => {
  const { root, input } = args
  const rel = (input ?? "").trim()
  if (rel === "" || rel === "." || rel === "/") {
    return { ok: true, absPath: root, relPath: "" }
  }
  if (isAbsolute(rel)) return { ok: false, reason: "absolute" }
  if (rel.includes("\0")) return { ok: false, reason: "invalid" }
  const normalized = normalize(rel)
  if (normalized.startsWith("..") || normalized.split(sep).includes("..")) {
    return { ok: false, reason: "escape" }
  }
  const absPath = resolve(root, normalized)
  const back = relative(root, absPath)
  if (back.startsWith("..") || isAbsolute(back)) {
    return { ok: false, reason: "escape" }
  }
  return { ok: true, absPath, relPath: back }
}

// String-layer guard for a user-supplied relative asset path, applied BEFORE any
// filesystem access: reject "..", backslashes, and absolute paths. Shared by the
// extension and pid-app static-asset routes (one rule, no drift). An empty string
// is allowed — callers decide whether "" means "serve the entry/index".
export const validateRelPath = (rel: string): boolean =>
  !rel.includes("..") && !rel.includes("\\") && !rel.startsWith("/")

// Coerce an arbitrary id (dirname / filename) to a safe path segment.
export const isSafeSegment = (id: string): boolean =>
  id.length > 0 &&
  !id.startsWith(".") &&
  !id.includes("/") &&
  !id.includes("\\") &&
  !id.includes("\0")
