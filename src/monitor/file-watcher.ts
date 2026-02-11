import { watch as chokidarWatch, type FSWatcher as ChokidarWatcher } from 'chokidar';
import { watch as fsWatch, type WatchListener } from 'node:fs';
import { readJsonlIncremental } from '../parser/index.js';
import type { TranscriptLine } from '../schemas/index.js';

export interface FileWatcherOptions {
  sessionDir: string;
  onLines: (filePath: string, lines: TranscriptLine[]) => void;
  onNewFile?: (filePath: string) => void;
}

interface FileState {
  byteOffset: number;
  remainder: string;
}

/**
 * Watch JSONL files in a session directory for changes.
 *
 * Uses chokidar for file discovery (add/unlink) and native fs.watch
 * for per-file content tailing with 200ms debounce.
 */
export class FileWatcher {
  private discoveryWatcher: ChokidarWatcher | null = null;
  private fileWatchers = new Map<string, ReturnType<typeof fsWatch>>();
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private fileStates = new Map<string, FileState>();
  private options: FileWatcherOptions;

  constructor(options: FileWatcherOptions) {
    this.options = options;
  }

  /**
   * Start watching for JSONL file changes.
   */
  async start(): Promise<void> {
    const { sessionDir, onNewFile } = this.options;

    // Chokidar for file discovery only — no awaitWriteFinish, no change events
    this.discoveryWatcher = chokidarWatch(['*.jsonl', '*/subagents/*.jsonl'], {
      cwd: sessionDir,
      persistent: true,
      ignoreInitial: false,
    });

    this.discoveryWatcher.on('add', (relativePath) => {
      const fullPath = `${sessionDir}/${relativePath}`;
      onNewFile?.(fullPath);
      this.processFile(fullPath);
      this.watchFile(fullPath);
    });

    this.discoveryWatcher.on('unlink', (relativePath) => {
      const fullPath = `${sessionDir}/${relativePath}`;
      this.unwatchFile(fullPath);
    });
  }

  /**
   * Stop watching all files and discovery.
   */
  async stop(): Promise<void> {
    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    // Close all per-file watchers
    for (const watcher of this.fileWatchers.values()) {
      watcher.close();
    }
    this.fileWatchers.clear();

    // Close discovery watcher
    if (this.discoveryWatcher) {
      await this.discoveryWatcher.close();
      this.discoveryWatcher = null;
    }
  }

  private watchFile(filePath: string): void {
    if (this.fileWatchers.has(filePath)) return;

    try {
      const watcher = fsWatch(filePath, () => {
        // Debounce: clear existing timer, set new 200ms timer
        const existing = this.debounceTimers.get(filePath);
        if (existing) clearTimeout(existing);

        this.debounceTimers.set(
          filePath,
          setTimeout(() => {
            this.debounceTimers.delete(filePath);
            this.processFile(filePath);
          }, 200),
        );
      });

      this.fileWatchers.set(filePath, watcher);
    } catch {
      // File may not be accessible yet
    }
  }

  private unwatchFile(filePath: string): void {
    const timer = this.debounceTimers.get(filePath);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(filePath);
    }

    const watcher = this.fileWatchers.get(filePath);
    if (watcher) {
      watcher.close();
      this.fileWatchers.delete(filePath);
    }

    this.fileStates.delete(filePath);
  }

  private processFile(filePath: string): void {
    const state = this.fileStates.get(filePath) ?? { byteOffset: 0, remainder: '' };

    try {
      const result = readJsonlIncremental(filePath, state.byteOffset, state.remainder);

      this.fileStates.set(filePath, {
        byteOffset: result.bytesRead,
        remainder: result.remainder,
      });

      if (result.lines.length > 0) {
        this.options.onLines(filePath, result.lines);
      }
    } catch (err) {
      // File may be temporarily unavailable during writes
    }
  }
}
