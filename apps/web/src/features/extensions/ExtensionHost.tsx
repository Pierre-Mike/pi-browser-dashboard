import { useEffect, useRef } from "react"
import { mountRpcBridge } from "./rpc"
import type { ExtensionManifest } from "./types"

const base = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8787"

type Props = {
  manifest: ExtensionManifest
  projectId?: string
  cwd?: string
}

/**
 * Renders a sandboxed iframe for an iframe-tier extension and wires
 * the postMessage RPC bridge on mount. Cleans up on unmount.
 *
 * The bridge re-mounts whenever `manifest.granted` changes so a freshly-
 * granted capability takes effect without a page reload.
 */
export const ExtensionHost = ({ manifest, projectId, cwd }: Props) => {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const src = `${base}/extensions/${manifest.name}/index.html`
  // Stable string key so the effect dependency comparison works correctly.
  const grantedKey = manifest.granted.slice().sort().join(",")

  // biome-ignore lint/correctness/useExhaustiveDependencies: grantedKey is a derived value included on purpose so the bridge re-mounts when manifest.granted changes.
  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return

    // Attach the message listener immediately — NOT on the iframe's "load"
    // event. The framed extension may post its first RPC during parse, which
    // happens before the parent's "load" handler would run; waiting would drop
    // those messages. The listener only reads event.source/contentWindow when a
    // message actually arrives (by which point the frame has loaded), so early
    // attachment is safe.
    const bridge = mountRpcBridge(iframe, manifest, { projectId, cwd }, manifest.granted)
    return () => bridge.destroy()
  }, [manifest, projectId, cwd, grantedKey])

  return (
    <iframe
      ref={iframeRef}
      src={src}
      title={`Extension: ${manifest.name}`}
      // allow-scripts: extension JS runs; allow-same-origin omitted so
      // the iframe cannot access the parent's DOM/storage.
      sandbox="allow-scripts"
      data-testid={`extension-host-${manifest.name}`}
      data-extension={manifest.name}
      className="w-full h-full border-0 rounded"
    />
  )
}
