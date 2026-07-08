import {
  buildPiSpawnCommandArgs,
  buildSpawnCommandArgs,
  formatSpawnCommand,
} from "./spawnCommandArgs"
import type { SpawnHarness } from "./spawnHarness"

type Props = {
  harness: SpawnHarness
  intent: string
  effort?: string
  thinking?: string
  model?: string
  tools?: readonly string[]
  cwd?: string
}

// Collapsible readout of the literal argv the daemon will spawn on submit —
// `claude --bg ...` or `pi -p ...` depending on the active harness tab — so
// the user can check flags/tools/intent before firing it off. Collapsed by
// default, mirroring SpawnToolPicker/SpawnSkillPicker.
export const SpawnCommandPreview = ({
  harness,
  intent,
  effort,
  thinking,
  model,
  tools,
  cwd,
}: Props) => {
  const args =
    harness === "pi"
      ? buildPiSpawnCommandArgs({ intent, thinking, model, tools })
      : buildSpawnCommandArgs({ intent, effort, model, tools })
  const command = formatSpawnCommand(args)

  return (
    <details data-testid="spawn-command-preview" className="text-xs text-base-content/60">
      <summary className="cursor-pointer font-medium text-base-content/80">Command</summary>
      <div className="mt-1.5 rounded-lg border border-base-300 bg-base-200 p-2 font-mono text-[11px] whitespace-pre-wrap break-all">
        <div>{command}</div>
        {cwd ? <div className="mt-1 text-base-content/50">cwd: {cwd}</div> : null}
      </div>
    </details>
  )
}
