// Periodic poller that turns GitHub issues labelled `claude-go` into
// background Claude sessions. Stateful in-memory only; the supervisor and
// GitHub labels are the durable source of truth.
//
// One `tick()`:
//   1. List dashboard projects that have a GitHub remote.
//   2. For each repo, `gh issue list --label claude-go --state open`.
//   3. Run `pickEligible` against in-memory running/processed state.
//   4. For each picked issue: if vague → post a clarifying comment + label
//      `claude-needs-info`; otherwise add `claude-running`, then spawn
//      `claude --bg <goal>` in the project cwd, recording the session short
//      and marking the issue as in-flight.

import { Context, Data, Effect, Layer, Ref } from "effect"
import { ShellRepo } from "../../platform/shell.repo"
import { ProjectsService } from "../projects/projects.repo"
import {
  type Issue,
  type IssueKey,
  type SchedulerState,
  formatTddPrompt,
  goalText,
  isVagueIssue,
  issueKey,
  pickEligible,
} from "./issue-driver.core"

export class GhError extends Data.TaggedError("GhError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export type GhListIssuesInput = {
  readonly repo: string
  readonly labels: readonly string[]
}

export type GhEditLabelsInput = {
  readonly repo: string
  readonly number: number
  readonly add?: readonly string[]
  readonly remove?: readonly string[]
}

export type GhCommentInput = {
  readonly repo: string
  readonly number: number
  readonly body: string
}

export type GhIssueClientApi = {
  readonly listIssues: (input: GhListIssuesInput) => Effect.Effect<readonly Issue[], GhError, never>
  readonly editLabels: (input: GhEditLabelsInput) => Effect.Effect<void, GhError, never>
  readonly comment?: (input: GhCommentInput) => Effect.Effect<void, GhError, never>
}

export class GhIssueClient extends Context.Tag("GhIssueClient")<
  GhIssueClient,
  GhIssueClientApi
>() {}

export type IssueDriverStatus = {
  readonly paused: boolean
  readonly lastTickAt: number | null
  readonly lastError: string | null
  readonly running: readonly { readonly key: IssueKey; readonly repo: string }[]
  readonly processed: readonly IssueKey[]
}

type IssueDriverApi = {
  readonly tick: () => Effect.Effect<void, never, never>
  readonly status: () => Effect.Effect<IssueDriverStatus, never, never>
  readonly pause: (paused: boolean) => Effect.Effect<void, never, never>
}

export class IssueDriverService extends Context.Tag("IssueDriverService")<
  IssueDriverService,
  IssueDriverApi
>() {}

export type IssueDriverConfig = {
  readonly globalCap: number
  readonly perRepoCap: number
}

type InternalState = {
  readonly paused: boolean
  readonly lastTickAt: number | null
  readonly lastError: string | null
  readonly running: ReadonlyMap<IssueKey, string>
  readonly processed: ReadonlySet<IssueKey>
}

const initialState: InternalState = {
  paused: false,
  lastTickAt: null,
  lastError: null,
  running: new Map(),
  processed: new Set(),
}

const toSchedulerState = (s: InternalState): SchedulerState => ({
  running: s.running,
  processed: s.processed,
})

export const makeIssueDriverLive = ({
  globalCap,
  perRepoCap,
}: IssueDriverConfig): Layer.Layer<
  IssueDriverService,
  never,
  ProjectsService | ShellRepo | GhIssueClient
