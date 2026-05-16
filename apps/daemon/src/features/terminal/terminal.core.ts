// Pure helpers for the terminal feature. No I/O.

// Reduce a project id to a zellij session name. Zellij names mostly accept
// printable chars but trip on whitespace and shell-special chars, so collapse
// everything outside [a-z0-9._-] to '-'. Prefix with "pid-" so we never collide
// with the user's own zellij sessions, and cap at 64 chars (zellij's own limit
// is generous, but long names render badly in the status bar).
export const zellijSessionName = (rawId: string): string | null => {
  const cleaned = rawId
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
  if (cleaned.length === 0) return null
  return `pid-${cleaned}`.slice(0, 64)
}

// Bash-single-quote escape: wrap in single quotes, replace embedded ' with
// '\''. Safe for any byte string in a POSIX shell.
const shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

// Layout that opens a single pane running `claude`. close_on_exit lets the user
// quit claude and have the pane disappear instead of staring at a corpse.
const CLAUDE_LAYOUT = 'layout { pane command="claude" { close_on_exit true; } }'

// Bash one-liner: cd into the project, then either re-attach an existing zellij
// session by name or spawn a fresh one whose only pane runs `claude`. `exec` so
// the child slot is replaced — closing the WS kills the zellij client, but
// zellij's daemon keeps the session alive for the next attach.
export const projectZellijCommand = (args: {
  readonly cwd: string
  readonly sessionName: string
}): string => {
  const cwd = shq(args.cwd)
  const name = shq(args.sessionName)
  const layout = shq(CLAUDE_LAYOUT)
  return [
    `cd ${cwd}`,
    `if zellij list-sessions -s 2>/dev/null | grep -qx ${name}; then`,
    `  exec zellij attach ${name}`,
    `else`,
    `  exec zellij -s ${name} --layout-string ${layout}`,
    `fi`,
  ].join("\n")
}
