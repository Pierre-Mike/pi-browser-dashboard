import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "../../lib/api"
import type {
  AddInput,
  AgenticListing,
  CatalogBundle,
  InitInput,
  InitResult,
  InstallInput,
  InstallResult,
  LibraryCategory,
  LibraryEntry,
  PushInput,
  RemoveInput,
  SyncInput,
  SyncOutcome,
} from "./types"

// biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
const client = api as any

export const useCatalog = (projectId: string | null) =>
  useQuery<CatalogBundle>({
    queryKey: ["library", "catalog", projectId],
    queryFn: async () => {
      const res = await client.library.catalog.$get({
        query: projectId ? { projectId } : {},
      })
      if (!res.ok) throw new Error(`library catalog: HTTP ${res.status}`)
      return (await res.json()) as CatalogBundle
    },
    staleTime: 10_000,
  })

export const useAgenticRepo = (category: LibraryCategory | null) =>
  useQuery<AgenticListing>({
    queryKey: ["library", "agentic", category],
    enabled: category !== null,
    queryFn: async () => {
      if (!category) throw new Error("missing category")
      const res = await client.library.agentic.$get({ query: { category } })
      if (!res.ok) throw new Error(`library agentic: HTTP ${res.status}`)
      return (await res.json()) as AgenticListing
    },
    staleTime: 10_000,
  })

const httpErrorBody = async (res: Response, label: string): Promise<Error> => {
  let detail = ""
  try {
    const body = (await res.json()) as { error?: string; message?: string }
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
  return useMutation<InitResult, Error, InitInput>({
    mutationFn: async (input) => {
      const res = await client.library.init.$post({ json: input })
      if (!res.ok) throw await httpErrorBody(res, "init")
      return (await res.json()) as InitResult
    },
    onSuccess: () => invalidateLibrary(qc),
  })
}

export const useInstallMutation = () => {
  const qc = useQueryClient()
  return useMutation<InstallResult, Error, InstallInput>({
    mutationFn: async (input) => {
      const res = await client.library.use.$post({ json: input })
      if (!res.ok) throw await httpErrorBody(res, "install")
      return (await res.json()) as InstallResult
    },
    onSuccess: () => invalidateLibrary(qc),
  })
}

export const useAddMutation = () => {
  const qc = useQueryClient()
  return useMutation<{ entry: LibraryEntry }, Error, AddInput>({
    mutationFn: async (input) => {
      const res = await client.library.add.$post({ json: input })
      if (!res.ok) throw await httpErrorBody(res, "add")
      return (await res.json()) as { entry: LibraryEntry }
    },
    onSuccess: () => invalidateLibrary(qc),
  })
}

export const usePushMutation = () => {
  const qc = useQueryClient()
  return useMutation<{ commitSha: string }, Error, PushInput>({
    mutationFn: async (input) => {
      const res = await client.library.push.$post({ json: input })
      if (!res.ok) throw await httpErrorBody(res, "push")
      return (await res.json()) as { commitSha: string }
    },
    onSuccess: () => invalidateLibrary(qc),
  })
}

export const useRemoveMutation = () => {
  const qc = useQueryClient()
  return useMutation<{ removed: boolean }, Error, RemoveInput>({
    mutationFn: async (input) => {
      const res = await client.library.remove.$post({ json: input })
      if (!res.ok) throw await httpErrorBody(res, "remove")
      return (await res.json()) as { removed: boolean }
    },
    onSuccess: () => invalidateLibrary(qc),
  })
}

export const useSyncMutation = () => {
  const qc = useQueryClient()
  return useMutation<{ outcomes: SyncOutcome[] }, Error, SyncInput>({
    mutationFn: async (input) => {
      const res = await client.library.sync.$post({ json: input })
      if (!res.ok) throw await httpErrorBody(res, "sync")
      return (await res.json()) as { outcomes: SyncOutcome[] }
    },
    onSuccess: () => invalidateLibrary(qc),
  })
}
