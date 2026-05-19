# dispatch

`POST /dispatch` — spawns a new background Claude Code session. Body: `{ intent, cwd?, agent?, permissionMode? }`. Validates inputs at the route, delegates to `ShellRepo.dispatch` which shells out to `claude --bg [--agent X] [--permission-mode Y] <intent>` and parses `backgrounded · <short>` from stdout. Returns `{ short }` on success or `dispatch_failed` (500) / `invalid_json|missing_intent` (400). Stateless — the supervisor mints the id; the roster watcher in `sessions/` picks the new session up.
