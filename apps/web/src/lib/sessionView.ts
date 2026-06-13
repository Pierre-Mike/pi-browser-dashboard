// Maps a session query's react-query state to a renderable view state. The
// session queryFn resolves to `null` on a non-OK response (e.g. a 404 for an
// invalid id), so `isLoading` is false while `data` is null — without this
// distinction the drill-in shows "Loading session…" forever and keeps the live
// action bar enabled against a phantom session. Mirrors the project route's
// not-found handling.
export type SessionViewState = "loading" | "not-found" | "ready"

export const resolveSessionView = ({
  isLoading,
  data,
}: {
  isLoading: boolean
  data: unknown
}): SessionViewState => {
  if (isLoading) return "loading"
  if (data === null || data === undefined) return "not-found"
  return "ready"
}
