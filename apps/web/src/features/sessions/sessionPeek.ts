// Pure decoder for the POST /sessions/:id/peek body. A cast would assert the
// wire shape without checking it (contracts decode at the boundary), so the
// route hands the decoded `unknown` here instead.

const trimmed = (raw: unknown): string => (typeof raw === "string" ? raw.trim() : "")

/**
 * The peek summary to show, or "(empty)" when the daemon answered with no
 * usable summary — an absent, non-string or blank field all read the same to a
 * reader, so they collapse to one placeholder.
 */
export const parsePeekSummary = (raw: unknown): string => {
  const summary = typeof raw === "object" && raw !== null && "summary" in raw ? raw.summary : null
  return trimmed(summary) || "(empty)"
}
