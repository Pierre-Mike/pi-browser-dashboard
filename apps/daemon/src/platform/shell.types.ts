// Command shapes for the shell-out service. These are plain data, so they live
// outside shell.io.ts: a *.core.ts may not import a *.io module (the functional
// core must not depend on the imperative shell), and the pure dispatch core
// needs to name the payload it builds. Types-only module — nothing to test.

export type DispatchInput = {
  readonly intent: string
  readonly cwd?: string
  readonly agent?: string
  readonly permissionMode?: string
  readonly effort?: string
  readonly model?: string
  // Explicit built-in tool allow-list for `--tools`. Undefined means "every
  // tool" (the CLI's own default, so we omit the flag entirely); an empty
  // array is a deliberate "disable every tool" request (`--tools ""`).
  readonly tools?: readonly string[]
}
