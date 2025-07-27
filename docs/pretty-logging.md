# Pretty Logging System

Enhanced logging capabilities for nightly-code using popular Node.js logging libraries.

## Features

The new logging system integrates multiple best-in-class logging libraries:

- **chalk** - Terminal string styling with colors
- **boxen** - Create boxes in the terminal
- **ora** - Elegant terminal spinners
- **signale** - Hackable console logger with types
- **winston** - Universal logging library
- **figlet** - ASCII art text banners
- **table** - Properly aligned tables with Unicode box drawing

## Usage

### Basic Usage

```javascript
const PrettyLogger = require('./src/pretty-logger');
const logger = new PrettyLogger();

// Display a banner
logger.banner('My App', 'Standard');

// Show a box
logger.box('Important message', { 
  borderStyle: 'round',
  borderColor: 'cyan' 
});

// Create a table
logger.table([
  ['Name', 'Status', 'Time'],
  ['Task 1', '✅', '2.3s'],
  ['Task 2', '❌', '5.1s']
]);

// Use spinners
await logger.withSpinner('Processing...', async () => {
  // Your async operation
});

// Log with different levels
logger.success('Operation completed');
logger.error('Something went wrong');
logger.warning('Low memory');
```

### Terminal Log Prettifiers Demo

The system includes a pre-configured table showing all available logging libraries:

```javascript
logger.logPrettifiersTable();
```

This displays:
```
┌───────────────────────────────────────────────────────────────────┐
│                    📦 Terminal Log Prettifiers                    │
├──────────────┬────────────────────────────────────────────────────┤
│ Library      │ Description                                        │
├──────────────┼────────────────────────────────────────────────────┤
│ chalk        │ 🎨 Colorize text (bold, bg, underline, etc.)      │
│              │ ex: chalk.green('Success!')                        │
├──────────────┼────────────────────────────────────────────────────┤
│ ora          │ ⏳ Spinners for async loading animations           │
│              │ ex: ora('Loading...').start()                      │
├──────────────┼────────────────────────────────────────────────────┤
│ figlet       │ 🅰️  Big ASCII art text                             │
│              │ ex: figlet.textSync('Hello!')                      │
├──────────────┼────────────────────────────────────────────────────┤
│ boxen        │ 📦 Boxed messages with style                       │
│              │ ex: boxen('Success', {borderStyle: 'round'})       │
├──────────────┼────────────────────────────────────────────────────┤
│ signale      │ 🪵 Fancy logger with types & timestamps            │
│              │ ex: signale.success('Done!')                       │
├──────────────┼────────────────────────────────────────────────────┤
│ winston      │ 🏭 Robust logger for dev + prod                    │
│              │ ex: winston.createLogger(...)                      │
└──────────────┴────────────────────────────────────────────────────┘
💡 Tip: Combine chalk + boxen + ora for powerful CLI UX!
```

## Examples

### Running the Demos

```bash
# Pretty logger demo
node examples/pretty-logger-demo.js

# Integration example
node examples/integration-example.js

# Log formatter demo (custom implementation)
node examples/log-formatter-demo.js
```

### Status Dashboard

Create informative status dashboards:

```javascript
logger.statusDashboard('🖥️  Server Monitor', [
  { label: 'CPU Usage', value: '45%', status: 'success' },
  { label: 'Memory', value: '72%', status: 'warning' },
  { label: 'Network', value: 'Connected', status: 'success' },
  { label: 'Database', value: 'Error', status: 'error' }
]);
```

### Progress Bars

Show progress for long-running operations:

```javascript
for (let i = 0; i <= total; i++) {
  logger.progress(i, total, 'Processing:', 40);
}
```

## Integration with Nightly Code

The pretty logger can be integrated into the orchestrator for better visual feedback:

1. Replace console.log statements with appropriate logger methods
2. Use spinners for async operations
3. Display task results in formatted tables
4. Show system status in dashboards

## Benefits

- **Better Readability**: Colorful, well-formatted output
- **Professional Appearance**: ASCII art banners and styled boxes
- **Progress Tracking**: Spinners and progress bars for long operations
- **Structured Data**: Tables with proper alignment and borders
- **Multiple Log Levels**: Different visual styles for different message types
- **Production Ready**: Winston integration for file logging

## Troubleshooting

### Box Border Alignment

The new implementation ensures proper alignment by:
- Calculating visual width correctly (accounting for emojis and ANSI codes)
- Using the `table` library's built-in alignment features
- Properly handling multi-line cells
- Supporting spanning cells for headers

### Performance

The logging system is designed to be lightweight:
- Lazy loading of heavy dependencies (figlet)
- Minimal overhead for simple log operations
- Efficient table rendering
- Async spinner operations don't block