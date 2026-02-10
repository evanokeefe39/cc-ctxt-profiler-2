import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadProfiles } from '../loader.js';
import { matchProfile, getEffectiveThresholds } from '../matcher.js';
import { validateProfiles } from '../validator.js';
import { getTemplate, getTemplateNames } from '../templates.js';
import type { ProfilesConfig } from '../../schemas/index.js';
import { FALLBACK_THRESHOLDS } from '../../schemas/index.js';

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

const validConfig: ProfilesConfig = {
  profiles: [validProfile],
  fallbackThresholds: FALLBACK_THRESHOLDS,
};

describe('loadProfiles', () => {
  it('loads and validates a profiles file', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'ctx-diag-'));
    const filePath = join(tmpDir, 'profiles.json');
    writeFileSync(filePath, JSON.stringify(validConfig));

    const config = loadProfiles(filePath);
    expect(config.profiles).toHaveLength(1);
    expect(config.profiles[0].id).toBe('main-agent');

    rmSync(tmpDir, { recursive: true });
  });

  it('throws on invalid JSON', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'ctx-diag-'));
    const filePath = join(tmpDir, 'bad.json');
    writeFileSync(filePath, 'not json');
    expect(() => loadProfiles(filePath)).toThrow();
    rmSync(tmpDir, { recursive: true });
  });
});

describe('matchProfile', () => {
  it('matches by exact ID', () => {
    const match = matchProfile('main-agent', 'claude-sonnet-4-5-20250929', validConfig);
    expect(match).toBeDefined();
    expect(match!.matchType).toBe('exact');
    expect(match!.profile.id).toBe('main-agent');
  });

  it('falls back to model match', () => {
    const match = matchProfile('unknown-agent', 'claude-sonnet-4-5-20250929', validConfig);
    expect(match).toBeDefined();
    expect(match!.matchType).toBe('model-fallback');
  });

  it('returns undefined when no match', () => {
    const match = matchProfile('unknown-agent', 'unknown-model', validConfig);
    expect(match).toBeUndefined();
  });

  it('returns undefined when config is undefined', () => {
    const match = matchProfile('any', 'any', undefined);
    expect(match).toBeUndefined();
  });
});

describe('getEffectiveThresholds', () => {
  it('uses profile thresholds when matched', () => {
    const t = getEffectiveThresholds('main-agent', 'claude-sonnet-4-5-20250929', validConfig);
    expect(t.profileId).toBe('main-agent');
    expect(t.warningThreshold).toBe(0.70);
  });

  it('uses fallback thresholds when no match', () => {
    const t = getEffectiveThresholds('unknown', 'unknown', validConfig);
    expect(t.profileId).toBeUndefined();
    expect(t.warningThreshold).toBe(FALLBACK_THRESHOLDS.warningThreshold);
  });
});

describe('validateProfiles', () => {
  it('returns no errors for valid config', () => {
    const errors = validateProfiles(validConfig);
    expect(errors).toHaveLength(0);
  });

  it('catches duplicate IDs', () => {
    const config: ProfilesConfig = {
      profiles: [validProfile, { ...validProfile }],
    };
    const errors = validateProfiles(config);
    expect(errors.some((e) => e.message.includes('Duplicate'))).toBe(true);
  });

  it('catches warningThreshold >= dumbZoneThreshold', () => {
    const config: ProfilesConfig = {
      profiles: [
        {
          ...validProfile,
          alerts: { ...validProfile.alerts, warningThreshold: 0.90 },
        },
      ],
    };
    const errors = validateProfiles(config);
    expect(errors.some((e) => e.field === 'alerts.warningThreshold')).toBe(true);
  });

  it('catches budgets not summing to ~1.0', () => {
    const config: ProfilesConfig = {
      profiles: [
        {
          ...validProfile,
          budgets: {
            systemPrompt: 0.50,
            conversation: 0.50,
            toolResults: 0.50,
            outputReserve: 0.50,
          },
        },
      ],
    };
    const errors = validateProfiles(config);
    expect(errors.some((e) => e.field === 'budgets')).toBe(true);
  });

  it('catches expectedTurns min > max', () => {
    const config: ProfilesConfig = {
      profiles: [
        {
          ...validProfile,
          alerts: { ...validProfile.alerts, expectedTurns: [30, 10] },
        },
      ],
    };
    const errors = validateProfiles(config);
    expect(errors.some((e) => e.field === 'alerts.expectedTurns')).toBe(true);
  });

  it('warns about unrecognized model', () => {
    const config: ProfilesConfig = {
      profiles: [{ ...validProfile, model: 'gpt-4-turbo' }],
    };
    const errors = validateProfiles(config);
    expect(errors.some((e) => e.field === 'model')).toBe(true);
  });
});

describe('templates', () => {
  it('returns all template names', () => {
    const names = getTemplateNames();
    expect(names).toContain('retrieval');
    expect(names).toContain('analysis');
    expect(names).toContain('generation');
  });

  it('creates a template with defaults', () => {
    const profile = getTemplate('retrieval');
    expect(profile.id).toBe('retrieval');
    expect(profile.alerts.warningThreshold).toBe(0.70);
    expect(profile.alerts.dumbZoneThreshold).toBe(0.85);
  });

  it('applies overrides', () => {
    const profile = getTemplate('analysis', {
      id: 'my-analyzer',
      label: 'Custom analyzer',
      model: 'claude-opus-4-6',
    });
    expect(profile.id).toBe('my-analyzer');
    expect(profile.model).toBe('claude-opus-4-6');
    expect(profile.alerts.dumbZoneThreshold).toBe(0.65);
  });

  it('templates pass validation', () => {
    for (const name of getTemplateNames()) {
      const profile = getTemplate(name as any);
      const errors = validateProfiles({ profiles: [profile] });
      expect(errors).toHaveLength(0);
    }
  });
});
