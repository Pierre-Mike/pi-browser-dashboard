import { describe, expect, it } from "bun:test"
import { parseAllowedHosts, TRYCLOUDFLARE_HOST } from "./allowedHosts"

describe("parseAllowedHosts", () => {
  it("always allows the Cloudflare quick-tunnel apex as a subdomain wildcard", () => {
    expect(parseAllowedHosts()).toEqual([TRYCLOUDFLARE_HOST])
    // Leading dot = match the domain and every subdomain (random quick-tunnel names).
    expect(TRYCLOUDFLARE_HOST).toBe(".trycloudflare.com")
  })

  it("covers a random quick-tunnel hostname via the wildcard entry", () => {
    const hosts = parseAllowedHosts()
    const host = "large-citizen-shares-tahoe.trycloudflare.com"
    const matched = hosts.some((h) => host === h || host === h.slice(1) || host.endsWith(h))
    expect(matched).toBe(true)
  })

  it("appends comma-separated PID_ALLOWED_HOSTS, trimmed", () => {
    expect(parseAllowedHosts({ PID_ALLOWED_HOSTS: "foo.example.com, bar.test " })).toEqual([
      TRYCLOUDFLARE_HOST,
      "foo.example.com",
      "bar.test",
    ])
  })

  it("ignores empty/whitespace-only entries", () => {
    expect(parseAllowedHosts({ PID_ALLOWED_HOSTS: " , ,, " })).toEqual([TRYCLOUDFLARE_HOST])
  })

  it("dedupes repeated hosts", () => {
    expect(parseAllowedHosts({ PID_ALLOWED_HOSTS: ".trycloudflare.com, dup, dup" })).toEqual([
      TRYCLOUDFLARE_HOST,
      "dup",
    ])
  })
})
