import { useEffect, useState } from "react"
import { apiBase } from "../../lib/apiBase"
import { handleDrop } from "./handleDrop"
import { uploadFile } from "./uploadFile"

const API_BASE = apiBase()

type Toast = { readonly id: number; readonly text: string; readonly kind: "ok" | "err" }

const containsFiles = (e: DragEvent): boolean => {
  const types = e.dataTransfer?.types
  if (!types) return false
  for (let i = 0; i < types.length; i++) {
    if (types[i] === "Files") return true
  }
  return false
}

export const DropZone = () => {
  const [dragActive, setDragActive] = useState(false)
  const [toasts, setToasts] = useState<ReadonlyArray<Toast>>([])

  useEffect(() => {
    let depth = 0

    const pushToast = (text: string, kind: "ok" | "err") => {
      const id = Date.now() + Math.random()
      setToasts((prev) => [...prev, { id, text, kind }])
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500)
    }

    const onDragEnter = (e: DragEvent) => {
      if (!containsFiles(e)) return
      e.preventDefault()
      depth++
      setDragActive(true)
    }
    const onDragOver = (e: DragEvent) => {
      if (!containsFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"
    }
    const onDragLeave = (e: DragEvent) => {
      if (!containsFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragActive(false)
    }
    const onDrop = (e: DragEvent) => {
      if (!containsFiles(e)) return
      e.preventDefault()
      depth = 0
      setDragActive(false)
      const fileList = e.dataTransfer?.files
      if (!fileList || fileList.length === 0) return
      const files = Array.from(fileList)
      void (async () => {
        const result = await handleDrop(files, {
          upload: (f) => uploadFile(f, { baseUrl: API_BASE }),
          clipboard: navigator.clipboard,
        })
        if (result.paths.length > 0) {
          pushToast(
            result.paths.length === 1
              ? "Uploaded — path copied"
              : `Uploaded ${result.paths.length} files — paths copied`,
            "ok",
          )
        }
        for (const err of result.errors) {
          pushToast(`${err.fileName}: ${err.message}`, "err")
        }
      })()
    }

    window.addEventListener("dragenter", onDragEnter)
    window.addEventListener("dragover", onDragOver)
    window.addEventListener("dragleave", onDragLeave)
    window.addEventListener("drop", onDrop)
    return () => {
      window.removeEventListener("dragenter", onDragEnter)
      window.removeEventListener("dragover", onDragOver)
      window.removeEventListener("dragleave", onDragLeave)
      window.removeEventListener("drop", onDrop)
    }
  }, [])

  return (
    <>
      {dragActive ? (
        <div
          data-testid="dropzone-overlay"
          className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-primary/10 border-4 border-dashed border-primary/30"
        >
          <div className="rounded-md bg-primary/90 px-4 py-2 text-white text-sm font-medium shadow-xl">
            Drop to upload — path will be copied and inserted
          </div>
        </div>
      ) : null}
      <div
        data-testid="dropzone-toasts"
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`rounded-md shadow-lg px-3 py-2 text-xs font-medium text-white ${
              t.kind === "ok" ? "bg-success" : "bg-error"
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </>
  )
}
