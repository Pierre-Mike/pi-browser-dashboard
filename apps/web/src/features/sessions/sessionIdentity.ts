// Pure naming rule for the drill-in's h1: which string is the title, and whether
// the short id still earns its own chip beside it.

export type Identity = {
  /** The title text. Never blank. */
  readonly label: string
  /** The short-id chip, or null when the title already IS the short id. */
  readonly chip: string | null
}

/**
 * A named session shows its name with the short id as a chip. An unnamed one is
 * titled by its short id instead — repeating that id in a chip beside itself
 * reads as a duplicate, so the chip drops out.
 *
 * `name` is typed optional on purpose: `SessionState.name` claims `string`, but
 * the daemon omits the field entirely for a session that has never been named,
 * so a `.trim()` on the declared type crashes the whole drill-in.
 */
export const sessionIdentity = ({
  name,
  short,
}: {
  readonly name?: string | undefined
  readonly short: string
}): Identity => {
  const label = typeof name === "string" ? name.trim() : ""
  return label && label !== short ? { label, chip: short } : { label: short, chip: null }
}
