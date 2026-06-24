// Pure lifecycle wiring for the desktop main process, isolated from the
// Electrobun native runtime so it is unit-testable.

export type Stoppable = { stop: () => Promise<void> }

// Build a shutdown handler that stops the embedded daemon if it has finished
// booting. Tolerates a still-booting (null) daemon so quitting early never
// throws — the daemon boots in the background after the window opens.
export const makeShutdown = (getDaemon: () => Stoppable | null): (() => void) => {
  return () => {
    const daemon = getDaemon()
    if (daemon) void daemon.stop()
  }
}
