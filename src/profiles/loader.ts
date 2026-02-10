import { readFileSync } from 'node:fs';
import { ProfilesConfigSchema, type ProfilesConfig } from '../schemas/index.js';

/**
 * Load and validate a context-profiles.json file.
 */
export function loadProfiles(filePath: string): ProfilesConfig {
  const raw = readFileSync(filePath, 'utf-8');
  const json = JSON.parse(raw);
  return ProfilesConfigSchema.parse(json);
}
