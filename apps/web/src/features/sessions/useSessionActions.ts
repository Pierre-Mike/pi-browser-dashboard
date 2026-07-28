import { type QueryClient, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { api } from "../../lib/api"
import type { SessionState } from "../../lib/types"
import { parsePeekSummary } from "./sessionPeek"

// A double-click guard, not a UX delay: the second Delete press inside this
// window is the confirmation, after which the button disarms itself.
const CONFIRM_TIMEOUT_MS = 3_000
const COPIED_TIMEOUT_MS = 1_000

export type SessionActionFlags = {
  readonly copied: boolean
  readonly peeking: boolean
  readonly stopping: boolean
  readonly deleting: boolean
  readonly confirmDelete: boolean
  readonly canStop: boolean
}

export type SessionActionHandlers = {
  readonly copy: () => void
  readonly peek: () => void
  readonly stop: () => void
  readonly delete: () => void
  readonly cancelConfirm: () => void
}

export type SessionActions = {
  readonly flags: SessionActionFlags
  readonly on: SessionActionHandlers
  readonly peekSummary: string | null
}

type Setter<T> = (next: T) => void

const post = ({ path, id }: { path: "stop" | "rm" | "peek"; id: string }): Promise<Response> =>
  // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
  (api as any).sessions[":id"][path].$post({ param: { id } })

// Each request lives at module scope rather than inside the hook: a closure
// declared in the hook body counts toward the hook's own complexity, and these
// are the branchy parts (guard, await, catch, finally).
const runCopy = async ({ id, setCopied }: { id: string; setCopied: Setter<boolean> }) => {
  try {
    await navigator.clipboard.writeText(`claude attach ${id}`)
    setCopied(true)
    setTimeout(() => setCopied(false), COPIED_TIMEOUT_MS)
  } catch (err) {
    console.error("clipboard write failed", err)
  }
}

const runPeek = async ({
  id,
  setPeeking,
  setPeekSummary,
}: {
  id: string
  setPeeking: Setter<boolean>
  setPeekSummary: Setter<string>
}) => {
  setPeeking(true)
  try {
    const res = await post({ path: "peek", id })
    if (!res.ok) throw new Error(`peek: HTTP ${res.status}`)
    setPeekSummary(parsePeekSummary(await res.json()))
  } catch (err) {
    console.error("peek failed", err)
    setPeekSummary("peek failed")
  } finally {
    setPeeking(false)
  }
}

const runStop = async ({
  id,
  qc,
  setStopping,
}: {
  id: string
  qc: QueryClient
  setStopping: Setter<boolean>
}) => {
  setStopping(true)
  try {
    await post({ path: "stop", id })
    qc.invalidateQueries({ queryKey: ["sessions"] })
    qc.invalidateQueries({ queryKey: ["sessions", id] })
  } catch (err) {
    console.error("stop failed", err)
  } finally {
    setStopping(false)
  }
}

const runDelete = async ({
  id,
  qc,
  setDeleting,
}: {
  id: string
  qc: QueryClient
  setDeleting: Setter<boolean>
}) => {
  setDeleting(true)
  try {
    const res = await post({ path: "rm", id })
    if (!res.ok) console.error("delete failed", await res.text())
    qc.invalidateQueries({ queryKey: ["sessions"] })
  } catch (err) {
    console.error("delete failed", err)
  } finally {
    setDeleting(false)
  }
}

// Owns the drill-in's action state and the daemon calls behind each button, so
// the route component stays a thin composition of topbar + panel.
export const useSessionActions = ({
  id,
  session,
}: {
  readonly id: string
  readonly session: SessionState | null | undefined
}): SessionActions => {
  const qc = useQueryClient()
  const [copied, setCopied] = useState(false)
  const [peeking, setPeeking] = useState(false)
  const [peekSummary, setPeekSummary] = useState<string | null>(null)
  const [stopping, setStopping] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => clearTimeout(confirmTimerRef.current ?? undefined), [])

  const cancelConfirm = () => {
    clearTimeout(confirmTimerRef.current ?? undefined)
    confirmTimerRef.current = null
    setConfirmDelete(false)
  }

  const arm = () => {
    setConfirmDelete(true)
    confirmTimerRef.current = setTimeout(() => setConfirmDelete(false), CONFIRM_TIMEOUT_MS)
  }

  // Delete is two-step: the first press arms, the second commits.
  const onDelete = () => {
    if (deleting) return
    if (!confirmDelete) return arm()
    cancelConfirm()
    runDelete({ id, qc, setDeleting })
  }

  return {
    flags: {
      copied,
      peeking,
      stopping,
      deleting,
      confirmDelete,
      canStop: !stopping && !!session && session.state !== "stopped" && session.state !== "done",
    },
    on: {
      copy: () => runCopy({ id, setCopied }),
      peek: () => (peeking ? undefined : runPeek({ id, setPeeking, setPeekSummary })),
      stop: () => (stopping ? undefined : runStop({ id, qc, setStopping })),
      delete: onDelete,
      cancelConfirm,
    },
    peekSummary,
  }
}
