#!/usr/bin/env node

/**
 * Example of integrating PrettyLogger into the nightly-code orchestrator
 */

const PrettyLogger = require('../src/utils/pretty-logger');
const chalk = require('chalk');

// Initialize the pretty logger
const logger = new PrettyLogger();

// Simulate a nightly code session
async function simulateNightlyCodeSession() {
  // Show banner
  logger.banner('Nightly Code', 'Small');
  logger.divider('═', 60, 'cyan');
  
  // Show session info box
  logger.box([
    '🌙 Nightly Code Session',
    '',
    `Session ID: ${Date.now()}`,
    `Start Time: ${new Date().toLocaleString()}`,
    `Duration: 8 hours`,
    `Tasks: 5 scheduled`
  ].join('\n'), {
    borderStyle: 'double',
    borderColor: 'blue',
    padding: 1
  });
  console.log();

  // Task list table
  logger.info('Scheduled Tasks:');
  logger.table([
    ['ID', 'Task', 'Priority', 'Est. Time'],
    ['1', 'Implement auth system', chalk.red('High'), '2h'],
    ['2', 'Add unit tests', chalk.yellow('Medium'), '1.5h'],
    ['3', 'Update documentation', chalk.green('Low'), '30m'],
    ['4', 'Fix security issues', chalk.red('Critical'), '3h'],
    ['5', 'Deploy to staging', chalk.yellow('Medium'), '1h']
  ], {
    columnWidths: [5, 25, 10, 10],
    align: ['center', 'left', 'center', 'center']
  });
  console.log();

  // Simulate task execution
  logger.start('Beginning automated coding session...');
  
  const tasks = [
    { name: 'Initializing Claude Code', duration: 1000 },
    { name: 'Setting up git branches', duration: 800 },
    { name: 'Loading task configurations', duration: 600 },
    { name: 'Connecting to AI service', duration: 1200 }
  ];

  for (const task of tasks) {
    await logger.withSpinner(task.name, async () => {
      await new Promise(resolve => setTimeout(resolve, task.duration));
    });
  }
  
  console.log();
  logger.divider('─', 60, 'gray');
  
  // Simulate task progress
  logger.info('Task Progress:');
  const totalSteps = 20;
  for (let i = 0; i <= totalSteps; i++) {
    process.stdout.write('\r');
    logger.progress(i, totalSteps, 'Auth Implementation:', 40);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  console.log();
  
  // Show system status
  logger.statusDashboard('💻 System Resources', [
    { label: 'CPU Usage', value: '23%', status: 'success' },
    { label: 'Memory', value: '4.2 GB / 16 GB', status: 'success' },
    { label: 'Claude API', value: 'Connected', status: 'success' },
    { label: 'Git Status', value: 'Clean', status: 'success' },
    { label: 'Test Coverage', value: '87%', status: 'warning' }
  ]);
  console.log();
  
  // Task results
  logger.complete('Session completed successfully!');
  logger.divider('─', 60, 'gray');
  
  logger.table([
    [chalk.bold('Session Results'), '', '', ''],
    ['Status', 'Task', 'Commits', 'Result'],
    [chalk.green('✅'), 'Auth system', '12', chalk.green('Completed')],
    [chalk.green('✅'), 'Unit tests', '8', chalk.green('92% coverage')],
    [chalk.green('✅'), 'Documentation', '3', chalk.green('Updated')],
    [chalk.green('✅'), 'Security fixes', '7', chalk.green('All resolved')],
    [chalk.yellow('⚠️'), 'Staging deploy', '1', chalk.yellow('Pending review')]
  ], {
    columnWidths: [8, 20, 10, 22],
    align: ['center', 'left', 'center', 'left'],
    config: {
      spanningCells: [
        { col: 0, row: 0, colSpan: 4, alignment: 'center' }
      ]
    }
  });
  console.log();
  
  // Final summary box
  logger.box([
    chalk.green.bold('✨ Session Summary ✨'),
    '',
    '• Total commits: 31',
    '• Lines added: 2,847',
    '• Lines removed: 423',
    '• Tests passed: 142/145',
    '• Coverage: 87%',
    '• Time saved: ~6 hours',
    '',
    chalk.yellow('Ready for manual review!')
  ].join('\n'), {
    borderStyle: 'round',
    borderColor: 'green',
    padding: 2,
    align: 'left'
  });
}

// Run the simulation
simulateNightlyCodeSession().catch(console.error);