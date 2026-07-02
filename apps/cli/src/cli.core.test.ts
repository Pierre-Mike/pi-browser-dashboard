import { describe, expect, it } from "bun:test"
import { DEFAULT_CLI_OPTIONS, parseCliArgs } from "./cli.core"

describe("parseCliArgs", () => {
  it("defaults to port 8787, browser open, no help", () => {
    expect(parseCliArgs([])).toEqual(DEFAULT_CLI_OPTIONS)
  })

  it("parses --port <n>", () => {
    expect(parseCliArgs(["--port", "4000"])).toEqual({ ...DEFAULT_CLI_OPTIONS, port: 4000 })
  })

  it("parses -p <n>", () => {
    expect(parseCliArgs(["-p", "4000"])).toEqual({ ...DEFAULT_CLI_OPTIONS, port: 4000 })
  })

  it("parses --port=<n>", () => {
    expect(parseCliArgs(["--port=4000"])).toEqual({ ...DEFAULT_CLI_OPTIONS, port: 4000 })
  })

  it("ignores a non-numeric --port value and keeps the default", () => {
    expect(parseCliArgs(["--port", "nope"])).toEqual(DEFAULT_CLI_OPTIONS)
  })

  it("parses --no-open", () => {
    expect(parseCliArgs(["--no-open"])).toEqual({ ...DEFAULT_CLI_OPTIONS, open: false })
  })

  it("parses --help and -h", () => {
    expect(parseCliArgs(["--help"])).toEqual({ ...DEFAULT_CLI_OPTIONS, help: true })
    expect(parseCliArgs(["-h"])).toEqual({ ...DEFAULT_CLI_OPTIONS, help: true })
  })

  it("combines multiple flags", () => {
    expect(parseCliArgs(["--port", "9999", "--no-open"])).toEqual({
      port: 9999,
      open: false,
      help: false,
    })
  })
})
