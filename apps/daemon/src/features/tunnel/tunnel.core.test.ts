import { describe, expect, it } from "bun:test"
import {
  carryTail,
  parseTunnelUrl,
  STOPPED,
  scanForUrl,
  tunnelHost,
  URL_CARRY_CHARS,
} from "./tunnel.core"

describe("carryTail", () => {
  it("keeps everything while under the cap", () => {
    expect(carryTail({ tail: "abc", chunk: "def", maxChars: 10 })).toBe("abcdef")
  })

  it("keeps the LAST maxChars once over the cap, so the newest output survives", () => {
    expect(carryTail({ tail: "abcdef", chunk: "ghij", maxChars: 4 })).toBe("ghij")
  })

  it("bounds the buffer no matter how much output arrives", () => {
    // The regression this exists for: cloudflared logs for the daemon's whole
    // life, and the watcher used to append every chunk to one string and re-scan
    // all of it per chunk — unbounded memory and quadratic CPU.
    let carry = ""
    for (let i = 0; i < 5_000; i++) {
      carry = carryTail({ tail: carry, chunk: `INF line ${i} noise\n`, maxChars: URL_CARRY_CHARS })
    }
    expect(carry.length).toBeLessThanOrEqual(URL_CARRY_CHARS)
  })

  it("still finds a URL split across two reads", () => {
    // The only reason to carry anything at all: cloudflared's banner can land
    // in two pipe reads with the hostname straddling the boundary.
    const url = "https://brave-cat-runs-fast.trycloudflare.com"
    const first = carryTail({
      tail: "",
      chunk: `INF |  ${url.slice(0, 20)}`,
      maxChars: URL_CARRY_CHARS,
    })
    expect(parseTunnelUrl(first)).toBeNull()
    const second = carryTail({
      tail: first,
      chunk: `${url.slice(20)}  |`,
      maxChars: URL_CARRY_CHARS,
    })
    expect(parseTunnelUrl(second)).toBe(url)
  })

  it("does not truncate the chunk it is scanning", () => {
    // The bug this pins: bounding the buffer BEFORE the scan drops a URL that
    // arrives at the front of a large read, and the tunnel then reports
    // "timed out waiting for tunnel URL" while cloudflared is up and serving.
    const url = "https://brave-cat-runs-fast.trycloudflare.com"
    const bigChunk = `INF |  ${url}  |\n${"INF Registered tunnel connection\n".repeat(500)}`
    expect(bigChunk.length).toBeGreaterThan(URL_CARRY_CHARS)
    const scan = scanForUrl({ carry: "", chunk: bigChunk, maxChars: URL_CARRY_CHARS })
    expect(scan.url).toBe(url)
    expect(scan.carry.length).toBeLessThanOrEqual(URL_CARRY_CHARS)
  })

  it("carries enough for a URL that straddles a boundary after heavy logging", () => {
    const url = "https://brave-cat-runs-fast.trycloudflare.com"
    let carry = ""
    for (let i = 0; i < 200; i++) {
      carry = carryTail({ tail: carry, chunk: `INF connection ${i}\n`, maxChars: URL_CARRY_CHARS })
    }
    carry = carryTail({ tail: carry, chunk: url.slice(0, 30), maxChars: URL_CARRY_CHARS })
    carry = carryTail({ tail: carry, chunk: url.slice(30), maxChars: URL_CARRY_CHARS })
    expect(parseTunnelUrl(carry)).toBe(url)
  })
})

describe("parseTunnelUrl", () => {
  it("extracts the trycloudflare URL from a cloudflared stderr banner", () => {
    const banner = [
      "2024-01-01T00:00:00Z INF Requesting new quick Tunnel on trycloudflare.com...",
      "2024-01-01T00:00:00Z INF +--------------------------------------------------------+",
      "2024-01-01T00:00:00Z INF |  https://brave-cat-runs-fast.trycloudflare.com         |",
      "2024-01-01T00:00:00Z INF +--------------------------------------------------------+",
    ].join("\n")
    expect(parseTunnelUrl(banner)).toBe("https://brave-cat-runs-fast.trycloudflare.com")
  })

  it("returns the first URL when several are present", () => {
    const s = "https://aaa.trycloudflare.com then https://bbb.trycloudflare.com"
    expect(parseTunnelUrl(s)).toBe("https://aaa.trycloudflare.com")
  })

  it("returns null before any URL is logged", () => {
    expect(parseTunnelUrl("INF Requesting new quick Tunnel on trycloudflare.com...")).toBeNull()
  })

  it("ignores non-trycloudflare https URLs", () => {
    expect(parseTunnelUrl("see https://example.com for details")).toBeNull()
  })
})

describe("tunnelHost", () => {
  it("returns the lowercased host", () => {
    expect(tunnelHost("https://Brave-Cat.trycloudflare.com")).toBe("brave-cat.trycloudflare.com")
  })

  it("returns null for a non-URL", () => {
    expect(tunnelHost("not a url")).toBeNull()
  })
})

describe("STOPPED", () => {
  it("is the stopped sentinel", () => {
    expect(STOPPED).toEqual({ status: "stopped", url: null })
  })
})

describe("scanForUrl", () => {
  it("finds a URL split across two reads and keeps the carry bounded", () => {
    const url = "https://brave-cat-runs-fast.trycloudflare.com"
    const first = scanForUrl({
      carry: "",
      chunk: `INF |  ${url.slice(0, 20)}`,
      maxChars: URL_CARRY_CHARS,
    })
    expect(first.url).toBeNull()
    const second = scanForUrl({
      carry: first.carry,
      chunk: `${url.slice(20)}  |`,
      maxChars: URL_CARRY_CHARS,
    })
    expect(second.url).toBe(url)
  })

  it("stays bounded across an unbounded log stream", () => {
    let carry = ""
    for (let i = 0; i < 5_000; i++) {
      const scan = scanForUrl({
        carry,
        chunk: `INF connection ${i} noise\n`,
        maxChars: URL_CARRY_CHARS,
      })
      expect(scan.url).toBeNull()
      carry = scan.carry
      expect(carry.length).toBeLessThanOrEqual(URL_CARRY_CHARS)
    }
  })
})
