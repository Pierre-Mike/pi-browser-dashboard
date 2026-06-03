import { useNavigate } from "@tanstack/react-router"
import { useEffect, useMemo, useRef, useState } from "react"
import { useProjects } from "../projects/useProjects"
import { PaletteModal } from "./PaletteModal"
import { installPalette, type PaletteEntry, type PaletteHandle } from "./palette"

export const PaletteController = () => {
  const projectsQ = useProjects()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [entries, setEntries] = useState<ReadonlyArray<PaletteEntry>>([])
  const handleRef = useRef<PaletteHandle | null>(null)

  if (!handleRef.current) {
    handleRef.current = installPalette({
      onSelectProject: (p) => {
        setOpen(false)
        setQuery("")
        void navigate({ to: "/projects/$id", params: { id: p.id } })
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
