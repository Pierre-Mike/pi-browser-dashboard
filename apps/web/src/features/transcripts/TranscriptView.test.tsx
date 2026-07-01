import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { TranscriptMessage } from "../../lib/types"
import { TranscriptView } from "./TranscriptView"

const assistantMsg = (content: unknown[]): TranscriptMessage => ({
  type: "assistant",
  message: { role: "assistant", content },
})

const userMsg = (content: unknown): TranscriptMessage => ({
  type: "user",
  message: { role: "user", content },
})

const render = (messages: TranscriptMessage[]): string =>
  renderToStaticMarkup(createElement(TranscriptView, { messages }))

describe("TranscriptView markdown rendering", () => {
  test("renders assistant text through ChatMarkdown, producing real markup instead of literal syntax", () => {
    const html = render([
      assistantMsg([{ type: "text", text: "Here is **bold** and a list:\n\n- one\n- two" }]),
    ])
    expect(html).toContain('data-testid="chat-markdown"')
    expect(html).toContain("<strong")
    expect(html).toContain("<ul")
    expect(html).not.toContain("**bold**")
  })

  test("leaves user text as literal preformatted text, not markdown-parsed", () => {
    const html = render([userMsg("please use **bold** here")])
    expect(html).not.toContain('data-testid="chat-markdown"')
    expect(html).toContain("**bold**")
  })

  test("renders the final result message through ChatMarkdown too", () => {
    const html = render([{ type: "result", result: "All done: **success**" }])
    expect(html).toContain('data-testid="chat-markdown"')
    expect(html).toContain("<strong")
  })
})
