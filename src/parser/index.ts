import type { AgentTimeSeries } from '../schemas/index.js';
import { readJsonlFile } from './jsonl-reader.js';
import { discoverSessions } from './session-discovery.js';
import { buildAgentTimeSeries } from './time-series-builder.js';
import { basename } from 'node:path';

export { readJsonlFile, readJsonlIncremental, parseJsonlContent } from './jsonl-reader.js';
export {
  discoverSessions,
  findProjectSessionDirs,
  encodeDirectoryPath,
  decodeProjectName,
  discoverAllSessions,
} from './session-discovery.js';
export type { SessionListEntry } from './session-discovery.js';
export { computeUsedTokens } from './token-calculator.js';
export { buildAgentTimeSeries } from './time-series-builder.js';
export { detectCompactions } from './compaction-detector.js';

export interface ParsedSession {
  sessionId: string;
  agents: AgentTimeSeries[];
}

/**
 * Parse a session directory into time series data for all agents.
 */
export function parseSession(sessionDir: string): ParsedSession | null {
  const sessions = discoverSessions(sessionDir);
  if (sessions.length === 0) return null;

  const session = sessions[0]; // Most recent session
  return parseDiscoveredSession(session);
}

/**
 * Parse a specific session by ID within a project directory.
 * Unlike parseSession() which takes the most recent, this targets a specific session ID.
 */
export function parseSessionById(sessionDir: string, sessionId: string): ParsedSession | null {
  const sessions = discoverSessions(sessionDir);
  const session = sessions.find((s) => s.sessionId === sessionId);
  if (!session) return null;
  return parseDiscoveredSession(session);
}

function parseDiscoveredSession(session: { sessionId: string; sessionFile: string; agentFiles: string[] }): ParsedSession {
  const agents: AgentTimeSeries[] = [];

  // Parse main session file
  const mainLines = readJsonlFile(session.sessionFile);
  if (mainLines.length > 0) {
    const mainTs = buildAgentTimeSeries(
      session.sessionId,
      'Main session',
      mainLines,
    );
    agents.push(mainTs);
  }

  // Parse agent files
  for (const agentFile of session.agentFiles) {
    const agentLines = readJsonlFile(agentFile);
    if (agentLines.length > 0) {
      const name = basename(agentFile, '.jsonl');
      const agentTs = buildAgentTimeSeries(name, name, agentLines);
      agents.push(agentTs);
    }
  }

  return {
    sessionId: session.sessionId,
    agents,
  };
}
