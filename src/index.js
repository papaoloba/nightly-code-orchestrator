const { Orchestrator } = require('./orchestrator');
const { TaskManager } = require('./task-manager');
const { GitManager } = require('./git-manager');
const { Validator } = require('./validator');
const { Reporter } = require('./reporter');

// Export all main classes for programmatic use
module.exports = {
  Orchestrator,
  TaskManager,
  GitManager,
  Validator,
  Reporter
};

// If run directly, show information about the package
if (require.main === module) {
  const packageJson = require('../package.json');

  console.log(`${packageJson.name} v${packageJson.version}`);
  console.log(packageJson.description);
  console.log('');
  console.log('Usage:');
  console.log('  nightly-code <command> [options]');
  console.log('');
  console.log('Commands:');
  console.log('  init       Initialize configuration in current repository');
  console.log('  schedule   Set up automated scheduling');
  console.log('  run        Execute a single coding session manually');
  console.log('  status     Check last session results');
  console.log('  config     Manage configuration interactively');
  console.log('  validate   Validate current configuration');
  console.log('  report     View session reports');
  console.log('');
  console.log('For more information, run: nightly-code --help');
}
