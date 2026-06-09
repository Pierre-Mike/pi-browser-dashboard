import type { NotifyPayload } from "./sessionNotify"

// Imperative shell around the Web Notifications API + a localStorage opt-in.
// The pure decision lives in sessionNotify.ts; this module only touches the
// browser. Everything degrades to a no-op when Notification is unavailable or
// the user hasn't opted in, so it is safe to call unconditionally.

const PREF_KEY = "pid:notify-enabled"

export const notifySupported = (): boolean =>
  typeof window !== "undefined" && "Notification" in window

export const notifyPermission = (): NotificationPermission =>
  notifySupported() ? Notification.permission : "denied"

export const notifyEnabled = (): boolean => {
  if (!notifySupported() || Notification.permission !== "granted") return false
  try {
    return window.localStorage.getItem(PREF_KEY) === "1"
  } catch {
    return false
  }
}

export const setNotifyEnabled = (on: boolean): void => {
  try {
    window.localStorage.setItem(PREF_KEY, on ? "1" : "0")
  } catch {
    // Ignore private-mode / disabled storage — the toggle just won't persist.
  }
}

export const requestNotifyPermission = async (): Promise<NotificationPermission> => {
  if (!notifySupported()) return "denied"
  if (Notification.permission !== "default") return Notification.permission
  try {
    return await Notification.requestPermission()
  } catch {
    return "denied"
  }
}

export const showNotification = (payload: NotifyPayload): void => {
  if (!notifySupported() || Notification.permission !== "granted") return
  try {
    // eslint-disable-next-line no-new -- fire-and-forget; the OS owns the lifecycle
    new Notification(payload.title, { body: payload.body, tag: payload.tag })
  } catch {
    // Some browsers throw if invoked outside a user gesture / from an
    // unsupported context; a missed notification is non-fatal.
  }
}
