import DOMPurify from "dompurify"
import { useEffect, useId, useRef, useState } from "react"

type Props = { code: string }

let initialized = false

function initializeMermaid(mermaid: { initialize: (cfg: object) => void }) {
  if (!initialized) {
    initialized = true
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: document.documentElement.classList.contains("dark") ? "dark" : "default",
      fontFamily: "inherit",
    })
  }
}

export const MermaidView = ({ code }: Props) => {
  const rawId = useId()
  const idRef = useRef(`mermaid-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const { default: mermaid } = await import("mermaid")
        initializeMermaid(mermaid)
        const { svg } = await mermaid.render(idRef.current, code)
        if (cancelled) return
        if (hostRef.current)
          hostRef.current.innerHTML = DOMPurify.sanitize(svg, {
            USE_PROFILES: { svg: true, svgFilters: true },
          })
        setError(null)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [code])

  if (error) {
    return (
      <div
        data-testid="mermaid-error"
        className="my-3 px-3 py-2 rounded-md bg-error/15 border border-error/30 text-error text-xs font-mono whitespace-pre-wrap"
      >
        <div className="text-[10px] uppercase tracking-wide mb-1 opacity-70">mermaid error</div>
        {error}
        <pre className="mt-2 opacity-80">{code}</pre>
      </div>
    )
  }

  return (
    <div
      ref={hostRef}
      data-testid="mermaid-diagram"
      className="my-3 flex justify-center overflow-x-auto"
    />
  )
}
