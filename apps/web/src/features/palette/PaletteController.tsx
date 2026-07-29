import { useNavigate } from "@tanstack/react-router"
import { useEffect, useMemo, useRef, useState } from "react"
import { themeCommandFor } from "../../lib/ui/theme.core"
import { useTheme } from "../../lib/ui/useTheme"
import { useProjects } from "../projects/useProjects"
import { PaletteModal } from "./PaletteModal"
import { installPalette, type PaletteEntry, type PaletteHandle } from "./palette"

export const PaletteController = () => {
  const projectsQ = useProjects()
  const navigate = useNavigate()
  const theme = useTheme()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [entries, setEntries] = useState<ReadonlyArray<PaletteEntry>>([])
  const handleRef = useRef<PaletteHandle | null>(null)
  // The handle is installed once, so its closures would capture the *first*
  // render's choice; `setFamily`/`setMode` are stable but the choice they build
  // on is not. A ref refreshed every render is what makes "next family" advance
  // from what is actually active rather than from whatever was active at mount.
  const choiceRef = useRef(theme.choice)
  choiceRef.current = theme.choice

  if (!handleRef.current) {
    handleRef.current = installPalette({
      onSelectProject: (p) => {
        setOpen(false)
        setQuery("")
        void navigate({ to: "/projects/$id", params: { id: p.id } })
      },
      onRunAction: (id) => {
        setOpen(false)
        setQuery("")
        const command = themeCommandFor({ id, current: choiceRef.current })
        if (command === null) return
        if ("family" in command) theme.setFamily(command.family)
        else theme.setMode(command.mode)
      },
    })
  }

  const handle = handleRef.current
  const projects = useMemo(() => projectsQ.data ?? [], [projectsQ.data])

  useEffect(() => {
    handle.setProjects(projects)
    if (open) setEntries(handle.getEntries(query))
  }, [projects, handle, open, query])

  useEffect(() => {
    if (open) setEntries(handle.getEntries(query))
  }, [query, open, handle])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (handle.isOpen()) {
        if (e.key === "Escape") {
          handle.esc()
          setOpen(false)
          return
        }
        return
      }
      if (e.key === "Shift") {
        handle.tap(Date.now(), {
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          altKey: e.altKey,
        })
        if (handle.isOpen()) {
          setQuery("")
          setEntries(handle.getEntries(""))
          setOpen(true)
        }
      } else {
        handle.nonShiftKey()
      }
    }
    document.addEventListener("keydown", onKey, true)
    return () => document.removeEventListener("keydown", onKey, true)
  }, [handle])

  useEffect(() => () => handle.dispose(), [handle])

  return (
    <PaletteModal
      open={open}
      entries={entries}
      query={query}
      onQueryChange={setQuery}
      onSelect={(i) => handle.selectRowAt(i)}
      onClose={() => {
        handle.esc()
        setOpen(false)
      }}
    />
  )
}
