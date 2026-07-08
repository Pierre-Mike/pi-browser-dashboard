// Pure request parsing for POST /dispatch. The route stays a thin
// json→parse→run→respond pipe; every validation branch lives here where it is
// unit-testable without a runtime.
import type { DispatchInput } from "../../platform/shell.repo"
import type { PiDispatchInput } from "./pi.repo"

export type DispatchBody = {
  readonly intent?: unknown
  readonly cwd?: unknown
  readonly harness?: unknown
  readonly agent?: unknown
  readonly permissionMode?: unknown
  readonly effort?: unknown
  readonly thinking?: unknown
  readonly model?: unknown
  readonly tools?: unknown
}

export type ParsedDispatch =
  | { readonly ok: false; readonly error: "missing_intent" | "invalid_harness" }
  | { readonly ok: true; readonly harness: "claude"; readonly claude: DispatchInput }
  | { readonly ok: true; readonly harness: "pi"; readonly pi: PiDispatchInput }

const asString = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)

// A malformed entry (wrong type, mixed array) is treated as absent rather than
// partially sanitized, so a bad request can't silently narrow the tool set to
// something the user never selected.
const asStringArray = (v: unknown): string[] | undefined =>
  Array.isArray(v) && v.every((entry) => typeof entry === "string") ? v : undefined

export const parseDispatchRequest = (body: DispatchBody): ParsedDispatch => {
  const intent = asString(body.intent)
  if (!intent || intent.trim().length === 0) {
    return { ok: false, error: "missing_intent" }
  }
  // Unlike the other optional fields, an unrecognised harness is a hard
  // failure: treating it as absent would silently spawn claude for a request
  // that asked for a different harness entirely.
  const harness = body.harness === undefined ? "claude" : body.harness
  if (harness !== "claude" && harness !== "pi") {
    return { ok: false, error: "invalid_harness" }
  }
  const cwd = asString(body.cwd)
  const model = asString(body.model)
  const tools = asStringArray(body.tools)
  if (harness === "pi") {
    return {
      ok: true,
      harness,
      pi: { intent, cwd, thinking: asString(body.thinking), model, tools },
    }
  }
  return {
    ok: true,
    harness,
    claude: {
      intent,
      cwd,
      agent: asString(body.agent),
      permissionMode: asString(body.permissionMode),
      effort: asString(body.effort),
      model,
      tools,
    },
  }
}
