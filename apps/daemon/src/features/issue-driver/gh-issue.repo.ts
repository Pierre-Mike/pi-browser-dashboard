// Live `gh` CLI implementation of GhIssueClient. We shell out so the daemon
// inherits whatever auth `gh` already has (keychain, env). All failures fold
// into GhError; route layer turns those into HTTP 500.

import { Effect, Layer } from "effect"
import { parseIssueListJson } from "./issue-driver.core"
import { GhError, GhIssueClient } from "./issue-driver.repo"

const ISSUE_FIELDS = ["number", "title", "body", "labels", "url"]

const runGh = (args: readonly string[], timeoutMs = 15_000) =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn({
        cmd: ["gh", ...args],
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      })
      const timer = setTimeout(() => {
        try {
          proc.kill()
        } catch {
          // already exited
        }
      }, timeoutMs)
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ])
      const exitCode = await proc.exited
      clearTimeout(timer)
      if (exitCode !== 0) {
        throw new GhError({
          message: `gh ${args.join(" ")} exited ${exitCode}: ${stderr.trim()}`,
        })
      }
      return stdout
    },
    catch: (cause) =>
      cause instanceof GhError
        ? cause
        : new GhError({ message: `gh ${args.join(" ")} failed`, cause }),
  })

export const GhIssueClientLive: Layer.Layer<GhIssueClient> = Layer.succeed(GhIssueClient, {
  listIssues: ({ repo, labels }) =>
    Effect.gen(function* () {
      const args = [
        "issue",
        "list",
        "--repo",
        repo,
        "--state",
        "open",
        "--limit",
        "50",
        "--json",
        ISSUE_FIELDS.join(","),
      ]
      for (const l of labels) {
        args.push("--label", l)
      }
      const stdout = yield* runGh(args)
      return parseIssueListJson(stdout, repo)
    }),
  editLabels: ({ repo, number, add = [], remove = [] }) =>
    Effect.gen(function* () {
      const args = ["issue", "edit", String(number), "--repo", repo]
      for (const a of add) args.push("--add-label", a)
      for (const r of remove) args.push("--remove-label", r)
      yield* runGh(args).pipe(Effect.asVoid)
    }),
  comment: ({ repo, number, body }) =>
    runGh(["issue", "comment", String(number), "--repo", repo, "--body", body]).pipe(Effect.asVoid),
})
