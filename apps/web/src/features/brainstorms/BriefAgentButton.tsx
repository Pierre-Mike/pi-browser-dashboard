import { useState } from "react"
import { api } from "../../lib/api"
import { briefingMessage, type CanvasFormat } from "../canvas/canvasBriefing"

type Props = {
  readonly short: string
  // ABSOLUTE path on the daemon's disk. The agent runs there, so a
  // worktree-relative path would send it looking in its own cwd.
  readonly file: string
  readonly format: CanvasFormat
}

const STATUS_CLEAR_MS = 4_000

// Both status strings are derived out of line, so the send itself stays a plain
// try/catch — the audit's complexity gate counts every inline ternary.
const sentText = (res: { readonly ok: boolean; readonly status: number }): string =>
  res.ok ? "sent — see the terminal" : `failed: HTTP ${res.status}`

const failedText = (err: unknown): string =>
  `failed: ${err instanceof Error ? err.message : "unknown"}`

/**
 * Sends this session's agent one message: a brainstorm board is open beside your
 * terminal, here is its path and its on-disk shape.
 *
 * This is what replaced the board's own docked terminal. That panel attached the
 * *same* pty a second time purely so the user could type this message by hand —
 * so once the drill-in's terminal became permanent, the panel's only remaining
 * job was this button, and the button costs no width.
 *
 * It works for every board kind because `format` is resolved from the board
 * (see briefFormatFor): the three encodings look alike from the outside, and
 * naming the wrong one makes the agent write a file the editor cannot decode.
 */
export const BriefAgentButton = ({ short, file, format }: Props) => {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const brief = async () => {
    if (busy) return
    setBusy(true)
    setStatus("briefing…")
    try {
      // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
      const client = api as any
      const res = await client.sessions[":id"].send.$post({
        param: { id: short },
        json: { keys: `${briefingMessage({ path: file, format })}\r` },
      })
      setStatus(sentText(res))
    } catch (err) {
      setStatus(failedText(err))
    } finally {
      setBusy(false)
      setTimeout(() => setStatus(null), STATUS_CLEAR_MS)
    }
  }

  return (
    <span className="flex min-w-0 items-center gap-2">
      <button
        type="button"
        data-testid="brainstorm-brief-ai"
        onClick={() => void brief()}
        disabled={busy}
        className="btn btn-xs normal-case border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40"
        title="Tell this session's agent where the board is, so it can read and write it live"
      >
        {busy ? "Briefing…" : "Brief AI"}
      </button>
      {status ? (
        <span
          data-testid="brainstorm-brief-status"
          className={`truncate font-mono text-[10px] ${
            status.startsWith("failed") ? "text-error" : "text-success"
          }`}
        >
          {status}
        </span>
      ) : null}
    </span>
  )
}
