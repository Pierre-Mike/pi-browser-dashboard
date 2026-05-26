// Append a freshly-dropped file path to the current dispatch input value.
// If the input is empty, the path becomes the entire value; otherwise it is
// appended with a single separating space (or no extra char if the input
// already ends in whitespace).
export const appendPath = (current: string, path: string): string => {
  if (path.length === 0) return current
  if (current.length === 0) return path
  if (/\s$/.test(current)) return `${current}${path}`
  return `${current} ${path}`
}
