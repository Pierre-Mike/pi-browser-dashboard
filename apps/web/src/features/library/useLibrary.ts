import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "../../lib/api"
import {
  parseAgenticListing,
  parseCatalogBundle,
  parseCommitShaWrapper,
  parseEntryWrapper,
  parseErrorBody,
  parseInitResult,
  parseInstallResult,
  parseOutcomesWrapper,
  parseRemovedWrapper,
} from "./library.parse"
import type {
  AddInput,
  InitInput,
  InstallInput,
  LibraryCategory,
  PushInput,
  RemoveInput,
  SyncInput,
} from "./types"

// biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
const client = api as any

export const useCatalog = (projectId: string | null) =>
  useQuery({
    queryKey: ["library", "catalog", projectId],
    queryFn: async () => {
      const res = await client.library.catalog.$get({
        query: projectId ? { projectId } : {},
      })
      if (!res.ok) throw new Error(`library catalog: HTTP ${res.status}`)
      const bundle = parseCatalogBundle(await res.json())
      if (!bundle) throw new Error("library catalog: malformed response")
      return bundle
    },
    staleTime: 10_000,
  })

export const useAgenticRepo = (category: LibraryCategory | null) =>
  useQuery({
    queryKey: ["library", "agentic", category],
    enabled: category !== null,
    queryFn: async () => {
      if (!category) throw new Error("missing category")
      const res = await client.library.agentic.$get({ query: { category } })
      if (!res.ok) throw new Error(`library agentic: HTTP ${res.status}`)
      const listing = parseAgenticListing(await res.json())
      if (!listing) throw new Error("library agentic: malformed response")
      return listing
    },
    staleTime: 10_000,
  })

const httpErrorBody = async (res: Response, label: string): Promise<Error> => {
  let detail = ""
  try {
    const body = parseErrorBody(await res.json())
    detail = body.error ? `${body.error}${body.message ? `: ${body.message}` : ""}` : ""
  } catch {
    detail = await res.text().catch(() => "")
  }
  return new Error(`${label} (HTTP ${res.status}${detail ? `: ${detail}` : ""})`)
}

const invalidateLibrary = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ["library", "catalog"] })
  qc.invalidateQueries({ queryKey: ["library", "agentic"] })
}

export const useInitMutation = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: InitInput) => {
      const res = await client.library.init.$post({ json: input })
      if (!res.ok) throw await httpErrorBody(res, "init")
      const result = parseInitResult(await res.json())
      if (!result) throw new Error("library init: malformed response")
      return result
    },
    onSuccess: () => invalidateLibrary(qc),
  })
}

export const useInstallMutation = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: InstallInput) => {
      const res = await client.library.use.$post({ json: input })
      if (!res.ok) throw await httpErrorBody(res, "install")
      const result = parseInstallResult(await res.json())
      if (!result) throw new Error("library install: malformed response")
      return result
    },
    onSuccess: () => invalidateLibrary(qc),
  })
}

export const useAddMutation = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: AddInput) => {
      const res = await client.library.add.$post({ json: input })
      if (!res.ok) throw await httpErrorBody(res, "add")
      const result = parseEntryWrapper(await res.json())
      if (!result) throw new Error("library add: malformed response")
      return result
    },
    onSuccess: () => invalidateLibrary(qc),
  })
}

export const usePushMutation = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: PushInput) => {
      const res = await client.library.push.$post({ json: input })
      if (!res.ok) throw await httpErrorBody(res, "push")
      const result = parseCommitShaWrapper(await res.json())
      if (!result) throw new Error("library push: malformed response")
      return result
    },
    onSuccess: () => invalidateLibrary(qc),
  })
}

export const useRemoveMutation = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: RemoveInput) => {
      const res = await client.library.remove.$post({ json: input })
      if (!res.ok) throw await httpErrorBody(res, "remove")
      const result = parseRemovedWrapper(await res.json())
      if (!result) throw new Error("library remove: malformed response")
      return result
    },
    onSuccess: () => invalidateLibrary(qc),
  })
}

export const useSyncMutation = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: SyncInput) => {
      const res = await client.library.sync.$post({ json: input })
      if (!res.ok) throw await httpErrorBody(res, "sync")
      const result = parseOutcomesWrapper(await res.json())
      if (!result) throw new Error("library sync: malformed response")
      return result
    },
    onSuccess: () => invalidateLibrary(qc),
  })
}
