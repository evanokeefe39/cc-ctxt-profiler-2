import { watch, type FSWatcher } from 'chokidar';
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
 * Incrementally reads new lines and emits them via callbacks.
 */
export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private fileStates = new Map<string, FileState>();
  private options: FileWatcherOptions;

  constructor(options: FileWatcherOptions) {
    this.options = options;
  }

  /**
   * Start watching for JSONL file changes.
   */
  async start(): Promise<void> {
    const { sessionDir, onLines, onNewFile } = this.options;

    // Watch both top-level JSONL files and subagent files in subdirectories
    this.watcher = watch(['*.jsonl', '*/subagents/*.jsonl'], {
      cwd: sessionDir,
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
    });

    this.watcher.on('add', (relativePath) => {
      const fullPath = `${sessionDir}/${relativePath}`;
      onNewFile?.(fullPath);
      this.processFile(fullPath);
    });

    this.watcher.on('change', (relativePath) => {
      const fullPath = `${sessionDir}/${relativePath}`;
      this.processFile(fullPath);
    });
  }

  /**
   * Stop watching.
   */
  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
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
