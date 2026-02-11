import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { SessionMonitor } from '../../monitor/session-monitor.js';
import { loadProfiles } from '../../profiles/loader.js';
import { openDatabase } from '../../db/database.js';

export const watchCommand = new Command('watch')
  .description('Start live monitoring with dashboard')
  .requiredOption('--session <dir>', 'Session directory to monitor')
  .option('--profiles <file>', 'Path to context-profiles.json')
  .option('--port <number>', 'Dashboard port', '8411')
  .option('--no-browser', 'Do not auto-open browser')
  .option('--persist', 'Persist data to SQLite for browse-mode access')
  .action(async (opts) => {
    const sessionDir = resolve(opts.session);
    if (!existsSync(sessionDir)) {
      console.error(`Session directory not found: ${sessionDir}`);
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

    // Optionally open database for persistence
    let dbHandle: { db: any; close: () => void } | undefined;
    let dbOpts: { db?: any; projectKey?: string; sessionId?: string } = {};
    if (opts.persist) {
      dbHandle = openDatabase();
      dbOpts = {
        db: dbHandle.db,
        projectKey: 'live-monitor',
        sessionId: resolve(sessionDir),
      };
    }

    const port = parseInt(opts.port, 10);
    const monitor = new SessionMonitor({
      sessionDir,
      profilesConfig,
      port,
      eventsLogFile: resolve(sessionDir, 'events.jsonl'),
      ...dbOpts,
    });

    const url = await monitor.start();
    console.log(`\nDashboard running at ${url}`);
    console.log('Watching for JSONL changes...\n');

    if (opts.browser !== false) {
      // Try to open browser
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

    // Handle graceful shutdown
    const shutdown = async () => {
      console.log('\nShutting down...');
      await monitor.stop();
      dbHandle?.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
