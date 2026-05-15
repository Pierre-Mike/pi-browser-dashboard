import { homedir } from "node:os"
import { join } from "node:path"

/**
 * @deprecated Use ConfigService.get().claudeConfigDir instead.
 * Kept for backward compatibility with existing call-sites.
 */
export const resolveConfigDir = (): string =>
  process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude")
