import { describe, it, expect } from 'vitest';
import {
  UsageSchema,
  TranscriptLineSchema,
  ContextWindowProfileSchema,
  ProfilesConfigSchema,
  DiagnosticEventSchema,
  AgentTimeSeriesSchema,
  SessionSummarySchema,
  MODEL_LIMITS,
  FALLBACK_THRESHOLDS,
  PROFILE_TEMPLATES,
} from '../index.js';

describe('UsageSchema', () => {
  it('accepts valid usage with all fields', () => {
    const result = UsageSchema.parse({
      input_tokens: 50000,
      output_tokens: 1200,
      cache_creation_input_tokens: 8000,
      cache_read_input_tokens: 12000,
    });
    expect(result.input_tokens).toBe(50000);
    expect(result.cache_creation_input_tokens).toBe(8000);
  });

  it('defaults optional cache fields to 0', () => {
    const result = UsageSchema.parse({
      input_tokens: 1000,
      output_tokens: 200,
    });
    expect(result.cache_creation_input_tokens).toBe(0);
    expect(result.cache_read_input_tokens).toBe(0);
  });

  it('rejects missing required fields', () => {
    expect(() => UsageSchema.parse({ input_tokens: 100 })).toThrow();
  });
});

describe('TranscriptLineSchema', () => {
  const validLine = {
    sessionId: 'abc-123',
    uuid: 'msg-001',
    parentUuid: null,
    timestamp: '2025-01-15T10:00:00Z',
    type: 'assistant' as const,
    isSidechain: false,
    message: {
      role: 'assistant' as const,
      model: 'claude-sonnet-4-5-20250929',
      content: [{ type: 'text', text: 'Hello' }],
      usage: {
        input_tokens: 50000,
        output_tokens: 1200,
        cache_creation_input_tokens: 8000,
        cache_read_input_tokens: 12000,
      },
    },
  };

  it('accepts valid transcript line', () => {
    const result = TranscriptLineSchema.parse(validLine);
    expect(result.sessionId).toBe('abc-123');
    expect(result.message.usage?.input_tokens).toBe(50000);
  });

  it('defaults isSidechain to false', () => {
    const { isSidechain, ...rest } = validLine;
    const result = TranscriptLineSchema.parse(rest);
    expect(result.isSidechain).toBe(false);
  });

  it('rejects invalid type', () => {
    expect(() =>
      TranscriptLineSchema.parse({ ...validLine, type: 'system' }),
    ).toThrow();
  });

  it('accepts user messages without usage', () => {
    const userLine = {
      ...validLine,
      type: 'user',
      message: {
        role: 'user' as const,
        content: [{ type: 'text', text: 'Hi' }],
      },
    };
    const result = TranscriptLineSchema.parse(userLine);
    expect(result.message.usage).toBeUndefined();
  });
});

describe('ContextWindowProfileSchema', () => {
  const validProfile = {
    id: 'main-agent',
    label: 'Main orchestrator',
    model: 'claude-sonnet-4-5-20250929',
    budgets: {
      systemPrompt: 0.10,
      conversation: 0.50,
      toolResults: 0.30,
      outputReserve: 0.10,
    },
    alerts: {
      warningThreshold: 0.70,
      dumbZoneThreshold: 0.85,
      compactionTarget: 0.50,
      maxTurnsInDumbZone: 3,
      maxToolErrorRate: 0.15,
      expectedTurns: [10, 30] as [number, number],
    },
  };

  it('accepts valid profile', () => {
    const result = ContextWindowProfileSchema.parse(validProfile);
    expect(result.id).toBe('main-agent');
  });

  it('rejects budgets > 1', () => {
    expect(() =>
      ContextWindowProfileSchema.parse({
        ...validProfile,
        budgets: { ...validProfile.budgets, systemPrompt: 1.5 },
      }),
    ).toThrow();
  });

  it('rejects negative thresholds', () => {
    expect(() =>
      ContextWindowProfileSchema.parse({
        ...validProfile,
        alerts: { ...validProfile.alerts, warningThreshold: -0.1 },
      }),
    ).toThrow();
  });
});

describe('ProfilesConfigSchema', () => {
  it('accepts config with profiles and optional fallback', () => {
    const config = {
      profiles: [],
      fallbackThresholds: FALLBACK_THRESHOLDS,
    };
    const result = ProfilesConfigSchema.parse(config);
    expect(result.fallbackThresholds?.warningThreshold).toBe(0.70);
  });

  it('accepts config without fallbackThresholds', () => {
    const result = ProfilesConfigSchema.parse({ profiles: [] });
    expect(result.fallbackThresholds).toBeUndefined();
  });
});

describe('DiagnosticEventSchema', () => {
  it('accepts valid event', () => {
    const event = {
      id: 'abcd1234',
      timestamp: '2025-01-15T10:00:00Z',
      agentId: 'main',
      severity: 'warning',
      type: 'warning_threshold_crossed',
      message: 'Agent main crossed warning threshold at 72%',
      data: { pct: 0.72 },
    };
    const result = DiagnosticEventSchema.parse(event);
    expect(result.type).toBe('warning_threshold_crossed');
  });

  it('rejects invalid event type', () => {
    expect(() =>
      DiagnosticEventSchema.parse({
        id: 'x',
        timestamp: 'now',
        agentId: 'a',
        severity: 'info',
        type: 'invalid_event',
        message: 'bad',
      }),
    ).toThrow();
  });
});

describe('AgentTimeSeriesSchema', () => {
  it('accepts valid time series', () => {
    const ts = {
      agentId: 'main',
      model: 'claude-sonnet-4-5-20250929',
      label: 'Main session',
      limit: 200000,
      threshold: 0.85,
      warningThreshold: 0.70,
      points: [
        { t: '2025-01-15T10:00:00Z', abs: 10000, pct: 0.05 },
        { t: '2025-01-15T10:01:00Z', abs: 30000, pct: 0.15 },
      ],
      compactions: [],
    };
    const result = AgentTimeSeriesSchema.parse(ts);
    expect(result.points).toHaveLength(2);
  });
});

describe('Constants', () => {
  it('has model limits for known models', () => {
    expect(MODEL_LIMITS['claude-sonnet-4-5-20250929']).toBe(200_000);
  });

  it('has profile templates', () => {
    expect(PROFILE_TEMPLATES.retrieval.warningThreshold).toBe(0.70);
    expect(PROFILE_TEMPLATES.analysis.dumbZoneThreshold).toBe(0.65);
    expect(PROFILE_TEMPLATES.generation.warningThreshold).toBe(0.60);
  });
});
