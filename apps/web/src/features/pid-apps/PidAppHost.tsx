import { apiBase } from "../../lib/apiBase"
import { pidAppSrc } from "./pidApps"

const base = apiBase()

type Props = {
  projectId: string
  appId: string
}

/**
 * Renders a discovered pid-app in a sandboxed iframe. The HTML is untrusted —
 * anyone can drop it into the project's `.pid/` — so the frame runs with
 * `sandbox="allow-scripts"` and nothing else: an opaque origin with no access to
 * the parent page's DOM, storage, or cookies, and intentionally no
 * postMessage/RPC wiring. Assets load from the daemon origin via
 * `pidAppSrc`/`apiBase`, so the frame works over the Cloudflare tunnel.
 */
export const PidAppHost = ({ projectId, appId }: Props) => (
  <iframe
    src={pidAppSrc(base, { projectId, appId })}
    title={`pid-app: ${appId}`}
    sandbox="allow-scripts"
    data-testid={`pid-app-host-${appId}`}
    className="w-full h-full border-0"
  />
)
