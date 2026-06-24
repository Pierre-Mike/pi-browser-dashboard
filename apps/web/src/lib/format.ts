import type { SessionStateValue } from "./types"

export const ageStr = (iso: string): string => {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return "?"
  const diff = Math.max(0, Date.now() - t)
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  return `${d}d`
}

export const cwdTail = (cwd: string, n = 2): string => {
  const parts = cwd.split("/").filter(Boolean)
  if (parts.length <= n) return cwd
  return parts.slice(-n).join("/")
}

type Tone = { bg: string; text: string; dot: string; ring: string; label: string }

// Status tones ride daisyUI semantic state tokens so they adapt across the
// pidlight/piddark themes with no hand-written `dark:` pairs:
//   blocked / needs_input → warning   working → info
//   done → success                    failed → error
//   idle / stopped        → base / neutral (muted, non-alarming)
const PALETTE: Record<SessionStateValue, Tone> = {
  blocked: {
    bg: "bg-warning/15",
    text: "text-warning",
    dot: "bg-warning",
    ring: "ring-warning/40",
    label: "Blocked",
  },
  needs_input: {
    bg: "bg-warning/15",
    text: "text-warning",
    dot: "bg-warning",
    ring: "ring-warning/40",
    label: "Needs input",
  },
  working: {
    bg: "bg-info/15",
    text: "text-info",
    dot: "bg-info animate-pulse",
    ring: "ring-info/40",
    label: "Working",
  },
  idle: {
    bg: "bg-base-300",
    text: "text-base-content/70",
    dot: "bg-base-content/40",
    ring: "ring-base-content/20",
    label: "Idle",
  },
  done: {
    bg: "bg-success/15",
    text: "text-success",
    dot: "bg-success",
    ring: "ring-success/40",
    label: "Done",
  },
  failed: {
    bg: "bg-error/15",
    text: "text-error",
    dot: "bg-error",
    ring: "ring-error/40",
    label: "Failed",
  },
  stopped: {
    bg: "bg-neutral/20",
    text: "text-base-content",
    dot: "bg-base-content/60",
    ring: "ring-base-content/30",
    label: "Stopped",
  },
}

export const stateColor = (state: SessionStateValue): Tone => PALETTE[state] ?? PALETTE.idle

// Hover tooltip for a session row: the status label, plus its detail when present.
// Lets the sidebar lean on colour for the at-a-glance signal while keeping the
// word ("Done", "Failed", …) one hover away.
export const stateTitle = (state: SessionStateValue, detail: string): string => {
  const label = stateColor(state).label
  const d = detail.trim()
  return d ? `${label} — ${d}` : label
}
