/**
 * HTTP headers that describe a file. PURE — no I/O.
 *
 * One question: *what Content-Type and Content-Disposition describe this file?*
 * Deliberately separate from `platform/safe-path.core.ts`: content negotiation has
 * nothing to do with traversal safety, and keeping them apart means the
 * security-critical module stays small enough to read closely. fallow also grades
 * complexity and duplication per file.
 *
 * Moved verbatim out of `features/projects/projects.core.ts` so slices needing a
 * content type stop reaching into the projects slice for one. Behaviour is
 * unchanged: the table and both functions are byte-identical to what shipped there.
 *
 * NOTE: two other extension tables still exist — `api.ts` (14 entries) and
 * `features/static-web/static-web.core.ts` (16) — with DIFFERENT coverage from this
 * one (44). Folding them in here changes what those callers return for extensions
 * they currently miss, so it is a behaviour change and a separate change. See the
 * MIME-consolidation task.
 */

import { basename } from "node:path"

const MIME_BY_EXT: Readonly<Record<string, string>> = {
  txt: "text/plain; charset=utf-8",
  log: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  markdown: "text/markdown; charset=utf-8",
  json: "application/json; charset=utf-8",
  jsonl: "application/json; charset=utf-8",
  ndjson: "application/json; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  yaml: "application/yaml; charset=utf-8",
  yml: "application/yaml; charset=utf-8",
  toml: "application/toml; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  tsv: "text/tab-separated-values; charset=utf-8",
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  cjs: "text/javascript; charset=utf-8",
  ts: "text/typescript; charset=utf-8",
  tsx: "text/typescript; charset=utf-8",
  jsx: "text/javascript; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/vnd.microsoft.icon",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  flac: "audio/flac",
  m4a: "audio/mp4",
  aac: "audio/aac",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  ogv: "video/ogg",
  pdf: "application/pdf",
}

const encodeRFC5987 = (s: string): string =>
  encodeURIComponent(s)
    .replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%(7C|60|5E)/g, (_m, h: string) => String.fromCharCode(Number.parseInt(h, 16)))

// ASCII-sanitised `filename=` for legacy agents plus a UTF-8 `filename*=`
// (RFC 5987) so non-ASCII names survive. Always derives the name from the
// basename so directory segments never leak into the header, and falls back to
// "download" when no basename is present.
export const contentDispositionAttachment = (path: string): string => {
  const name = basename(path) || "download"
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_")
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeRFC5987(name)}`
}

export const mimeFromPath = (relPath: string): string => {
  const name = relPath.toLowerCase()
  const dot = name.lastIndexOf(".")
  if (dot === -1 || dot === name.length - 1) return "application/octet-stream"
  const ext = name.slice(dot + 1)
  return MIME_BY_EXT[ext] ?? "application/octet-stream"
}
