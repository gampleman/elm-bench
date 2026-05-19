import fs from "node:fs";
import path from "node:path";

export interface WatchHandle {
  close(): void;
}

export function startWatching(options: {
  paths: string[];
  debounceMs: number;
  onChange: (changedPath: string) => void | Promise<void>;
}): WatchHandle {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastChangedPath = "";
  let isRunning = false;
  let pendingPath: string | null = null;

  const watchers: fs.FSWatcher[] = [];

  function handleChange(filename: string | null, dir: string) {
    if (!filename) return;
    if (!filename.endsWith(".elm")) return;
    if (filename.includes("elm-stuff")) return;

    const fullPath = path.join(dir, filename);
    lastChangedPath = fullPath;

    if (timer) clearTimeout(timer);
    timer = setTimeout(() => trigger(), options.debounceMs);
  }

  async function trigger() {
    if (isRunning) {
      pendingPath = lastChangedPath;
      return;
    }

    isRunning = true;
    try {
      await options.onChange(lastChangedPath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nWatch error: ${message}`);
    } finally {
      isRunning = false;
      if (pendingPath) {
        const p = pendingPath;
        pendingPath = null;
        lastChangedPath = p;
        await trigger();
      }
    }
  }

  for (const watchPath of options.paths) {
    try {
      const watcher = fs.watch(
        watchPath,
        { recursive: true },
        (_event, filename) => handleChange(filename, watchPath)
      );
      watchers.push(watcher);
    } catch {
      // Directory might not exist, skip
    }
  }

  return {
    close() {
      if (timer) clearTimeout(timer);
      for (const w of watchers) w.close();
    },
  };
}
