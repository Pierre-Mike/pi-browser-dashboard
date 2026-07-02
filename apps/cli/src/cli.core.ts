// Pure argv parsing for the pid-dashboard CLI. No I/O — main.ts (the
// imperative shell) consumes the result to start the daemon and open a
// browser tab.

export type CliOptions = {
  readonly port: number
  readonly open: boolean
  readonly help: boolean
}

export const DEFAULT_CLI_OPTIONS: CliOptions = { port: 8787, open: true, help: false }

const parsePort = (raw: string | undefined): number | null => {
  if (raw === undefined) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

// Find the raw --port value, whether given as "--port 4000", "-p 4000", or
// "--port=4000". Flags are independent (a CLI this small doesn't need
// stateful positional parsing), so each option is found by a single scan.
const findPortValue = (argv: readonly string[]): string | undefined => {
  const inline = argv.find((a) => a.startsWith("--port="))
  if (inline !== undefined) return inline.slice("--port=".length)
  const idx = argv.findIndex((a) => a === "--port" || a === "-p")
  return idx === -1 ? undefined : argv[idx + 1]
}

// argv is process.argv.slice(2). Unknown flags are ignored (kept liberal —
// this is a single-purpose CLI, not a general-purpose arg parser).
export const parseCliArgs = (argv: readonly string[]): CliOptions => ({
  port: parsePort(findPortValue(argv)) ?? DEFAULT_CLI_OPTIONS.port,
  open: !argv.includes("--no-open"),
  help: argv.includes("--help") || argv.includes("-h"),
})
