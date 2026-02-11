import type { AgentTimeSeries } from '../schemas/index.js';
import type { HealthGrade } from '../schemas/summary.js';

export interface DagNode {
  agentId: string;
  parentId: string | null;
  model: string;
  label: string;
  health: HealthGrade;
  startMs: number;
  endMs: number;
  totalTurns: number;
  peakPct: number;
  y: number;
  children: string[];
}

export interface DagLayout {
  nodes: Map<string, DagNode>;
  rootId: string;
  timeMinMs: number;
  timeMaxMs: number;
  totalLanes: number;
}

export interface SpawnEdge {
  parentId: string;
  childId: string;
  spawnMs: number;
  parentY: number;
  childY: number;
}

function agentTimeRange(agent: AgentTimeSeries): { startMs: number; endMs: number } {
  if (agent.points.length === 0) return { startMs: 0, endMs: 0 };
  const startMs = new Date(agent.points[0].t).getTime();
  const endMs = new Date(agent.points[agent.points.length - 1].t).getTime();
  return { startMs, endMs };
}

export function buildDagLayout(
  agents: AgentTimeSeries[],
  sessionId: string,
  healthMap?: Map<string, HealthGrade>,
): DagLayout {
  const nodes = new Map<string, DagNode>();

  // Build nodes with time ranges
  const agentInfos = agents.map((a) => {
    const { startMs, endMs } = agentTimeRange(a);
    const peakPct = a.points.length > 0 ? Math.max(...a.points.map((p) => p.pct)) : 0;
    return { agent: a, startMs, endMs, peakPct };
  });

  // Find root: agent whose agentId === sessionId, fallback to earliest start
  let rootIdx = agentInfos.findIndex((a) => a.agent.agentId === sessionId);
  if (rootIdx < 0) {
    // Fallback: earliest start (exclude empty-points agents if possible)
    const withPoints = agentInfos.filter((a) => a.agent.points.length > 0);
    const candidates = withPoints.length > 0 ? withPoints : agentInfos;
    let earliest = Infinity;
    for (const info of candidates) {
      const idx = agentInfos.indexOf(info);
      if (info.startMs < earliest) {
        earliest = info.startMs;
        rootIdx = idx;
      }
    }
    if (rootIdx < 0) rootIdx = 0;
  }

  const rootInfo = agentInfos[rootIdx];
  const rootId = rootInfo.agent.agentId;

  // Sort children by startMs (agents with empty points go last)
  const children = agentInfos
    .filter((_, i) => i !== rootIdx)
    .sort((a, b) => {
      if (a.agent.points.length === 0 && b.agent.points.length > 0) return 1;
      if (a.agent.points.length > 0 && b.agent.points.length === 0) return -1;
      return a.startMs - b.startMs;
    });

  // Assign root y=0
  const rootNode: DagNode = {
    agentId: rootId,
    parentId: null,
    model: rootInfo.agent.model,
    label: rootInfo.agent.label,
    health: healthMap?.get(rootId) ?? 'healthy',
    startMs: rootInfo.startMs,
    endMs: rootInfo.endMs,
    totalTurns: rootInfo.agent.points.length,
    peakPct: rootInfo.peakPct,
    y: 0,
    children: children.map((c) => c.agent.agentId),
  };
  nodes.set(rootId, rootNode);

  // Children y=1,2,3...
  children.forEach((info, i) => {
    const id = info.agent.agentId;
    const node: DagNode = {
      agentId: id,
      parentId: rootId,
      model: info.agent.model,
      label: info.agent.label,
      health: healthMap?.get(id) ?? 'healthy',
      startMs: info.startMs,
      endMs: info.endMs,
      totalTurns: info.agent.points.length,
      peakPct: info.peakPct,
      y: i + 1,
      children: [],
    };
    nodes.set(id, node);
  });

  // Compute global time range
  let timeMinMs = Infinity;
  let timeMaxMs = -Infinity;
  for (const node of nodes.values()) {
    if (node.totalTurns > 0) {
      if (node.startMs < timeMinMs) timeMinMs = node.startMs;
      if (node.endMs > timeMaxMs) timeMaxMs = node.endMs;
    }
  }
  if (!isFinite(timeMinMs)) {
    timeMinMs = 0;
    timeMaxMs = 0;
  }

  return {
    nodes,
    rootId,
    timeMinMs,
    timeMaxMs,
    totalLanes: nodes.size,
  };
}

export function extractSpawnEdges(layout: DagLayout): SpawnEdge[] {
  const edges: SpawnEdge[] = [];
  for (const node of layout.nodes.values()) {
    if (node.parentId === null) continue;
    const parent = layout.nodes.get(node.parentId);
    if (!parent) continue;
    edges.push({
      parentId: node.parentId,
      childId: node.agentId,
      spawnMs: node.startMs,
      parentY: parent.y,
      childY: node.y,
    });
  }
  return edges;
}
