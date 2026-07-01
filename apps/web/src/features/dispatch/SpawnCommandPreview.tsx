import { buildSpawnCommandArgs, formatSpawnCommand } from "./spawnCommandArgs"

type Props = {
  intent: string
  effort?: string
  tools?: readonly string[]
  cwd?: string
}

// Collapsible readout of the literal `claude --bg ...` argv the daemon will
// spawn on submit, so the user can check flags/tools/intent before firing it
// off. Collapsed by default, mirroring SpawnToolPicker/SpawnSkillPicker.
export const SpawnCommandPreview = ({ intent, effort, tools, cwd }: Props) => {
  const command = formatSpawnCommand(buildSpawnCommandArgs({ intent, effort, tools }))

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
