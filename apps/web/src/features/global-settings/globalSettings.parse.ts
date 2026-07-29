// Runtime decoder for `GlobalSettings` — no `@pid/shared` contract exists for
// this shape, so it is validated locally instead of trusted with an `as`.
import { isNumber, isRecord, isString, isStringArray, parseArray } from "../../lib/guards"
import type { GlobalSettings, SkillGroup } from "./types"

const parseSkillGroup = (v: unknown): SkillGroup | null => {
  if (!isRecord(v)) return null
  const { name, skills } = v
  return isString(name) && isStringArray(skills) ? { name, skills } : null
}

export const parseGlobalSettings = (v: unknown): GlobalSettings | null => {
  if (!isRecord(v)) return null
  const { git, library, orchestration, network, skillGroups } = v

  if (!isRecord(git) || !isString(git.defaultBranch) || !isString(git.remoteName)) return null

  if (!isRecord(library) || !isString(library.catalogPath) || !isString(library.agenticRepoPath))
    return null

  if (
    !isRecord(orchestration) ||
    !isString(orchestration.claudeBin) ||
    !isString(orchestration.defaultAgent) ||
    !isString(orchestration.defaultPermissionMode) ||
    !isString(orchestration.defaultEffort) ||
    !isNumber(orchestration.maxParallel)
  )
    return null

  if (
    !isRecord(network) ||
    !isString(network.projectsRoot) ||
    !isNumber(network.appPort) ||
    !isNumber(network.tunnelPort)
  )
    return null

  const groups = parseArray(skillGroups, parseSkillGroup)
  if (!groups) return null

  return {
    git: { defaultBranch: git.defaultBranch, remoteName: git.remoteName },
    library: { catalogPath: library.catalogPath, agenticRepoPath: library.agenticRepoPath },
    orchestration: {
      claudeBin: orchestration.claudeBin,
      defaultAgent: orchestration.defaultAgent,
      defaultPermissionMode: orchestration.defaultPermissionMode,
      defaultEffort: orchestration.defaultEffort,
      maxParallel: orchestration.maxParallel,
    },
    network: {
      projectsRoot: network.projectsRoot,
      appPort: network.appPort,
      tunnelPort: network.tunnelPort,
    },
    skillGroups: groups,
  }
}
