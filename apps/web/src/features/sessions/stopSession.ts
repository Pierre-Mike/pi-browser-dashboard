import { api } from "../../lib/api"

// POST /sessions/:id/stop — true when the daemon accepted the stop. Shared by
// the brainstorm companion panels (V1 roles + V2 Excalidraw session).
export const stopSession = async (short: string): Promise<boolean> => {
  // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
  const client = api as any
  const res = await client.sessions[":id"].stop.$post({ param: { id: short } })
  return Boolean(res.ok)
}
