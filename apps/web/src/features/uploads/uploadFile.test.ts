import { describe, expect, it } from "bun:test"
import { uploadFile } from "./uploadFile"

type FetchCall = { readonly url: string; readonly init?: RequestInit }

const stubFetch = (responder: (call: FetchCall) => Response) => {
  const calls: FetchCall[] = []
  const fn = ((url: string, init?: RequestInit) => {
    const call: FetchCall = { url, init }
    calls.push(call)
    return Promise.resolve(responder(call))
  }) as unknown as typeof fetch
  return { fetch: fn, calls }
}

describe("uploadFile", () => {
  it("POSTs the file as multipart and returns the path the daemon reports", async () => {
    const { fetch, calls } = stubFetch(
      () =>
        new Response(JSON.stringify({ path: "/abs/2026-05-26/uuid-note.txt" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    )
    const file = new File(["hi"], "note.txt", { type: "text/plain" })
    const path = await uploadFile(file, { baseUrl: "http://api.example.test", fetch })
    expect(path).toBe("/abs/2026-05-26/uuid-note.txt")
    expect(calls).toHaveLength(1)
    const call = calls[0] as (typeof calls)[0]
    expect(call.url).toBe("http://api.example.test/uploads")
    expect(call.init?.method).toBe("POST")
    const body = call.init?.body
    expect(body).toBeInstanceOf(FormData)
    const sent = (body as FormData).get("file")
    expect(sent).toBeInstanceOf(File)
    expect((sent as File).name).toBe("note.txt")
  })

  it("throws when the daemon returns a non-2xx status", async () => {
    const { fetch } = stubFetch(
      () =>
        new Response(JSON.stringify({ error: "empty_file" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
    )
    const file = new File([], "blank.bin")
    await expect(uploadFile(file, { baseUrl: "http://api.example.test", fetch })).rejects.toThrow(
      /empty_file/,
    )
  })

  it("throws when the daemon response is missing the path field", async () => {
    const { fetch } = stubFetch(() => new Response(JSON.stringify({}), { status: 200 }))
    const file = new File(["x"], "x.bin")
    await expect(uploadFile(file, { baseUrl: "http://api.example.test", fetch })).rejects.toThrow(
      /invalid_response/,
    )
  })
})
