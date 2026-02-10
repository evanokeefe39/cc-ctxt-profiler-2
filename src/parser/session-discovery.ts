import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename, sep } from 'node:path';

export interface DiscoveredSession {
  sessionId: string;
  sessionFile: string;
  agentFiles: string[];
  mtime: Date;
}

export interface SessionListEntry {
  projectKey: string;
  projectName: string;
  sessionId: string;
  mtime: Date;
  sizeBytes: number;
  agentCount: number;
}

/**
 * Encode a directory path for use in filenames (replace separators with `-`).
 */
export function encodeDirectoryPath(dirPath: string): string {
  return dirPath.replace(new RegExp(`[${sep === '\\' ? '\\\\' : sep}/:]`, 'g'), '-');
}

/**
 * Scan a project directory for session and agent files.
 *
 * Real Claude Code structure:
 * ```
 * <project-dir>/
 *   <session-id>.jsonl                    ← main session file
 *   <session-id>/
 *     subagents/
 *       agent-<hash>.jsonl                ← subagent files
 * ```
 *
 * Returns sessions sorted by mtime (newest first).
 */
export function discoverSessions(sessionDir: string): DiscoveredSession[] {
  let entries: string[];
  try {
    entries = readdirSync(sessionDir);
  } catch {
    return [];
  }

  // Main session files: <uuid>.jsonl directly in the project dir
  const jsonlFiles = entries.filter((f) => f.endsWith('.jsonl') && !f.startsWith('agent-'));

  const sessions: DiscoveredSession[] = [];

  for (const sf of jsonlFiles) {
    const fullPath = join(sessionDir, sf);
    const sessionId = basename(sf, '.jsonl');
    let mtime: Date;
    try {
      mtime = statSync(fullPath).mtime;
    } catch {
      continue;
    }

    // Look for subagent files in <session-id>/subagents/
    const agentFiles: string[] = [];
    const subagentsDir = join(sessionDir, sessionId, 'subagents');
    if (existsSync(subagentsDir)) {
      try {
        const agentEntries = readdirSync(subagentsDir);
        for (const ae of agentEntries) {
          if (ae.endsWith('.jsonl')) {
            agentFiles.push(join(subagentsDir, ae));
          }
        }
      } catch {
        // ignore
      }
    }

    // Also check for flat agent-*.jsonl in same directory (test fixtures)
    const flatAgents = entries.filter((f) => f.startsWith('agent-') && f.endsWith('.jsonl'));
    for (const af of flatAgents) {
      agentFiles.push(join(sessionDir, af));
    }

    sessions.push({
      sessionId,
      sessionFile: fullPath,
      agentFiles,
      mtime,
    });
  }

  // Sort by mtime descending (newest first)
  sessions.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  return sessions;
}

/**
 * Given the Claude projects directory (~/.claude/projects/),
 * find all session directories.
 */
export function findProjectSessionDirs(projectsDir: string): string[] {
  const dirs: string[] = [];
  try {
    const entries = readdirSync(projectsDir);
    for (const entry of entries) {
      const fullPath = join(projectsDir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          dirs.push(fullPath);
        }
      } catch {
        continue;
      }
    }
  } catch {
    return [];
  }
  return dirs;
}

/**
 * Decode a project directory name back to a filesystem path.
 * Reverses the encoding used by Claude Code:
 *   `C--Users-evano-repos-foo` → `C:/Users/evano/repos/foo`
 *
 * Because `-` replaces both path separators and colon, but folder names
 * can also contain literal hyphens (e.g. `cc-ctxt-profiler-2`), we walk
 * the filesystem to resolve the ambiguity.
 */
export function decodeProjectName(encoded: string): string {
  // Try filesystem-based resolution first
  const resolved = resolveEncodedPath(encoded);
  if (resolved) return resolved;

  // Fallback: naive replacement (e.g. path no longer exists)
  const driveMatch = encoded.match(/^([A-Za-z])--(.*)$/);
  if (driveMatch) {
    const drive = driveMatch[1];
    const rest = driveMatch[2].replace(/-/g, '/');
    return `${drive}:/${rest}`;
  }
  if (encoded.startsWith('-')) {
    return encoded.replace(/-/g, '/');
  }
  return encoded.replace(/-/g, '/');
}

/**
 * Walk the filesystem to resolve an encoded project name back to a real path.
 * At each directory level, tries matching actual directory entries against the
 * remaining encoded string — longest match first (greedy) so hyphens inside
 * folder names are preserved.
 */
function resolveEncodedPath(encoded: string): string | null {
  let root: string;
  let remaining: string;

  const driveMatch = encoded.match(/^([A-Za-z])--(.*)$/);
  if (driveMatch) {
    root = `${driveMatch[1]}:\\`;
    remaining = driveMatch[2];
  } else if (encoded.startsWith('-')) {
    root = '/';
    remaining = encoded.slice(1);
  } else {
    return null;
  }

  return walkResolve(root, remaining);
}

function walkResolve(currentPath: string, remaining: string): string | null {
  if (remaining === '') return currentPath;

  let entries: string[];
  try {
    entries = readdirSync(currentPath);
  } catch {
    return null;
  }

  // Filter to directories, encode each name, sort longest-first for greedy match
  const candidates: Array<{ name: string; encoded: string }> = [];
  for (const name of entries) {
    try {
      if (!statSync(join(currentPath, name)).isDirectory()) continue;
    } catch {
      continue;
    }
    // Encode the directory name the same way Claude Code does
    const enc = name.replace(/[/\\:]/g, '-');
    candidates.push({ name, encoded: enc });
  }
  candidates.sort((a, b) => b.encoded.length - a.encoded.length);

  for (const { name, encoded: enc } of candidates) {
    if (remaining === enc) {
      return join(currentPath, name);
    }
    if (remaining.startsWith(enc + '-')) {
      const result = walkResolve(join(currentPath, name), remaining.slice(enc.length + 1));
      if (result) return result;
    }
  }

  return null;
}

/**
 * Discover all sessions across all projects under a projects directory.
 * Uses only readdirSync/statSync — no JSONL parsing.
 */
export function discoverAllSessions(projectsDir: string): SessionListEntry[] {
  const projectDirs = findProjectSessionDirs(projectsDir);
  const entries: SessionListEntry[] = [];

  for (const projectDir of projectDirs) {
    const projectKey = basename(projectDir);
    const projectName = decodeProjectName(projectKey);
    const sessions = discoverSessions(projectDir);

    for (const session of sessions) {
      let sizeBytes = 0;
      try {
        sizeBytes += statSync(session.sessionFile).size;
      } catch { /* ignore */ }
      for (const af of session.agentFiles) {
        try {
          sizeBytes += statSync(af).size;
        } catch { /* ignore */ }
      }

      entries.push({
        projectKey,
        projectName,
        sessionId: session.sessionId,
        mtime: session.mtime,
        sizeBytes,
        agentCount: session.agentFiles.length + 1, // main + subagents
      });
    }
  }

  // Sort by mtime descending
  entries.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  return entries;
}
