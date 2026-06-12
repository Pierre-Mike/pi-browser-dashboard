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

const PALETTE: Record<SessionStateValue, Tone> = {
  blocked: {
    bg: "bg-amber-100 dark:bg-amber-900/30",
    text: "text-amber-900 dark:text-amber-200",
    dot: "bg-amber-500",
    ring: "ring-amber-300/40",
    label: "Blocked",
  },
  needs_input: {
    bg: "bg-amber-100 dark:bg-amber-900/30",
    text: "text-amber-900 dark:text-amber-200",
    dot: "bg-amber-500",
    ring: "ring-amber-300/40",
    label: "Needs input",
  },
  working: {
    bg: "bg-sky-100 dark:bg-sky-900/30",
    text: "text-sky-900 dark:text-sky-200",
    dot: "bg-sky-500 animate-pulse",
    ring: "ring-sky-300/40",
    label: "Working",
  },
  idle: {
    bg: "bg-slate-200 dark:bg-slate-800",
    text: "text-slate-700 dark:text-slate-300",
    dot: "bg-slate-400",
    ring: "ring-slate-300/40",
    label: "Idle",
  },
  done: {
    bg: "bg-emerald-100 dark:bg-emerald-900/30",
    text: "text-emerald-900 dark:text-emerald-200",
    dot: "bg-emerald-500",
    ring: "ring-emerald-300/40",
    label: "Done",
  },
  failed: {
    bg: "bg-rose-100 dark:bg-rose-900/30",
    text: "text-rose-900 dark:text-rose-200",
    dot: "bg-rose-500",
    ring: "ring-rose-300/40",
    label: "Failed",
  },
  stopped: {
    bg: "bg-slate-300 dark:bg-slate-700",
    text: "text-slate-800 dark:text-slate-200",
    dot: "bg-slate-500",
    ring: "ring-slate-400/40",
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
