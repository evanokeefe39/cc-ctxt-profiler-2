import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { createBrowseServer } from '../../dashboard/browse-server.js';
import { openDatabase } from '../../db/database.js';
import { ingestAll } from '../../db/ingest.js';
import { loadProfiles } from '../../profiles/loader.js';

export const browseCommand = new Command('browse')
  .description('Browse all sessions across projects')
  .option('--projects-dir <dir>', 'Claude projects directory', join(homedir(), '.claude', 'projects'))
  .option('--profiles <file>', 'Path to context-profiles.json')
  .option('--port <number>', 'Server port', '8411')
  .option('--no-browser', 'Do not auto-open browser')
  .action(async (opts) => {
    const projectsDir = resolve(opts.projectsDir);
    if (!existsSync(projectsDir)) {
      console.error(`Projects directory not found: ${projectsDir}`);
      process.exit(1);
    }

    let profilesConfig;
    if (opts.profiles) {
      const profilesPath = resolve(opts.profiles);
      try {
        profilesConfig = loadProfiles(profilesPath);
        console.log(`Loaded profiles from ${profilesPath}`);
      } catch (err) {
        console.error(`Failed to load profiles: ${err}`);
        process.exit(1);
      }
    }

    // Open database and do initial ingest
    const { db, close: closeDb } = openDatabase();
    console.log('Indexing sessions...');
    const newMessages = ingestAll(db, projectsDir);
    console.log(`Indexed ${newMessages} new messages`);

    const port = parseInt(opts.port, 10);
    const server = createBrowseServer(db, projectsDir, profilesConfig);
    const url = await server.start(port);

    console.log(`\nSession browser running at ${url}`);
    console.log(`Scanning projects in: ${projectsDir}\n`);

    if (opts.browser !== false) {
      try {
        const { exec } = await import('node:child_process');
        const cmd =
          process.platform === 'win32'
            ? `start ${url}`
            : process.platform === 'darwin'
              ? `open ${url}`
              : `xdg-open ${url}`;
        exec(cmd);
      } catch {
        // ignore
      }
    }

    const shutdown = async () => {
      console.log('\nShutting down...');
      await server.stop();
      closeDb();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
