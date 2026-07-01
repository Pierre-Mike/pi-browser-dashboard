import Markdown from "react-markdown"
import rehypeSanitize from "rehype-sanitize"
import remarkGfm from "remark-gfm"
import { components } from "../projects/MarkdownView"

// Reuses MarkdownView's exact pipeline (GFM, sanitize, Shiki/Mermaid fences)
// instead of the old bare `<pre>{text}</pre>` dump, so assistant replies get
// real headings/lists/tables/code blocks like every other Claude-style chat
// UI. `[&>*:first-child]:mt-0 [&>*:last-child]:mb-0` collapses the leading/
// trailing block margin so prose doesn't add dead space inside the bubble.
type Props = { text: string }

export const ChatMarkdown = ({ text }: Props) => (
  <div
    data-testid="chat-markdown"
    className="prose prose-slate dark:prose-invert max-w-none text-sm text-base-content [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
  >
    <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={components}>
      {text}
    </Markdown>
  </div>
)
