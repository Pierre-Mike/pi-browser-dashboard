// Inline failure line for the spawn modal. A dispatch that never started
// (pi died on launch, daemon unreachable) must be visible right where the
// user clicked Spawn — not only in the devtools console.
export const SpawnErrorNotice = ({ message }: { message: string | null }) => {
  if (!message) return null
  return (
    <p data-testid="spawn-error" role="alert" className="text-[11px] text-error break-words">
      {message}
    </p>
  )
}
