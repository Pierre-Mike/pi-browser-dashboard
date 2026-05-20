import { describe, expect, it } from "bun:test"
import { Effect, Layer } from "effect"
import { ShellRepo, type ShellRepoApi } from "../../platform/shell.repo"
import { ProjectsRepoTest } from "../projects/projects.repo"
import {
  GhIssueClient,
  type GhIssueClientApi,
  IssueDriverService,
  makeIssueDriverLive,
} from "./issue-driver.repo"

const PROJECTS = [
  {
    id: "widgets",
    name: "widgets",
    path: "/tmp/widgets",
    isGitRepo: true,
    lastModified: 0,
    githubOwner: "acme",
    githubRepo: "widgets",
    githubUrl: "https://github.com/acme/widgets",
  },
  {
    id: "gadgets",
    name: "gadgets",
    path: "/tmp/gadgets",
    isGitRepo: true,
    lastModified: 0,
    githubOwner: "acme",
    githubRepo: "gadgets",
    githubUrl: "https://github.com/acme/gadgets",
  },
  {
    // no github remote — should be ignored
    id: "local",
    name: "local",
    path: "/tmp/local",
    isGitRepo: true,
    lastModified: 0,
  },
] as const

type DispatchCall = {
  readonly intent: string
  readonly cwd?: string
  readonly agent?: string
  readonly permissionMode?: string
}

const makeShellSpy = (calls: DispatchCall[]): ShellRepoApi => ({
  dispatch: (input) =>
    Effect.sync(() => {
      calls.push(input)
      return `short-${calls.length}`
    }),
  stop: () => Effect.void,
  rm: () => Effect.void,
  peek: () => Effect.succeed(""),
  send: () => Effect.void,
})

type GhSpy = {
  readonly listIssues: GhIssueClientApi["listIssues"]
  readonly editLabels: GhIssueClientApi["editLabels"]
  readonly editLabelCalls: ReadonlyArray<{
    readonly repo: string
    readonly number: number
    readonly add: readonly string[]
    readonly remove: readonly string[]
  }>
}

const makeGhSpy = (
  byRepo: Record<string, readonly { number: number; title: string; body: string }[]>,
): GhSpy => {
  const editLabelCalls: {
    repo: string
    number: number
    add: readonly string[]
    remove: readonly string[]
  }[] = []
  return {
    listIssues: ({ repo }) =>
      Effect.succeed(
        (byRepo[repo] ?? []).map((i) => ({
          number: i.number,
          title: i.title,
          body: i.body,
          labels: ["claude-go"],
          repo,
          url: `https://github.com/${repo}/issues/${i.number}`,
        })),
      ),
    editLabels: ({ repo, number, add = [], remove = [] }) =>
      Effect.sync(() => {
        editLabelCalls.push({ repo, number, add, remove })
      }),
    get editLabelCalls() {
      return editLabelCalls
    },
  }
}

const runTick = async ({
  byRepo,
  shellCalls,
  globalCap = 2,
  perRepoCap = 1,
}: {
  byRepo: Record<string, readonly { number: number; title: string; body: string }[]>
  shellCalls: DispatchCall[]
  globalCap?: number
  perRepoCap?: number
}): Promise<{ ghSpy: GhSpy }> => {
  const ghSpy = makeGhSpy(byRepo)
  const ProjectsLayer = ProjectsRepoTest(PROJECTS)
  const ShellLayer = Layer.succeed(ShellRepo, makeShellSpy(shellCalls))
  const GhLayer = Layer.succeed(GhIssueClient, {
    listIssues: ghSpy.listIssues,
    editLabels: ghSpy.editLabels,
  })
  const Live = makeIssueDriverLive({ globalCap, perRepoCap })
  const layer = Layer.provide(Live, Layer.mergeAll(ProjectsLayer, ShellLayer, GhLayer))
  await Effect.runPromise(
    Effect.provide(
      Effect.flatMap(IssueDriverService, (s) => s.tick()),
      layer,
    ),
  )
  return { ghSpy }
}

