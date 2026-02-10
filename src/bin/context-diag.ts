import { Command } from 'commander';
import { watchCommand } from '../cli/commands/watch.js';
import { analyzeCommand } from '../cli/commands/analyze.js';
import { browseCommand } from '../cli/commands/browse.js';
import { profileValidateCommand } from '../cli/commands/profile-validate.js';

const program = new Command();

program
  .name('context-diag')
  .description('Claude Code context window diagnostics')
  .version('0.1.0');

program.addCommand(watchCommand);
program.addCommand(analyzeCommand);
program.addCommand(browseCommand);

// `context-diag profile validate --profiles <file>`
const profileCmd = new Command('profile').description('Profile management commands');
profileCmd.addCommand(profileValidateCommand);
program.addCommand(profileCmd);

program.parse();
