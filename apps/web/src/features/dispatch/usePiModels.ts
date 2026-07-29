import { useQuery } from "@tanstack/react-query"
import { api } from "../../lib/api"
import { parsePiModels } from "./piModels.parse"

export type { PiModelOption } from "./piModels.parse"

import type { PiModelOption } from "./piModels.parse"

// The value handed to `pi --model` — pi accepts the "provider/id" pattern.
export const piModelValue = (m: PiModelOption): string => `${m.provider}/${m.id}`

// biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
const client = api as any

// Fetch pi's model catalog for the spawn modal's pi tab. Disabled until the
// tab is actually shown — `pi --list-models` is a subprocess on the daemon
// side, so don't pay for it on claude-only spawns. The catalog changes rarely
// (installs/config edits), hence the generous staleTime.
export const usePiModels = (enabled: boolean) =>
  useQuery({
    queryKey: ["pi-models"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const res = await client.dispatch["pi-models"].$get()
      if (!res.ok) throw new Error(`pi-models: HTTP ${res.status}`)
      const models = parsePiModels(await res.json())
      if (!models) throw new Error("pi-models: malformed response")
      return models
    },
  })