describe("IssueDriver tick", () => {
  it("spawns one session per eligible issue and labels it claude-running", async () => {
    const calls: DispatchCall[] = []
    const { ghSpy } = await runTick({
      byRepo: {
        "acme/widgets": [
          { number: 1, title: "Add login", body: "We need login. Given X when Y then Z." },
        ],
        "acme/gadgets": [],
      },
      shellCalls: calls,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.cwd).toBe("/tmp/widgets")
    expect(calls[0]?.intent).toContain("/goal Add login")
    const addCalls = ghSpy.editLabelCalls.filter((c) => c.add.includes("claude-running"))
    expect(addCalls).toHaveLength(1)
    expect(addCalls[0]?.repo).toBe("acme/widgets")
    expect(addCalls[0]?.number).toBe(1)
  })

  it("honours globalCap across repos", async () => {
    const calls: DispatchCall[] = []
    await runTick({
      byRepo: {
        "acme/widgets": [
          { number: 1, title: "A", body: "Given A when B then C — long enough body." },
        ],
        "acme/gadgets": [
          { number: 2, title: "B", body: "Given A when B then C — long enough body." },
          { number: 3, title: "C", body: "Given A when B then C — long enough body." },
        ],
      },
      shellCalls: calls,
      globalCap: 2,
      perRepoCap: 1,
    })
    expect(calls).toHaveLength(2)
    const cwds = calls.map((c) => c.cwd)
    expect(cwds).toContain("/tmp/widgets")
    expect(cwds).toContain("/tmp/gadgets")
  })

  it("honours perRepoCap — only one issue from a repo at a time", async () => {
    const calls: DispatchCall[] = []
    await runTick({
      byRepo: {
        "acme/widgets": [
          { number: 1, title: "A", body: "Given A when B then C — long enough body." },
          { number: 2, title: "B", body: "Given A when B then C — long enough body." },
        ],
      },
      shellCalls: calls,
      globalCap: 5,
      perRepoCap: 1,
    })
    expect(calls).toHaveLength(1)
  })

  it("does not re-spawn an issue marked in-flight across ticks", async () => {
    const calls: DispatchCall[] = []
    const ProjectsLayer = ProjectsRepoTest(PROJECTS)
    const ghSpy = makeGhSpy({
      "acme/widgets": [
        { number: 1, title: "A", body: "Given A when B then C — long enough body." },
      ],
      "acme/gadgets": [],
    })
    const ShellLayer = Layer.succeed(ShellRepo, makeShellSpy(calls))
    const GhLayer = Layer.succeed(GhIssueClient, {
      listIssues: ghSpy.listIssues,
      editLabels: ghSpy.editLabels,
    })
    const Live = makeIssueDriverLive({ globalCap: 2, perRepoCap: 1 })
    const layer = Layer.provide(Live, Layer.mergeAll(ProjectsLayer, ShellLayer, GhLayer))
    await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const svc = yield* IssueDriverService
          yield* svc.tick()
          yield* svc.tick()
        }),
        layer,
      ),
    )
    expect(calls).toHaveLength(1)
  })

  it("posts a clarifying comment and skips spawn for a vague issue", async () => {
    const calls: DispatchCall[] = []
    const { ghSpy } = await runTick({
      byRepo: {
        "acme/widgets": [{ number: 7, title: "make it faster", body: "" }],
        "acme/gadgets": [],
      },
      shellCalls: calls,
    })
    expect(calls).toHaveLength(0)
    // claude-needs-info added and claude-running not added
    const addedNeeds = ghSpy.editLabelCalls.find((c) => c.add.includes("claude-needs-info"))
    expect(addedNeeds).toBeDefined()
    const addedRunning = ghSpy.editLabelCalls.find((c) => c.add.includes("claude-running"))
    expect(addedRunning).toBeUndefined()
  })

  it("skips projects without a GitHub remote", async () => {
    const calls: DispatchCall[] = []
    await runTick({
      byRepo: { "acme/widgets": [], "acme/gadgets": [] },
      shellCalls: calls,
    })
    expect(calls).toHaveLength(0)
  })
})

describe("IssueDriver status", () => {
  it("reports paused state and last tick time", async () => {
    const calls: DispatchCall[] = []
    const ghSpy = makeGhSpy({ "acme/widgets": [], "acme/gadgets": [] })
    const ProjectsLayer = ProjectsRepoTest(PROJECTS)
    const ShellLayer = Layer.succeed(ShellRepo, makeShellSpy(calls))
    const GhLayer = Layer.succeed(GhIssueClient, {
      listIssues: ghSpy.listIssues,
      editLabels: ghSpy.editLabels,
    })
    const Live = makeIssueDriverLive({ globalCap: 2, perRepoCap: 1 })
    const layer = Layer.provide(Live, Layer.mergeAll(ProjectsLayer, ShellLayer, GhLayer))
    const status = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const svc = yield* IssueDriverService
          yield* svc.pause(true)
          yield* svc.tick()
          return yield* svc.status()
        }),
        layer,
      ),
    )
    expect(status.paused).toBe(true)
    // A paused tick records nothing.
    expect(status.running).toHaveLength(0)
  })
})
