import { open, readdir, readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import { Context, Effect, Layer } from "effect"
import { ConfigService } from "../../platform/config.repo"
import { ProjectsService } from "../projects/projects.repo"
import {
  type HookEntry,
  type HookScript,
  isSafeSegment,
  parseSettings,
  parseSkillFrontmatter,
  type SettingsSummary,
  type SkillDetail,
  type SkillSummary,
} from "./claude-config.core"

/** Maximum bytes read from any text file (CLAUDE.md, SKILL.md). Prevents DoS on huge files. */
export const MAX_TEXT_BYTES = 512 * 1024 // 512 KB

export type ScopeBundle = {
  readonly scope: "global" | "project"
  readonly root: string
  readonly settings?: SettingsSummary
  readonly settingsLocal?: SettingsSummary
  readonly skills: readonly SkillSummary[]
  readonly hookScripts: readonly HookScript[]
  readonly hooks: readonly HookEntry[]
  readonly claudeMd?: string
}

export type ClaudeConfigError = "not_found" | "forbidden"

type ClaudeConfigServiceApi = {
  readonly readGlobal: () => Effect.Effect<ScopeBundle, never, never>
  readonly readProject: (projectId: string) => Effect.Effect<ScopeBundle, ClaudeConfigError, never>
  readonly readSkill: ({
    scope,
    projectId,
    skillId,
  }: {
    scope: "global" | "project"
    projectId: string | null
    skillId: string
  }) => Effect.Effect<SkillDetail, ClaudeConfigError, never>
}

export class ClaudeConfigService extends Context.Tag("ClaudeConfigService")<
  ClaudeConfigService,
  ClaudeConfigServiceApi
>() {}

const tryReadText = async (path: string): Promise<string | null> => {
  try {
    const s = await stat(path)
    if (s.size > MAX_TEXT_BYTES) {
      const fh = await open(path, "r")
      try {
        const buf = Buffer.allocUnsafe(MAX_TEXT_BYTES)
        const { bytesRead } = await fh.read(buf, 0, MAX_TEXT_BYTES, 0)
        const text = buf.subarray(0, bytesRead).toString("utf8")
        return `${text}\n\n[truncated: file exceeds ${MAX_TEXT_BYTES / 1024} KB limit]`
      } finally {
        await fh.close()
      }
    }
    return await readFile(path, "utf8")
  } catch {
    return null
  }
}

const tryStat = async (path: string) => {
  try {
    return await stat(path)
  } catch {
    return null
  }
}

const listSkills = async (skillsDir: string): Promise<readonly SkillSummary[]> => {
  const entries = await readdir(skillsDir).catch(() => [] as string[])
  const out: SkillSummary[] = []
  for (const name of entries) {
    if (name.startsWith(".")) continue
    const dirPath = join(skillsDir, name)
    const s = await tryStat(dirPath)
    if (!s?.isDirectory()) continue
    const skillPath = join(dirPath, "SKILL.md")
    const skillStat = await tryStat(skillPath)
    if (!skillStat?.isFile()) continue
    const text = await tryReadText(skillPath)
    const fm = text ? parseSkillFrontmatter(text).frontmatter : {}
    const evalsStat = await tryStat(join(dirPath, "evals"))
    out.push({
      id: name,
      path: dirPath,
      name: fm.name ?? name,
      ...(fm.description ? { description: fm.description } : {}),
      bytes: skillStat.size,
      hasEvals: !!evalsStat?.isDirectory(),
    })
  }
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return out
}

const listHookScripts = async (hooksDir: string): Promise<readonly HookScript[]> => {
  const entries = await readdir(hooksDir).catch(() => [] as string[])
  const out: HookScript[] = []
  for (const name of entries) {
    if (name.startsWith(".")) continue
    const path = join(hooksDir, name)
    const s = await tryStat(path)
    if (!s?.isFile()) continue
    out.push({ name, path, bytes: s.size })
  }
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return out
}

const readBundle = async ({
  scope,
  root,
  claudeMdPath,
}: {
  scope: "global" | "project"
  root: string
  claudeMdPath: string
}): Promise<ScopeBundle> => {
  const settingsPath = join(root, "settings.json")
  const settingsLocalPath = join(root, "settings.local.json")
  const skillsDir = join(root, "skills")
  const hooksDir = join(root, "hooks")

  const [settingsText, settingsLocalText, claudeMdText, skills, hookScripts] = await Promise.all([
    tryReadText(settingsPath),
    tryReadText(settingsLocalPath),
    tryReadText(claudeMdPath),
    listSkills(skillsDir),
    listHookScripts(hooksDir),
  ])

  const settings = settingsText !== null ? parseSettings(settingsText) : undefined
  const settingsLocal = settingsLocalText !== null ? parseSettings(settingsLocalText) : undefined
  const hooks = [...(settings?.hooks ?? []), ...(settingsLocal?.hooks ?? [])]
  return {
    scope,
    root,
    ...(settings ? { settings } : {}),
    ...(settingsLocal ? { settingsLocal } : {}),
    skills,
    hookScripts,
    hooks,
    ...(claudeMdText !== null ? { claudeMd: claudeMdText } : {}),
  }
}

export const ClaudeConfigRepoLive: Layer.Layer<
  ClaudeConfigService,
  never,
  ConfigService | ProjectsService
> = Layer.effect(
  ClaudeConfigService,
  Effect.gen(function* () {
    const cfg = yield* ConfigService
    const projects = yield* ProjectsService
    const config = yield* cfg.get()

    const globalRoot = config.claudeConfigDir

    const resolveProjectPaths = (projectId: string) =>
      Effect.gen(function* () {
        if (!isSafeSegment(projectId)) return yield* Effect.fail<ClaudeConfigError>("forbidden")
        const list = yield* projects.list()
        const proj = list.find((p) => p.id === projectId)
        if (!proj) return yield* Effect.fail<ClaudeConfigError>("not_found")
        return { root: join(proj.path, ".claude"), claudeMd: join(proj.path, "CLAUDE.md") }
      })

    return {
      readGlobal: () =>
        Effect.promise(() =>
          readBundle({
            scope: "global",
            root: globalRoot,
            claudeMdPath: join(globalRoot, "CLAUDE.md"),
          }),
        ),

      readProject: (projectId) =>
        Effect.gen(function* () {
          const paths = yield* resolveProjectPaths(projectId)
          return yield* Effect.promise(() =>
            readBundle({ scope: "project", root: paths.root, claudeMdPath: paths.claudeMd }),
          )
        }),

      readSkill: ({ scope, projectId, skillId }) =>
        Effect.gen(function* () {
          if (!isSafeSegment(skillId)) return yield* Effect.fail<ClaudeConfigError>("forbidden")
          const root =
            scope === "global" ? globalRoot : (yield* resolveProjectPaths(projectId ?? "")).root
          const dir = join(root, "skills", skillId)
          const skillPath = join(dir, "SKILL.md")
          const s = yield* Effect.promise(() => tryStat(skillPath))
          if (!s?.isFile()) return yield* Effect.fail<ClaudeConfigError>("not_found")
          const text = yield* Effect.promise(() => tryReadText(skillPath))
          if (text === null) return yield* Effect.fail<ClaudeConfigError>("not_found")
          const { frontmatter, body } = parseSkillFrontmatter(text)
          const evalsStat = yield* Effect.promise(() => tryStat(join(dir, "evals")))
          return {
            id: skillId,
            path: dir,
            name: frontmatter.name ?? skillId,
            ...(frontmatter.description ? { description: frontmatter.description } : {}),
            bytes: s.size,
            hasEvals: !!evalsStat?.isDirectory(),
            body,
            frontmatter,
          }
        }),
    }
  }),
)

export const ClaudeConfigRepoTest = (
  bundles: {
    readonly global?: ScopeBundle
    readonly projects?: Record<string, ScopeBundle>
    readonly skills?: Record<string, SkillDetail>
  } = {},
): Layer.Layer<ClaudeConfigService> =>
  Layer.succeed(ClaudeConfigService, {
    readGlobal: () =>
      Effect.succeed(
        bundles.global ?? {
          scope: "global",
          root: "/tmp/.claude",
          skills: [],
          hookScripts: [],
          hooks: [],
        },
      ),
    readProject: (id) => {
      const b = bundles.projects?.[id]
      return b ? Effect.succeed(b) : Effect.fail<ClaudeConfigError>("not_found")
    },
    readSkill: ({ skillId }) => {
      const d = bundles.skills?.[skillId]
      return d ? Effect.succeed(d) : Effect.fail<ClaudeConfigError>("not_found")
    },
  })
