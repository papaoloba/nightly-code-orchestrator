const chalk = require('chalk');
const boxen = require('boxen');
const ora = require('ora');
const signale = require('signale');
const winston = require('winston');
const figlet = require('figlet');
const { table } = require('table');

/**
 * Enhanced pretty logger using multiple logging libraries
 */
class PrettyLogger {
  constructor (options = {}) {
    this.options = {
      useColors: true,
      showTimestamps: true,
      ...options
    };

    // Configure signale
    this.signale = new signale.Signale({
      disabled: false,
      interactive: false,
      logLevel: 'info',
      stream: process.stdout,
      types: {
        remind: {
          badge: '🔔',
          color: 'yellow',
          label: 'reminder',
          logLevel: 'info'
        },
        santa: {
          badge: '🎅',
          color: 'red',
          label: 'santa',
          logLevel: 'info'
        }
      }
    });

    // Configure winston
    this.winston = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp }) => {
          return `${timestamp} [${level}]: ${message}`;
        })
      ),
      transports: [
        new winston.transports.Console()
      ]
    });
  }

  /**
   * Display a fancy ASCII banner
   */
  banner (text, font = 'Standard') {
    try {
      const ascii = figlet.textSync(text, {
        font,
        horizontalLayout: 'default',
        verticalLayout: 'default'
      });
      console.log(chalk.cyan(ascii));
    } catch (err) {
      console.log(chalk.cyan.bold(text));
    }
  }

  /**
   * Display text in a styled box
   */
  box (text, options = {}) {
    const defaultOptions = {
      padding: 1,
      margin: 1,
      borderStyle: 'round',
      borderColor: 'cyan',
      align: 'center'
    };

    // Strip emoji variant selectors (U+FE0F) that cause width calculation issues
    // This invisible character follows some emojis and confuses boxen's width calculations
    const cleanedText = text.replace(/\uFE0F/g, '');

    const boxOptions = { ...defaultOptions, ...options };
    console.log(boxen(cleanedText, boxOptions));
  }

  /**
   * Format a path for display, truncating if necessary
   */
  formatPath (path, maxLength = 50) {
    if (path.length <= maxLength) {
      return path;
    }

    const parts = path.split('/');
    const fileName = parts[parts.length - 1];
    const start = path.substring(0, maxLength - fileName.length - 4);

    return `${start}.../${fileName}`;
  }

  /**
   * Create a formatted table with proper alignment
   */
  table (data, options = {}) {
    const defaultConfig = {
      border: {
        topBody: '─',
        topJoin: '┬',
        topLeft: '┌',
        topRight: '┐',
        bottomBody: '─',
        bottomJoin: '┴',
        bottomLeft: '└',
        bottomRight: '┘',
        bodyLeft: '│',
        bodyRight: '│',
        bodyJoin: '│',
        joinBody: '─',
        joinLeft: '├',
        joinRight: '┤',
        joinJoin: '┼'
      },
      columns: {}
    };

    // Apply column configurations
    if (options.columnWidths) {
      options.columnWidths.forEach((width, index) => {
        defaultConfig.columns[index] = { width };
      });
    }

    if (options.align) {
      options.align.forEach((alignment, index) => {
        defaultConfig.columns[index] = {
          ...defaultConfig.columns[index],
          alignment
        };
      });
    }

    const config = { ...defaultConfig, ...options.config };
    const output = table(data, config);
    console.log(output);
  }

  /**
   * Create the terminal log prettifiers demo table
   */
  logPrettifiersTable () {
    const data = [
      [chalk.yellow.bold('📦 Terminal Log Prettifiers'), ''],
      [chalk.gray('Library'), chalk.gray('Description')],
      ['chalk', '🎨 Colorize text (bold, bg, underline, etc.)'],
      ['', 'ex: chalk.green(\'Success!\')'],
      ['ora', '⏳ Spinners for async loading animations'],
      ['', 'ex: ora(\'Loading...\').start()'],
      ['figlet', '🅰️  Big ASCII art text'],
      ['', 'ex: figlet.textSync(\'Hello!\')'],
      ['boxen', '📦 Boxed messages with style'],
      ['', 'ex: boxen(\'Success\', {borderStyle: \'round\'})'],
      ['signale', '🪵 Fancy logger with types & timestamps'],
      ['', 'ex: signale.success(\'Done!\')'],
      ['winston', '🏭 Robust logger for dev + prod'],
      ['', 'ex: winston.createLogger(...)']
    ];

    const config = {
      border: {
        topBody: '─',
        topJoin: '┬',
        topLeft: '┌',
        topRight: '┐',
        bottomBody: '─',
        bottomJoin: '┴',
        bottomLeft: '└',
        bottomRight: '┘',
        bodyLeft: '│',
        bodyRight: '│',
        bodyJoin: '│',
        joinBody: '─',
        joinLeft: '├',
        joinRight: '┤',
        joinJoin: '┼'
      },
      spanningCells: [
        { col: 0, row: 0, colSpan: 2, alignment: 'center' }
      ],
      columns: {
        0: { width: 12, alignment: 'left' },
        1: { width: 52, alignment: 'left', wrapWord: false }
      }
    };

    console.log(table(data, config));
    console.log(chalk.yellow('💡 Tip: ') + chalk.white('Combine chalk + boxen + ora for powerful CLI UX!'));
  }

  /**
   * Show a spinner with custom text
   */
  spinner (text) {
    const spinner = ora({
      text,
      spinner: 'dots',
      color: 'cyan'
    }).start();

    return {
      succeed: (text) => spinner.succeed(chalk.green(text)),
      fail: (text) => spinner.fail(chalk.red(text)),
      warn: (text) => spinner.warn(chalk.yellow(text)),
      info: (text) => spinner.info(chalk.blue(text)),
      stop: () => spinner.stop(),
      text: (newText) => { spinner.text = newText; }
    };
  }

  /**
   * Async spinner wrapper
   */
  async withSpinner (text, action) {
    const spinner = this.spinner(text);
    try {
      const result = await action();
      spinner.succeed(`${text} - Done!`);
      return result;
    } catch (error) {
      spinner.fail(`${text} - Failed!`);
      throw error;
    }
  }

  /**
   * Signale logger methods
   */
  success (message) {
    this.signale.success(message);
  }

  error (message) {
    this.signale.error(message);
  }

  warning (message) {
    this.signale.warn(message);
  }

  info (message) {
    this.signale.info(message);
  }

  debug (message) {
    this.signale.debug(message);
  }

  pending (message) {
    this.signale.pending(message);
  }

  complete (message) {
    this.signale.complete(message);
  }

  fatal (message) {
    this.signale.fatal(message);
  }

  fav (message) {
    this.signale.fav(message);
  }

  star (message) {
    this.signale.star(message);
  }

  note (message) {
    this.signale.note(message);
  }

  pause (message) {
    this.signale.pause(message);
  }

  start (message) {
    this.signale.start(message);
  }

  await (message) {
    this.signale.await(message);
  }

  watch (message) {
    this.signale.watch(message);
  }

  log (message) {
    this.signale.log(message);
  }

  /**
   * Winston logger methods
   */
  winstonLog (level, message) {
    this.winston.log(level, message);
  }

  /**
   * Colorful section divider
   */
  divider (char = '─', length = 60, color = 'gray') {
    console.log(chalk[color](char.repeat(length)));
  }

  /**
   * Progress bar
   */
  progress (current, total, label = '', width = 30) {
    const percentage = Math.round((current / total) * 100);
    const filled = Math.round((current / total) * width);
    const empty = width - filled;

    const bar = chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
    const text = `${label} ${bar} ${percentage}%`;

    console.log(text);
  }

  /**
   * Pretty print JSON
   */
  json (obj, indent = 2) {
    console.log(chalk.gray(JSON.stringify(obj, null, indent)));
  }

  /**
   * Create a status dashboard
   */
  statusDashboard (title, items) {
    const rows = [[chalk.bold(title), '']];

    items.forEach(item => {
      const { label, value, status } = item;
      let statusIcon = '';
      let valueColor = 'white';

      if (status === 'success') {
        statusIcon = chalk.green('✓');
        valueColor = 'green';
      } else if (status === 'warning') {
        statusIcon = chalk.yellow('⚠');
        valueColor = 'yellow';
      } else if (status === 'error') {
        statusIcon = chalk.red('✗');
        valueColor = 'red';
      } else if (status === 'info') {
        statusIcon = chalk.blue('ℹ');
        valueColor = 'blue';
      }

      rows.push([
        `${statusIcon} ${label}`,
        chalk[valueColor](value)
      ]);
    });

    const config = {
      border: {
        topBody: '═',
        topJoin: '╤',
        topLeft: '╔',
        topRight: '╗',
        bottomBody: '═',
        bottomJoin: '╧',
        bottomLeft: '╚',
        bottomRight: '╝',
        bodyLeft: '║',
        bodyRight: '║',
        bodyJoin: '│',
        joinBody: '─',
        joinLeft: '╟',
        joinRight: '╢',
        joinJoin: '┼'
      },
      spanningCells: [
        { col: 0, row: 0, colSpan: 2, alignment: 'center' }
      ],
      columns: {
        0: { width: 25, alignment: 'left' },
        1: { width: 35, alignment: 'left' }
      }
    };

    console.log(table(rows, config));
  }
}

module.exports = PrettyLogger;
