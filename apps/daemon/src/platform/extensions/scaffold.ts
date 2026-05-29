import { parseManifest } from "./manifest"

export type ScaffoldTier = "iframe"
export type ScaffoldScope = "global" | "local"

export type ScaffoldFile = {
  relPath: string
  content: string
}

export type ScaffoldResult =
  | { ok: true; dirName: string; files: ScaffoldFile[] }
  | { ok: false; error: string }

export type ScaffoldOptions = {
  tier?: ScaffoldTier
  scope?: ScaffoldScope
}

const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/

const validateName = (name: string): string | null => {
  if (!name || name.length === 0) return "name must not be empty"
  if (name.includes("/") || name.includes("\\")) return "name must not contain path separators"
  if (name.includes("..")) return "name must not contain '..'"
  if (!NAME_RE.test(name)) {
    return "name must match /^[a-z0-9][a-z0-9._-]*$/ (lowercase, start with alphanumeric, no slashes)"
  }
  return null
}

const buildManifestJson = (name: string): string => {
  const manifest = {
    name,
    version: "0.0.1",
    tier: "iframe",
    contributes: {
      tabs: [{ id: "main", label: name }],
    },
  }
  return `${JSON.stringify(manifest, null, 2)}\n`
}

const buildIndexHtml = (name: string): string => `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${name}</title>
    <style>
      body { font-family: system-ui, sans-serif; padding: 1.5rem; margin: 0; }
      pre { background: #f4f4f4; padding: 1rem; border-radius: 4px; overflow: auto; }
      .hint { color: #666; font-size: 0.85rem; margin-top: 1rem; }
    </style>
  </head>
  <body>
    <h2>${name}</h2>
    <p>Loading extension context&hellip;</p>
    <pre id="output"></pre>
    <!--
      fs capability: listFiles and readFile require the "fs" permission.
      Grant it in the dashboard Extensions tab for this extension.
    -->
    <p class="hint">
      To use <code>listFiles</code> / <code>readFile</code>, grant the
      <strong>fs</strong> capability in the dashboard Extensions tab.
    </p>
    <script>
      const output = document.getElementById("output")

      // Send a postMessage RPC to the dashboard host.
      // The iframe runs in an opaque origin (sandbox="allow-scripts"),
      // so we must target "*" and use message IDs to match replies.
      let nextId = 1

      function rpc(method, params) {
        return new Promise((resolve, reject) => {
          const id = nextId++
          const msg = { id, method, params }

          function onMessage(event) {
            const data = event.data
            if (!data || data.id !== id) return
            window.removeEventListener("message", onMessage)
            if (data.error) reject(new Error(data.error))
            else resolve(data.result)
          }

          window.addEventListener("message", onMessage)
          parent.postMessage(msg, "*")
        })
      }

      rpc("getContext")
        .then((ctx) => {
          output.textContent = JSON.stringify(ctx, null, 2)
          document.querySelector("p").textContent = "Extension context:"
        })
        .catch((err) => {
          output.textContent = "Error: " + err.message
        })
    </script>
  </body>
</html>
`

export const buildScaffold = (name: string, opts: ScaffoldOptions = {}): ScaffoldResult => {
  const nameError = validateName(name)
  if (nameError) return { ok: false, error: nameError }

  const manifestContent = buildManifestJson(name)

  // Verify the generated manifest parses correctly.
  const parsed = parseManifest(JSON.parse(manifestContent))
  if (!parsed.ok) {
    return { ok: false, error: `generated manifest failed validation: ${parsed.error}` }
  }

  const files: ScaffoldFile[] = [
    { relPath: "manifest.json", content: manifestContent },
    { relPath: "index.html", content: buildIndexHtml(name) },
  ]

  return { ok: true, dirName: name, files }
}
