import { emitDroppedPath } from "./dropEvents"

export type DropError = { readonly fileName: string; readonly message: string }

export type DropResult = {
  readonly paths: ReadonlyArray<string>
  readonly errors: ReadonlyArray<DropError>
}

export type HandleDropDeps = {
  readonly upload: (file: File) => Promise<string>
  readonly clipboard: Pick<Clipboard, "writeText">
}

export const handleDrop = async (
  files: ReadonlyArray<File>,
  deps: HandleDropDeps,
): Promise<DropResult> => {
  const paths: string[] = []
  const errors: DropError[] = []

  for (const file of files) {
    try {
      const path = await deps.upload(file)
      paths.push(path)
      emitDroppedPath(path)
    } catch (err) {
      errors.push({
        fileName: file.name,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  if (paths.length > 0) {
    await deps.clipboard.writeText(paths.join(" "))
  }

  return { paths, errors }
}
