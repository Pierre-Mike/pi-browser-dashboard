import { describe, expect, it, test } from "bun:test"
import { contentDispositionAttachment, mimeFromPath } from "./http-content.core"

// Moved verbatim from projects.core.test.ts when the header helpers moved here.

describe("contentDispositionAttachment", () => {
  it("forces attachment and preserves the basename for an ASCII name", () => {
    expect(contentDispositionAttachment("notes/report.pdf")).toBe(
      `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`,
    )
  })

  it("strips directory segments so only the filename is offered", () => {
    expect(contentDispositionAttachment("a/b/c/data.json")).toBe(
      `attachment; filename="data.json"; filename*=UTF-8''data.json`,
    )
  })

  it("sanitises quotes and backslashes in the ASCII fallback", () => {
    expect(contentDispositionAttachment(`weird"name\\.txt`)).toBe(
      `attachment; filename="weird_name_.txt"; filename*=UTF-8''weird%22name%5C.txt`,
    )
  })

  it("encodes non-ASCII names via RFC 5987 while keeping an ASCII fallback", () => {
    expect(contentDispositionAttachment("café.txt")).toBe(
      `attachment; filename="caf_.txt"; filename*=UTF-8''caf%C3%A9.txt`,
    )
  })

  it("falls back to 'download' when no basename is present", () => {
    expect(contentDispositionAttachment("")).toBe(
      `attachment; filename="download"; filename*=UTF-8''download`,
    )
  })
})

describe("mimeFromPath", () => {
  test("maps image extensions", () => {
    expect(mimeFromPath("logo.png")).toBe("image/png")
    expect(mimeFromPath("Photo.JPG")).toBe("image/jpeg")
    expect(mimeFromPath("icon.svg")).toBe("image/svg+xml")
    expect(mimeFromPath("frame.webp")).toBe("image/webp")
  })

  test("maps audio extensions", () => {
    expect(mimeFromPath("clip.mp3")).toBe("audio/mpeg")
    expect(mimeFromPath("song.WAV")).toBe("audio/wav")
    expect(mimeFromPath("voice.ogg")).toBe("audio/ogg")
  })

  test("maps video extensions", () => {
    expect(mimeFromPath("scene.mp4")).toBe("video/mp4")
    expect(mimeFromPath("clip.webm")).toBe("video/webm")
    expect(mimeFromPath("intro.mov")).toBe("video/quicktime")
  })

  test("maps document and text extensions", () => {
    expect(mimeFromPath("manual.pdf")).toBe("application/pdf")
    expect(mimeFromPath("README.md")).toBe("text/markdown; charset=utf-8")
    expect(mimeFromPath("page.html")).toBe("text/html; charset=utf-8")
    expect(mimeFromPath("notes.txt")).toBe("text/plain; charset=utf-8")
    expect(mimeFromPath("data.json")).toBe("application/json; charset=utf-8")
  })

  test("falls back to octet-stream for unknown and extensionless paths", () => {
    expect(mimeFromPath("Dockerfile")).toBe("application/octet-stream")
    expect(mimeFromPath("archive.xyz")).toBe("application/octet-stream")
    expect(mimeFromPath("nodot")).toBe("application/octet-stream")
    expect(mimeFromPath("trailing.")).toBe("application/octet-stream")
  })

  // Arrived when the `api.ts` and `static-web` tables were folded in here: both
  // of those carried these three and this table did not, so without them the
  // consolidation would have regressed webfonts and sourcemaps to octet-stream
  // under `nosniff`. They apply to this function's existing callers too — the
  // project file browser and pid-apps static assets.
  test("maps the webfont and sourcemap extensions the folded-in tables carried", () => {
    expect(mimeFromPath("assets/inter.woff2")).toBe("font/woff2")
    expect(mimeFromPath("assets/legacy.woff")).toBe("font/woff")
    expect(mimeFromPath("assets/app.js.map")).toBe("application/json; charset=utf-8")
  })

  // The one value conflict between the three tables: static-web said
  // `image/x-icon`, this table said `image/vnd.microsoft.icon`. The IANA
  // registration wins (an `x-` type is by definition unregistered), and it is
  // what the widest table already served. Pinned so the fold's choice is a
  // decision on record rather than an accident of which file survived.
  test("maps .ico to the IANA-registered type, not the legacy x- one", () => {
    expect(mimeFromPath("favicon.ico")).toBe("image/vnd.microsoft.icon")
    expect(mimeFromPath("favicon.ico")).not.toBe("image/x-icon")
  })
})
