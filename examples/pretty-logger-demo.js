#!/usr/bin/env node

const PrettyLogger = require('../src/utils/pretty-logger');
const chalk = require('chalk');

// Create logger instance
const logger = new PrettyLogger();

async function runDemo() {
  console.clear();
  
  // 1. ASCII Banner
  logger.banner('Nightly Code', 'Standard');
  logger.divider('═', 60, 'cyan');
  console.log();

  // 2. Box with information
  logger.box('🎨 Pretty Logger Demo\nShowcasing all logging capabilities', {
    borderStyle: 'double',
    borderColor: 'magenta',
    padding: 2
  });
  console.log();

  // 3. Terminal Log Prettifiers Table (as requested)
  logger.info('Displaying Terminal Log Prettifiers Table:');
  logger.logPrettifiersTable();
  console.log();

  // 4. Various log levels with signale
  logger.divider('─', 60, 'gray');
  logger.info('Demonstrating Signale Logger Types:');
  logger.success('Build completed successfully');
  logger.error('Failed to connect to database');
  logger.warning('Low memory warning');
  logger.pending('Waiting for user input...');
  logger.complete('Task finished');
  logger.star('New feature released!');
  logger.note('Remember to update documentation');
  console.log();

  // 5. Spinner demonstrations
  logger.divider('─', 60, 'gray');
  logger.info('Demonstrating Spinners:');
  
  // Simulate async operations with spinners
  await logger.withSpinner('Installing dependencies', async () => {
    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  await logger.withSpinner('Building project', async () => {
    await new Promise(resolve => setTimeout(resolve, 1500));
  });

  // Failed operation
  try {
    await logger.withSpinner('Deploying to production', async () => {
      await new Promise(resolve => setTimeout(resolve, 1000));
      throw new Error('Deployment failed');
    });
  } catch (err) {
    // Error already handled by spinner
  }
  console.log();

  // 6. Progress bars
  logger.divider('─', 60, 'gray');
  logger.info('Demonstrating Progress Bars:');
  for (let i = 0; i <= 10; i++) {
    process.stdout.write('\r');
    logger.progress(i, 10, 'Processing files:', 40);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  console.log();

  // 7. Status Dashboard
  logger.divider('─', 60, 'gray');
  logger.info('System Status Dashboard:');
  logger.statusDashboard('🖥️  Server Monitor', [
    { label: 'CPU Usage', value: '45%', status: 'success' },
    { label: 'Memory', value: '72% (5.7 GB / 8 GB)', status: 'warning' },
    { label: 'Disk Space', value: '28% (112 GB / 500 GB)', status: 'success' },
    { label: 'Network', value: 'Connected', status: 'success' },
    { label: 'Database', value: 'Connection Failed', status: 'error' },
    { label: 'Cache', value: 'Redis OK', status: 'success' },
    { label: 'Queue', value: '142 jobs pending', status: 'info' }
  ]);
  console.log();

  // 8. Task execution table
  logger.divider('─', 60, 'gray');
  logger.info('Task Execution Results:');
  logger.table([
    [chalk.bold('Task Results Summary'), '', '', ''],
    ['Status', 'Task', 'Duration', 'Result'],
    [chalk.green('✅'), 'Lint code', '2.3s', chalk.green('Passed')],
    [chalk.green('✅'), 'Run tests', '15.7s', chalk.green('142/142 passed')],
    [chalk.yellow('⚠️'), 'Build assets', '8.9s', chalk.yellow('3 warnings')],
    [chalk.red('❌'), 'Deploy', '45.2s', chalk.red('Failed')],
    [chalk.blue('🔄'), 'Cleanup', '1.1s', chalk.blue('In progress')]
  ], {
    columnWidths: [8, 20, 12, 20],
    align: ['center', 'left', 'center', 'left'],
    config: {
      spanningCells: [
        { col: 0, row: 0, colSpan: 4, alignment: 'center' }
      ]
    }
  });
  console.log();

  // 9. JSON output
  logger.divider('─', 60, 'gray');
  logger.info('Configuration (Pretty JSON):');
  logger.json({
    name: 'nightly-code',
    version: '1.1.7',
    features: {
      logging: true,
      automation: true,
      gitIntegration: true
    },
    dependencies: ['chalk', 'boxen', 'ora', 'signale', 'winston', 'figlet']
  });
  console.log();

  // 10. Winston logging
  logger.divider('─', 60, 'gray');
  logger.info('Winston Logger Output:');
  logger.winstonLog('info', 'Application started');
  logger.winstonLog('warn', 'Deprecated API usage detected');
  logger.winstonLog('error', 'Critical error in module X');
  console.log();

  // 11. Fancy completion message
  logger.divider('═', 60, 'cyan');
  logger.box(chalk.green('✨ Demo Completed Successfully! ✨\n\n') +
    chalk.white('All logging features demonstrated:\n') +
    chalk.gray('• ASCII Banners (figlet)\n') +
    chalk.gray('• Styled Boxes (boxen)\n') +
    chalk.gray('• Colorful Text (chalk)\n') +
    chalk.gray('• Spinners (ora)\n') +
    chalk.gray('• Fancy Logging (signale)\n') +
    chalk.gray('• Production Logging (winston)\n') +
    chalk.gray('• Tables with proper alignment\n') +
    chalk.gray('• Progress bars\n') +
    chalk.gray('• Status dashboards'), {
    borderStyle: 'round',
    borderColor: 'green',
    padding: 2,
    align: 'center'
  });
}

// Run the demo
runDemo().catch(console.error);