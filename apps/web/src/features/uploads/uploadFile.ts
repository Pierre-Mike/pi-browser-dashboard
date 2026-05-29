export type UploadDeps = {
  readonly baseUrl: string
  readonly fetch?: typeof fetch
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null

export const uploadFile = async (file: File, deps: UploadDeps): Promise<string> => {
  const form = new FormData()
  form.append("file", file)
  const f = deps.fetch ?? fetch
  const res = await f(`${deps.baseUrl}/uploads`, { method: "POST", body: form })
  let json: unknown
  try {
    json = await res.json()
  } catch {
    throw new Error(`upload_failed: status=${res.status}`)
  }
  if (!res.ok) {
    const code = isRecord(json) && typeof json.error === "string" ? json.error : "unknown_error"
    throw new Error(`upload_failed: ${code}`)
  }
  if (!isRecord(json) || typeof json.path !== "string") {
    throw new Error("upload_failed: invalid_response")
  }
  return json.path
}
