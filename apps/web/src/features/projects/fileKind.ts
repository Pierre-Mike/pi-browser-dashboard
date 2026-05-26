export type FileKind =
  | "markdown"
  | "html"
  | "image"
  | "audio"
  | "video"
  | "pdf"
  | "svg"
  | "canvas"
  | "code"
  | "text"
  | "binary"

const KIND_BY_EXT: Readonly<Record<string, FileKind>> = {
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  html: "html",
  htm: "html",
  svg: "svg",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  avif: "image",
  bmp: "image",
  ico: "image",
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  oga: "audio",
  flac: "audio",
  m4a: "audio",
  aac: "audio",
  mp4: "video",
  m4v: "video",
  mov: "video",
  webm: "video",
  ogv: "video",
  pdf: "pdf",
  canvas: "canvas",
  ts: "code",
  tsx: "code",
  js: "code",
  mjs: "code",
  cjs: "code",
  jsx: "code",
  css: "code",
  json: "code",
  jsonl: "code",
  ndjson: "code",
  xml: "code",
  yaml: "code",
  yml: "code",
  toml: "code",
  rs: "code",
  go: "code",
  py: "code",
  rb: "code",
  java: "code",
  c: "code",
  h: "code",
  cpp: "code",
  hpp: "code",
  cs: "code",
  swift: "code",
  kt: "code",
  sh: "code",
  bash: "code",
  zsh: "code",
  fish: "code",
  sql: "code",
  graphql: "code",
  gql: "code",
  txt: "text",
  log: "text",
  csv: "text",
  tsv: "text",
}

const extOf = (path: string): string => {
  const name = path.toLowerCase()
  const slash = name.lastIndexOf("/")
  const base = slash >= 0 ? name.slice(slash + 1) : name
  const dot = base.lastIndexOf(".")
  if (dot <= 0 || dot === base.length - 1) return ""
  return base.slice(dot + 1)
}

export const classifyFile = (path: string, isBinary: boolean): FileKind => {
  const ext = extOf(path)
  const byExt = KIND_BY_EXT[ext]
  if (byExt) return byExt
  return isBinary ? "binary" : "text"
}

export const basenameOf = (path: string): string => {
  const i = path.lastIndexOf("/")
  return i < 0 ? path : path.slice(i + 1)
}