> =>
  Layer.effect(
    IssueDriverService,
    Effect.gen(function* () {
      const projects = yield* ProjectsService
      const shell = yield* ShellRepo
      const gh = yield* GhIssueClient
      const stateRef = yield* Ref.make<InternalState>(initialState)

      const spawnFor = (issue: Issue): Effect.Effect<void, never, never> =>
        Effect.gen(function* () {
          const project = (yield* projects.list()).find(
            (p) =>
              p.githubOwner && p.githubRepo && `${p.githubOwner}/${p.githubRepo}` === issue.repo,
          )
          if (!project) return
          const key = issueKey(issue)

          if (isVagueIssue({ title: issue.title, body: issue.body })) {
            yield* gh
              .editLabels({
                repo: issue.repo,
                number: issue.number,
                add: ["claude-needs-info"],
                remove: ["claude-go"],
              })
              .pipe(Effect.catchAll(() => Effect.void))
            yield* Ref.update(stateRef, (s) => ({
              ...s,
              processed: new Set([...s.processed, key]),
            }))
            return
          }

          yield* gh
            .editLabels({
              repo: issue.repo,
              number: issue.number,
              add: ["claude-running"],
            })
            .pipe(Effect.catchAll(() => Effect.void))

          const systemPrompt = formatTddPrompt({
            repo: issue.repo,
            issueNumber: issue.number,
          })
          const intent = `${systemPrompt}\n\n${goalText(issue)}`
          const dispatchExit = yield* shell
            .dispatch({ intent, cwd: project.path })
            .pipe(Effect.either)
          if (dispatchExit._tag === "Left") {
            // Spawn failed — leave issue eligible for next tick by NOT
            // marking processed, and drop claude-running.
            yield* gh
              .editLabels({
                repo: issue.repo,
                number: issue.number,
                remove: ["claude-running"],
              })
              .pipe(Effect.catchAll(() => Effect.void))
            return
          }
          const short = dispatchExit.right
          yield* Ref.update(stateRef, (s) => {
            const running = new Map(s.running)
            running.set(key, issue.repo)
            return { ...s, running }
          })
          // We don't observe completion in v1 — once spawned, the supervisor
          // owns the lifecycle. Mark processed so the next tick doesn't
          // double-spawn even if labels lag. Keep `running` populated so the
          // status endpoint can show in-flight count; consumers can clear
          // through future "session-ended" wiring.
          void short
          yield* Ref.update(stateRef, (s) => ({
            ...s,
            processed: new Set([...s.processed, key]),
          }))
        })

      const tick = (): Effect.Effect<void, never, never> =>
        Effect.gen(function* () {
          const current = yield* Ref.get(stateRef)
          if (current.paused) {
            yield* Ref.update(stateRef, (s) => ({ ...s, lastTickAt: Date.now() }))
            return
          }
          const projectList = yield* projects.list()
          const ghProjects = projectList.filter((p) => p.githubOwner && p.githubRepo)
          const allIssues: Issue[] = []
          for (const p of ghProjects) {
            const repo = `${p.githubOwner}/${p.githubRepo}`
            const res = yield* gh.listIssues({ repo, labels: ["claude-go"] }).pipe(Effect.either)
            if (res._tag === "Right") {
              for (const issue of res.right) allIssues.push(issue)
            } else {
              yield* Ref.update(stateRef, (s) => ({
                ...s,
                lastError: res.left.message,
              }))
            }
          }
          const picked = pickEligible({
            issues: allIssues,
            state: toSchedulerState(current),
            globalCap,
            perRepoCap,
          })
          for (const issue of picked) {
            yield* spawnFor(issue)
          }
          yield* Ref.update(stateRef, (s) => ({ ...s, lastTickAt: Date.now() }))
        })

      const status = (): Effect.Effect<IssueDriverStatus, never, never> =>
        Effect.gen(function* () {
          const s = yield* Ref.get(stateRef)
          return {
            paused: s.paused,
            lastTickAt: s.lastTickAt,
            lastError: s.lastError,
            running: Array.from(s.running.entries()).map(([key, repo]) => ({ key, repo })),
            processed: Array.from(s.processed),
          }
        })

      const pause = (paused: boolean): Effect.Effect<void, never, never> =>
        Ref.update(stateRef, (s) => ({ ...s, paused }))

      return { tick, status, pause }
    }),
  )
