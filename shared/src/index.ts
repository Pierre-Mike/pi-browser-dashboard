/**
 * Shared wire contracts — the published doors between the daemon and its
 * clients (apps/web, apps/cli, apps/e2e).
 *
 * Promote a contract here the moment a SECOND workspace needs it; until then a
 * slice keeps its types local. The rule exists because the alternative is what
 * this workspace was created to delete: hand-copied "local mirror" types that
 * drift silently. When `apps/web` mirrored the daemon's `SessionState` by hand
 * it was missing `worktreePath` and `worktreeBranch` entirely and typed nine
 * nullable fields as required `string` — the compiler had no way to notice,
 * because there was no single definition to disagree with.
 *
 * Every contract here is an effect `Schema` first and a TypeScript type
 * second (`S.Schema.Type<typeof X>`), so the same declaration both type-checks
 * a call site and decodes an untrusted response at runtime.
 */
export * from "./api-error"
export * from "./keys"
export * from "./project"
export * from "./session"
export * from "./terminal"
export * from "./timing"
export * from "./wait"
