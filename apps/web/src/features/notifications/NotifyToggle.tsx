import { useState } from "react"
import {
  notifyEnabled,
  notifyPermission,
  notifySupported,
  requestNotifyPermission,
  setNotifyEnabled,
} from "./notifier"

// Header bell that opts the browser into session-end desktop notifications.
// First enable triggers the permission prompt; the choice persists in
// localStorage and is read back by the SSE handler via notifyEnabled().
export const NotifyToggle = () => {
  const [enabled, setEnabled] = useState(() => notifyEnabled())
  const [denied, setDenied] = useState(() => notifyPermission() === "denied")

  if (!notifySupported()) return null

  const toggle = async (): Promise<void> => {
    if (enabled) {
      setNotifyEnabled(false)
      setEnabled(false)
      return
    }
    const perm = await requestNotifyPermission()
    if (perm !== "granted") {
      setDenied(perm === "denied")
      setNotifyEnabled(false)
      setEnabled(false)
      return
    }
    setNotifyEnabled(true)
    setEnabled(true)
  }

  const title = denied
    ? "Notifications are blocked in your browser settings"
    : enabled
      ? "Session-end notifications on — click to mute"
      : "Notify me when a session ends"

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={denied}
      data-testid="notify-toggle"
      aria-pressed={enabled}
      aria-label={title}
      title={title}
      className={`btn btn-ghost btn-xs btn-circle shrink-0 text-[11px] ${
        enabled ? "text-primary" : "text-base-content/40 hover:text-primary"
      } ${denied ? "opacity-40 cursor-not-allowed" : ""}`}
    >
      {enabled ? "🔔" : "🔕"}
    </button>
  )
}
