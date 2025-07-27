#!/usr/bin/env node

const LogFormatter = require('../src/log-formatter');
const chalk = require('chalk');

console.log('\n' + chalk.bold.cyan('=== Log Formatter Demo ===') + '\n');

// Demo 1: Logger Table (as shown in the user's example)
console.log(chalk.bold('1. Terminal Log Prettifiers Table:'));
console.log(LogFormatter.createLoggerTable());
console.log('\n');

// Demo 2: Simple Box
console.log(chalk.bold('2. Simple Box:'));
console.log(LogFormatter.createBox('Hello, World!', {
  borderColor: 'green',
  padding: 2
}));
console.log('\n');

// Demo 3: Multi-line Box with Title
console.log(chalk.bold('3. Box with Title:'));
console.log(LogFormatter.createBox([
  'This is a multi-line box',
  'with proper alignment',
  'and a fancy title!'
], {
  title: '✨ Example Box',
  borderColor: 'magenta',
  borderStyle: 'double'
}));
console.log('\n');

// Demo 4: Custom Table
console.log(chalk.bold('4. Custom Table:'));
const taskTable = LogFormatter.createTable([
  ['✅', 'Task 1', 'Completed', '2024-01-15'],
  ['🔄', 'Task 2', 'In Progress', '2024-01-16'],
  ['📋', 'Task 3', 'Pending', '2024-01-17'],
  ['❌', 'Task 4', 'Failed', '2024-01-18']
], {
  headers: ['Status', 'Task', 'State', 'Date'],
  borderColor: 'blue',
  headerColor: 'yellow',
  align: ['center', 'left', 'left', 'center']
});
console.log(taskTable);
console.log('\n');

// Demo 5: Box with Emojis and Colors
console.log(chalk.bold('5. Box with Emojis:'));
const emojiContent = [
  '🚀 ' + chalk.green('Launch successful!'),
  '📊 ' + chalk.yellow('Performance: 98%'),
  '🔒 ' + chalk.cyan('Security: Enabled'),
  '🌍 ' + chalk.magenta('Region: Global')
];
console.log(LogFormatter.createBox(emojiContent, {
  borderStyle: 'round',
  borderColor: 'white',
  padding: 1
}));
console.log('\n');

// Demo 6: Log Messages
console.log(chalk.bold('6. Formatted Log Messages:'));
console.log(LogFormatter.formatLogMessage('info', 'Application started successfully'));
console.log(LogFormatter.formatLogMessage('warn', 'Low memory warning'));
console.log(LogFormatter.formatLogMessage('error', 'Connection failed'));
console.log(LogFormatter.formatLogMessage('debug', 'Processing request #1234'));
console.log('\n');

// Demo 7: Complex Table with Row Separators
console.log(chalk.bold('7. Complex Table with Separators:'));
const complexTable = LogFormatter.createTable([
  ['Node.js', '18.17.0', '✅ Active LTS', 'Ryan Dahl'],
  ['Express', '4.18.2', '🔄 Maintained', 'TJ Holowaychuk'],
  ['React', '18.2.0', '✅ Current', 'Jordan Walke'],
  ['Vue.js', '3.3.4', '✅ Current', 'Evan You']
], {
  headers: ['Framework', 'Version', 'Status', 'Creator'],
  borderColor: 'cyan',
  headerColor: 'green',
  rowSeparators: true,
  align: ['left', 'center', 'left', 'left']
});
console.log(complexTable);
console.log('\n');

// Demo 8: Nested Boxes
console.log(chalk.bold('8. Status Dashboard:'));
const statusBox = LogFormatter.createBox([
  chalk.bold('System Status Dashboard'),
  '',
  '  CPU Usage:    ' + chalk.green('45%') + ' ' + '█'.repeat(9) + '░'.repeat(11),
  '  Memory:       ' + chalk.yellow('72%') + ' ' + '█'.repeat(14) + '░'.repeat(6),
  '  Disk Space:   ' + chalk.green('28%') + ' ' + '█'.repeat(6) + '░'.repeat(14),
  '  Network:      ' + chalk.green('✓ Connected'),
  '  Uptime:       ' + chalk.cyan('15 days, 3:42:15')
], {
  borderStyle: 'double',
  borderColor: 'white',
  padding: 1,
  title: '🖥️  Server Monitor'
});
console.log(statusBox);

console.log('\n' + chalk.gray('Demo completed!') + '\n');