import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadProfiles } from '../../profiles/loader.js';
import { validateProfiles } from '../../profiles/validator.js';

export const profileValidateCommand = new Command('validate')
  .description('Validate a context-profiles.json file')
  .requiredOption('--profiles <file>', 'Path to context-profiles.json')
  .action((opts) => {
    const filePath = resolve(opts.profiles);
    if (!existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exit(1);
    }

    let config;
    try {
      config = loadProfiles(filePath);
    } catch (err) {
      console.error(`Schema validation failed:`);
      console.error(err);
      process.exit(1);
    }

    console.log(`Loaded ${config.profiles.length} profile(s) from ${filePath}`);

    const errors = validateProfiles(config);

    if (errors.length === 0) {
      console.log('\nAll profiles are valid!');
      for (const p of config.profiles) {
        console.log(`  - ${p.id}: ${p.displayName} (${p.model})`);
        console.log(`    Warning: ${(p.alerts.warningThreshold * 100).toFixed(0)}% | Dumb zone: ${(p.alerts.dumbZoneThreshold * 100).toFixed(0)}% | Max turns: ${p.alerts.maxTurnsTotal}`);
      }
    } else {
      console.error(`\nFound ${errors.length} validation error(s):\n`);
      for (const err of errors) {
        const prefix = err.profileId ? `[${err.profileId}]` : '[global]';
        console.error(`  ${prefix} ${err.field}: ${err.message}`);
      }
      process.exit(1);
    }
  });
