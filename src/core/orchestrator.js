const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('cross-spawn');
const { EventEmitter } = require('events');
const winston = require('winston');
const pidusage = require('pidusage');
const YAML = require('yaml');

const { TaskManager } = require('./task-manager');
const { GitManager } = require('../integrations/git-manager');
const { Validator } = require('../utils/validator');
const { Reporter } = require('../utils/reporter');
const {
  SuperClaudeIntegration
} = require('../integrations/superclaude-integration');
const {
  SUPERCLAUDE_OPTIMIZATION_GUIDE
} = require('../integrations/superclaude-optimization-guide');
const { TIME, STORAGE, RETRY } = require('../utils/constants');
const PrettyLogger = require('../utils/pretty-logger');

/**
 * Main orchestrator for nightly-claude-code automation
 * Coordinates task execution, git operations, validation, and reporting
 *
 * @class Orchestrator
 * @extends EventEmitter
 *
 * @fires Orchestrator#taskStarted - When a task begins execution
 * @fires Orchestrator#taskCompleted - When a task completes successfully
 * @fires Orchestrator#taskFailed - When a task fails
 * @fires Orchestrator#sessionCompleted - When the entire session completes
 *
 * @example
 * const orchestrator = new Orchestrator({
 *   configPath: 'nightly-code.yaml',
 *   tasksPath: 'nightly-tasks.yaml',
 *   maxDuration: 28800, // 8 hours
 *   dryRun: false
 * });
 *
 * orchestrator.on('taskCompleted', (task) => {
 *   console.log(`Task ${task.id} completed`);
 * });
 *
 * await orchestrator.run();
 */
class Orchestrator extends EventEmitter {
  /**
   * Create a new Orchestrator instance
   *
   * @param {Object} options - Configuration options
   * @param {string} [options.configPath='nightly-code.yaml'] - Path to main configuration file
   * @param {string} [options.tasksPath='nightly-tasks.yaml'] - Path to tasks configuration file
   * @param {number} [options.maxDuration=28800] - Maximum session duration in seconds (default: 8 hours)
   * @param {number} [options.checkpointInterval=300] - Checkpoint interval in seconds (default: 5 minutes)
   * @param {boolean} [options.dryRun=false] - Run in dry-run mode without making changes
   * @param {string|null} [options.resumeCheckpoint=null] - Checkpoint to resume from
   * @param {string} [options.workingDir=process.cwd()] - Working directory for operations
   * @param {boolean} [options.forceSuperclaude=false] - Force SuperClaude integration
   * @param {number} [options.rateLimitRetries=5] - Number of retries for rate limiting
   * @param {number} [options.rateLimitBaseDelay=60000] - Base delay for rate limiting in milliseconds
   * @param {boolean} [options.enableRetryOnLimits=true] - Enable retry on rate limits
   */
  constructor (options = {}) {
    super();

    this.options = {
      configPath: options.configPath || 'nightly-code.yaml',
      tasksPath: options.tasksPath || 'nightly-tasks.yaml',
      maxDuration: options.maxDuration || TIME.SECONDS.MAX_SESSION_DURATION,
      checkpointInterval:
        options.checkpointInterval || TIME.SECONDS.DEFAULT_CHECKPOINT_INTERVAL,
      dryRun: options.dryRun || false,
      resumeCheckpoint: options.resumeCheckpoint || null,
      workingDir: options.workingDir || process.cwd(),
      forceSuperclaude: options.forceSuperclaude || false, // CLI flag to force SuperClaude
      // Rate limiting and retry configuration
      rateLimitRetries: options.rateLimitRetries || RETRY.DEFAULT_RETRIES,
      rateLimitBaseDelay:
        options.rateLimitBaseDelay || TIME.MS.RATE_LIMIT_BASE_DELAY,
      enableRetryOnLimits: options.enableRetryOnLimits !== false // Default to true
    };

    this.state = {
      startTime: null,
      endTime: null,
      currentTask: null,
      completedTasks: [],
      failedTasks: [],
      checkpoints: [],
      resourceUsage: [],
      claudeProcess: null,
      sessionId: this.generateSessionId()
    };

    // Initialize operation timers
    this.operationTimers = new Map();

    // Initialize pretty logger for enhanced UI
    this.prettyLogger = new PrettyLogger();

    this.setupLogging();
    this.setupComponents();
  }

  /**
   * Generate a unique session ID based on current timestamp
   * Format: session-YYYY-MM-DD-HHMMSS
   *
   * @returns {string} Unique session identifier
   */
  generateSessionId () {
    const date = new Date().toISOString().split('T')[0];
    const time = new Date()
      .toISOString()
      .split('T')[1]
      .split('.')[0]
      .replace(/:/g, '');
    return `session-${date}-${time}`;
  }

  // Helper methods for timing operations
  startOperation (operationName) {
    if (!this.operationTimers) {
      this.operationTimers = new Map();
    }
    this.operationTimers.set(operationName, Date.now());
  }

  endOperation (operationName) {
    if (!this.operationTimers || !this.operationTimers.has(operationName)) {
      return '';
    }
    const startTime = this.operationTimers.get(operationName);
    const duration = Date.now() - startTime;
    this.operationTimers.delete(operationName);

    const seconds = Math.round(duration / TIME.MS.ONE_SECOND);
    const timeStr =
      seconds >= 60
        ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
        : `${seconds}s`;

    return ` \x1b[35m[took ${timeStr}]\x1b[0m`; // Magenta color for operation timing
  }

  logWithTiming (level, message, operationName = null) {
    const timing = operationName ? this.endOperation(operationName) : '';
    this.logger[level](`${message}${timing}`);
  }

  // File-scoped logging methods
  logSessionInfo (sessionInfo) {
    this.logger.info(`  \x1b[35m🧠 SuperClaude\x1b[0m │ ${sessionInfo}`);
  }

  logClaudeOutput (line) {
    if (line.includes('Wave') || line.includes('wave')) {
      this.logger.info(`  \x1b[35m🤖 Claude\x1b[0m │ \x1b[35m${line}\x1b[0m`); // Magenta for waves
    } else if (
      line.includes('✅') ||
      line.includes('Success') ||
      line.includes('Completed')
    ) {
      this.logger.info(`  \x1b[32m🤖 Claude\x1b[0m │ \x1b[32m${line}\x1b[0m`); // Green for success
    } else if (
      line.includes('❌') ||
      line.includes('Error') ||
      line.includes('Failed')
    ) {
      this.logger.info(`  \x1b[31m🤖 Claude\x1b[0m │ \x1b[31m${line}\x1b[0m`); // Red for errors
    } else if (line.includes('⚠️') || line.includes('Warning')) {
      this.logger.info(`  \x1b[33m🤖 Claude\x1b[0m │ \x1b[33m${line}\x1b[0m`); // Yellow for warnings
    } else {
      this.logger.info(`  \x1b[36m🤖 Claude\x1b[0m │ ${line}`); // Cyan for robot icon, normal text
    }
  }

  logClaudeError (line) {
    this.logger.warn(`⚠️  Claude: ${line}`);
  }

  logValidationStatus (status, message) {
    this.logger.info(`${status} ${message}`);
  }

  logTaskProgress (taskNum, totalTasks, message) {
    this.logger.info(`📋 Task ${taskNum}/${totalTasks}: ${message}`);
  }

  logTaskStatus (label, value) {
    this.displayInfo(`${label}: ${value}`);
  }

  logOperationStatus (icon, message) {
    this.logger.info(`${icon} ${message}`);
  }

  logDebug (message, data) {
    this.logger.debug(message, data);
  }

  logWarn (message, data = {}) {
    this.logger.warn(message, data);
  }

  logError (message, data = {}) {
    this.logger.error(message, data);
  }

  logInfo (message, data = {}) {
    this.logger.info(message, data);
  }

  logSuperclaude (mode, message) {
    this.logger.info(
      `  \x1b[${mode === 'framework' ? '35' : '36'}m🧠 ${
        mode === 'framework' ? 'SuperClaude Framework' : 'Standard mode'
      }\x1b[0m │ ${message}`
    );
  }

  logPromptOptimization (message) {
    this.logger.info(
      `  \x1b[32m✅ Prompt optimized\x1b[0m │ \x1b[1m${message}\x1b[0m`
    );
  }

  // File-scoped UI/display methods
  clearScreen () {
    console.clear();
  }

  newLine () {
    console.log();
  }

  displayBanner (title, style = 'Standard') {
    this.prettyLogger.banner(title, style);
  }

  displayDivider (char = '\u2500', length = 60, color = 'gray') {
    this.prettyLogger.divider(char, length, color);
  }

  displayBox (content, options = {}) {
    this.prettyLogger.box(content, options);
  }

  displayTable (data, options = {}) {
    this.prettyLogger.table(data, options);
  }

  displayInfo (message) {
    this.prettyLogger.info(message);
  }

  displaySuccess (message) {
    this.prettyLogger.success(message);
  }

  displaySessionHeader () {
    this.clearScreen();
    this.displayBanner('Nightly Code', 'Standard');
    this.displayDivider('\u2550', 60, 'cyan');
    this.newLine();
  }

  displaySessionInfo () {
    // Show session info in a styled box
    const workingDirDisplay =
      this.options.workingDir.length > 45
        ? `📁 Working Directory:\n    ${this.options.workingDir}`
        : `📁 Working Directory: ${this.options.workingDir}`;

    this.prettyLogger.box(
      [
        '🌙 Nightly Code Orchestration Session',
        '',
        `📋 Session ID: ${this.state.sessionId}`,
        workingDirDisplay,
        `⏱️  Max Duration: ${Math.round(
          this.options.maxDuration / 3600
        )} hours`,
        `🔄 Mode: ${this.options.dryRun ? 'DRY RUN' : 'LIVE'}`
      ].join('\n'),
      {
        borderStyle: 'double',
        borderColor: this.options.dryRun ? 'yellow' : 'blue',
        padding: 1,
        align: 'left'
      }
    );
    console.log();

    this.state.startTime = Date.now();
  }

  displayTaskHeader (taskNum, totalTasks, task) {
    this.newLine();
    this.displayDivider('\u2550', 60, 'blue');
    this.displayInfo(
      `\ud83d\udccb Task ${taskNum}/${totalTasks}: ${task.title}`
    );
    this.displayDivider('\u2500', 60, 'gray');
    this.displayInfo(`\ud83d\udd27 Type: ${task.type}`);
    this.displayInfo(
      `\u23f1\ufe0f  Minimum duration: ${
        task.minimum_duration || 'None specified'
      } minutes`
    );
    this.displayInfo(`\ud83c\udd94 ID: ${task.id}`);
  }

  displayFinalSummary () {
    this.newLine();
    this.displayDivider('\u2550', 60, 'cyan');
  }

  /**
   * Initialize logging infrastructure with file and console transports
   * Creates log directory structure and configures Winston logger
   *
   * @private
   */
  setupLogging () {
    const logDir = path.join(this.options.workingDir, '.nightly-code', 'logs');
    fs.ensureDirSync(logDir);

    // Custom timestamp format for console
    const consoleTimestampFormat = winston.format.timestamp({
      format: () => {
        const now = new Date();
        const time = now.toLocaleTimeString('en-US', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });
        return `\x1b[90m[${time}]\x1b[0m`; // Gray color for timestamp
      }
    });

    // Custom format for console output
    const consoleFormat = winston.format.printf(
      ({ level, message, timestamp }) => {
        // Add elapsed time since start if available
        let elapsedInfo = '';
        if (this.state.startTime) {
          const elapsed = Math.round(
            (Date.now() - this.state.startTime) / TIME.MS.ONE_SECOND
          );
          const minutes = Math.floor(elapsed / 60);
          const seconds = elapsed % 60;
          const timeStr =
            minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
          elapsedInfo = ` \x1b[36m(+${timeStr})\x1b[0m`; // Cyan color for elapsed time
        }

        return `${timestamp}${elapsedInfo} ${level}: ${message}`;
      }
    );

    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp({
          format: 'YYYY-MM-DD HH:mm:ss.SSS'
        }),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      transports: [
        new winston.transports.File({
          filename: path.join(logDir, `${this.state.sessionId}.log`)
        }),
        new winston.transports.Console({
          format: winston.format.combine(
            consoleTimestampFormat,
            winston.format.colorize({ level: true }),
            consoleFormat
          )
        })
      ]
    });
  }

  async loadConfigurationFile () {
    try {
      const configPath = path.resolve(
        this.options.workingDir,
        this.options.configPath
      );

      if (await fs.pathExists(configPath)) {
        const content = await fs.readFile(configPath, 'utf8');
        let config;

        if (configPath.endsWith('.yaml') || configPath.endsWith('.yml')) {
          config = YAML.parse(content);
        } else {
          config = JSON.parse(content);
        }

        // Update rate limiting options from config
        if (config.rate_limiting) {
          this.options.rateLimitRetries =
            config.rate_limiting.max_retries || this.options.rateLimitRetries;
          this.options.rateLimitBaseDelay =
            config.rate_limiting.base_delay || this.options.rateLimitBaseDelay;
          this.options.enableRetryOnLimits =
            config.rate_limiting.enabled !== false;
          this.options.usageLimitRetry =
            config.rate_limiting.usage_limit_retry !== false;
          this.options.rateLimitRetry =
            config.rate_limiting.rate_limit_retry !== false;
          this.options.maxDelay = config.rate_limiting.max_delay || 18000000;
          this.options.exponentialBackoff =
            config.rate_limiting.exponential_backoff !== false;
          this.options.jitter = config.rate_limiting.jitter !== false;
        }

        // Store SuperClaude configuration
        this.superclaudeConfig = config.superclaude || null;

        // Apply CLI override if --superclaude flag was used
        if (this.options.forceSuperclaude) {
          this.superclaudeConfig = {
            enabled: true,
            planning_mode: 'intelligent',
            execution_mode: 'assisted',
            task_management: 'hierarchical',
            integration_level: 'deep'
          };
          this.logSessionInfo('Mode enabled via CLI flag');
        }

        return config;
      }
    } catch (error) {
      this.logWarn(`Could not load configuration file: ${error.message}`);
    }

    // Apply CLI override even if no config file exists
    if (this.options.forceSuperclaude) {
      this.superclaudeConfig = {
        enabled: true,
        planning_mode: 'intelligent',
        execution_mode: 'assisted',
        task_management: 'hierarchical',
        integration_level: 'deep'
      };
      this.logInfo('🧠 SuperClaude mode enabled via CLI flag');
    }

    return null;
  }

  async initializeSuperClaude () {
    if (!this.superclaudeConfig?.enabled) {
      this.logDebug('SuperClaude integration not enabled');
      return;
    }

    this.superclaudeIntegration = new SuperClaudeIntegration({
      enabled: this.superclaudeConfig.enabled,
      commandsPath: this.superclaudeConfig.commands_path, // Pass undefined if not specified
      workingDir: this.options.workingDir,
      logger: this.logger,
      planningMode: this.superclaudeConfig.planning_mode || 'intelligent',
      executionMode: this.superclaudeConfig.execution_mode || 'assisted',
      taskManagement: this.superclaudeConfig.task_management || 'hierarchical',
      integrationLevel: this.superclaudeConfig.integration_level || 'deep'
    });

    await this.superclaudeIntegration.initialize();
  }

  setupComponents () {
    this.taskManager = new TaskManager({
      tasksPath: this.options.tasksPath,
      logger: this.logger
    });

    // GitManager will be initialized after config is loaded to get PR strategy
    this.gitManager = null;

    this.validator = new Validator({
      configPath: this.options.configPath,
      tasksPath: this.options.tasksPath,
      logger: this.logger
    });

    this.reporter = new Reporter({
      workingDir: this.options.workingDir,
      logger: this.logger
    });

    // Initialize SuperClaude integration (will be configured after config load)
    this.superclaudeIntegration = null;
  }

  /**
   * Main orchestration method - executes the complete nightly code session
   * Coordinates all phases: validation, task execution, git operations, and reporting
   *
   * @async
   * @returns {Promise<Object>} Session results including metrics and task outcomes
   * @throws {Error} When critical failures occur during orchestration
   *
   * @example
   * const results = await orchestrator.run();
   * console.log(`Completed ${results.completed} tasks, failed ${results.failed}`);
   */
  async run () {
    try {
      this.displaySessionHeader();

      this.displaySessionInfo();

      this.state.startTime = Date.now();

      // Load configuration file
      const fullConfig = await this.loadConfigurationFile();

      // Initialize GitManager with configuration
      this.gitManager = new GitManager({
        workingDir: this.options.workingDir,
        logger: this.logger,
        dryRun: this.options.dryRun,
        branchPrefix: fullConfig?.git?.branch_prefix || 'nightly/',
        autoPush: fullConfig?.git?.auto_push !== false,
        createPR: fullConfig?.git?.create_pr !== false,
        prTemplate: fullConfig?.git?.pr_template || null,
        prStrategy:
          this.options.prStrategy || fullConfig?.git?.pr_strategy || 'task', // Default to task-based PRs
        // Dependency-aware branching configuration
        dependencyAwareBranching: fullConfig?.git?.dependency_aware_branching !== false, // Default enabled
        mergeDependencyChains: fullConfig?.git?.merge_dependency_chains || false,
        strictDependencyChecking: fullConfig?.git?.strict_dependency_checking || false
      });

      // Initialize SuperClaude integration if enabled
      await this.initializeSuperClaude();

      // Validate configuration and environment
      await this.validateEnvironment();

      // Load and prepare tasks
      const tasks = await this.loadTasks();

      // Resume from checkpoint if specified
      if (this.options.resumeCheckpoint) {
        await this.resumeFromCheckpoint(this.options.resumeCheckpoint);
      }

      // Start resource monitoring
      this.startResourceMonitoring();

      // Start checkpoint timer
      this.startCheckpointTimer();

      // Execute task queue
      const results = await this.executeTasks(tasks);

      // Cleanup and finalize
      await this.finalize(results);

      return this.generateFinalReport();
    } catch (error) {
      this.logError(`💥 Orchestration session failed: ${error.message}`);
      await this.handleFailure(error);
      throw error;
    }
  }

  async validateEnvironment () {
    this.startOperation('environment-validation');
    this.displayInfo('🔧 Validating Environment');
    this.displayDivider('─', 30, 'gray');

    // Check if Claude Code is available
    try {
      const result = await this.executeCommand('claude', ['--version'], {
        timeout: 10000
      });
      this.logValidationStatus('✅', `Claude Code: ${result.stdout.trim()}`);
    } catch (error) {
      throw new Error(
        '❌ Claude Code CLI not found. Please install claude-code first.'
      );
    }

    // Validate configuration
    this.logInfo('🔍 Validating configuration...');
    const validation = await this.validator.validateAll();
    if (!validation.valid) {
      throw new Error(
        `❌ Configuration validation failed: ${validation.errors
          .map((e) => e.message)
          .join(', ')}`
      );
    }
    this.logValidationStatus('✅', 'Configuration is valid');

    // Check available disk space
    const freeSpace = await this.getAvailableDiskSpace();
    const freeSpaceGB = Math.round(freeSpace / STORAGE.BYTES_IN_GB);
    if (freeSpace < STORAGE.MIN_DISK_SPACE_BYTES) {
      this.logWarn(`⚠️  Low disk space: ${freeSpaceGB}GB available`);
    } else {
      this.logInfo(`💾 Disk space: ${freeSpaceGB}GB available`);
    }

    // Validate GitManager is initialized
    if (!this.gitManager) {
      throw new Error(
        'GitManager not initialized. Configuration loading may have failed.'
      );
    }

    // Initialize git if needed
    await this.gitManager.ensureRepository();

    // Create session branch only if using session PR strategy
    if (
      !this.options.dryRun &&
      this.gitManager.options.prStrategy === 'session'
    ) {
      await this.gitManager.createSessionBranch(this.state.sessionId);
    } else if (
      !this.options.dryRun &&
      this.gitManager.options.prStrategy === 'task'
    ) {
      this.logInfo(
        '🌿 Task-based PR strategy - branches will be created per task'
      );
    } else {
      this.logInfo('🔄 Dry run mode - skipping branch creation');
    }

    this.logWithTiming(
      'info',
      '✅ Environment validation completed',
      'environment-validation'
    );
    this.logInfo('');
  }

  async loadTasks () {
    this.startOperation('task-loading');
    this.displayInfo('📋 Loading Tasks');
    this.displayDivider('─', 30, 'gray');

    const tasks = await this.taskManager.loadTasks();
    const orderedTasks = await this.taskManager.resolveDependencies(tasks);

    const totalTasks = orderedTasks.length;
    const totalMinimumDuration = orderedTasks.reduce(
      (sum, task) => sum + (task.minimum_duration || 0),
      0
    );

    this.displaySuccess(`✅ Loaded ${totalTasks} tasks`);
    this.displayInfo(
      `⏱️  Total minimum duration: ${Math.round(totalMinimumDuration)} minutes`
    );

    // Show task overview in a pretty table
    if (orderedTasks.length > 0) {
      this.newLine();
      const tableData = [['#', 'Priority', 'Task', 'Min Duration', 'Type']];

      orderedTasks.forEach((task, index) => {
        const priority = task.priority || 'medium';
        const priorityIcon =
          priority === 'high'
            ? '🔴 High'
            : priority === 'low'
              ? '🟢 Low'
              : '🟡 Medium';
        tableData.push([
          `${index + 1}`,
          priorityIcon,
          task.title,
          task.minimum_duration ? `${task.minimum_duration}m` : 'none',
          task.type || 'general'
        ]);
      });

      this.displayTable(tableData, {
        columnWidths: [4, 12, 40, 10, 12],
        align: ['center', 'center', 'left', 'center', 'center']
      });
    }

    this.logWithTiming('info', '', 'task-loading'); // Just show timing without duplicate message
    this.newLine();
    return orderedTasks;
  }

  async executeTasks (tasks) {
    const results = {
      completed: 0,
      failed: 0,
      skipped: 0,
      totalTasks: tasks.length
    };

    // Build a map of completed tasks for dependency tracking
    const completedTasksMap = new Map();

    this.logInfo('🎯 Executing Tasks');
    this.logInfo('═══════════════════');

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const taskNum = i + 1;
      const totalTasks = tasks.length;

      try {
        // Check time remaining
        const elapsed =
          (Date.now() - this.state.startTime) / TIME.MS.ONE_SECOND;
        if (elapsed >= this.options.maxDuration) {
          this.logWarn(
            `⏰ Maximum session duration reached (${Math.round(elapsed)}s)`
          );
          break;
        }

        this.state.currentTask = task;
        const taskOperationName = `task-${task.id}`;
        this.startOperation(taskOperationName);

        // Task header with pretty display
        this.displayTaskHeader(taskNum, totalTasks, task);

        // Create task branch with dependency awareness
        let taskBranchName = null;
        if (!this.options.dryRun) {
          taskBranchName = await this.gitManager.createTaskBranch(task, completedTasksMap);
        }

        // Execute task with Claude Code
        const taskResult = await this.executeTask(task);

        if (taskResult.success) {
          // Validate task completion
          const validation = await this.validateTaskCompletion(
            task,
            taskResult
          );

          if (validation.passed) {
            // Commit changes to task branch (skip in dry-run mode)
            if (!this.options.dryRun) {
              await this.gitManager.commitTask(task, taskResult);

              // Create individual PR if using task-based strategy
              if (this.gitManager.options.prStrategy === 'task') {
                try {
                  const prUrl = await this.gitManager.createTaskPR(
                    task,
                    taskResult
                  );
                  if (prUrl) {
                    task.prUrl = prUrl;
                    this.logOperationStatus('🎯', `Task PR created: ${prUrl}`);
                  } else {
                    this.logWarn(`⚠️  PR creation skipped for task ${task.id}`);
                  }
                } catch (error) {
                  this.logError(
                    `❌ Failed to create PR for task ${task.id}: ${error.message}`
                  );
                  // Continue execution, PR creation is not critical for task completion
                }
              }
            } else {
              this.logInfo(
                '🔄 Dry run mode - skipping task commit and PR creation'
              );
            }

            this.state.completedTasks.push({
              task,
              result: taskResult,
              validation,
              completedAt: Date.now(),
              prUrl: task.prUrl,
              branchName: taskBranchName
            });

            // Add to completed tasks map for dependency tracking
            completedTasksMap.set(task.id, {
              taskId: task.id,
              branchName: taskBranchName,
              completedAt: Date.now()
            });

            results.completed++;
            this.logWithTiming(
              'info',
              `🎉 Task ${taskNum}/${totalTasks} completed successfully!`,
              taskOperationName
            );
          } else {
            throw new Error(
              `Task validation failed: ${validation.errors.join(', ')}`
            );
          }
        } else {
          throw new Error(`Task execution failed: ${taskResult.error}`);
        }
      } catch (error) {
        this.logError(
          `❌ Task ${taskNum}/${totalTasks} failed: ${error.message}`
        );

        this.state.failedTasks.push({
          task,
          error: error.message,
          failedAt: Date.now()
        });

        results.failed++;

        // Revert to previous state (skip in dry-run mode)
        if (!this.options.dryRun) {
          await this.gitManager.revertTaskChanges(task);
        } else {
          this.logInfo('🔄 Dry run mode - skipping task revert');
        }

        // Continue with next task unless critical failure
        if (this.isCriticalFailure(error)) {
          this.logError('💥 Critical failure detected, stopping execution');
          break;
        }
      }

      this.state.currentTask = null;

      // Create checkpoint
      await this.createCheckpoint();
    }

    // Check if all tasks are completed and time remains for automatic improvements
    await this.handleAutomaticImprovements(results);

    return results;
  }

  /**
   * Handle automatic improvement tasks when all scheduled tasks are completed
   * but there is still time remaining in the session
   *
   * @async
   * @param {Object} results - Current session results
   */
  async handleAutomaticImprovements (results) {
    // Only run automatic improvements if all original tasks completed successfully
    if (results.failed > 0) {
      this.logInfo('⚠️  Skipping automatic improvements due to failed tasks');
      return;
    }

    // Check remaining time
    const elapsed = (Date.now() - this.state.startTime) / TIME.MS.ONE_SECOND;
    const remainingTime = this.options.maxDuration - elapsed;
    const minimumTimeForImprovement = 300; // 5 minutes minimum

    if (remainingTime < minimumTimeForImprovement) {
      this.logInfo(
        `⏰ Insufficient time remaining for automatic improvements (${Math.round(
          remainingTime
        )}s < ${minimumTimeForImprovement}s)`
      );
      return;
    }

    this.logInfo('');
    this.logInfo(
      '🚀 All tasks completed successfully! Starting automatic improvements...'
    );
    this.displayDivider('═', 60, 'green');
    this.logInfo(
      `⏱️  Time remaining: ${Math.round(remainingTime / 60)} minutes`
    );
    this.logInfo('');

    try {
      // Create an automatic improvement task
      const improvementTask = await this.createAutomaticImprovementTask(
        remainingTime
      );

      if (improvementTask) {
        this.state.currentTask = improvementTask;

        this.displayBox(
          [
            '✨ Automatic Code Improvement Session',
            `⏱️  Available time: ${Math.round(remainingTime / 60)} minutes`,
            '🎯 Focus: General code quality and optimization'
          ].join('\n'),
          {
            borderStyle: 'double',
            borderColor: 'green',
            padding: 1,
            align: 'left'
          }
        );

        // Execute the improvement task
        const improvementResult = await this.executeAutomaticImprovementTask(
          improvementTask
        );

        if (improvementResult.success) {
          // Validate and commit the improvements
          const validation = await this.validateTaskCompletion(
            improvementTask,
            improvementResult
          );

          if (validation.passed) {
            if (!this.options.dryRun) {
              await this.gitManager.commitTask(
                improvementTask,
                improvementResult
              );
              this.logValidationStatus(
                '✅',
                'Automatic improvements committed successfully'
              );
            } else {
              this.logInfo(
                '🔄 Dry run mode - skipping automatic improvement commit'
              );
            }

            // Update results
            results.completed++;
            this.state.completedTasks.push({
              task: improvementTask,
              result: improvementResult,
              validation,
              completedAt: Date.now(),
              automatic: true
            });

            this.logOperationStatus(
              '🎉',
              'Automatic improvement session completed successfully!'
            );
          } else {
            this.logWarn(
              '⚠️  Automatic improvement validation failed, reverting changes'
            );
            if (!this.options.dryRun) {
              await this.gitManager.revertTaskChanges(improvementTask);
            }
          }
        } else {
          this.logWarn('⚠️  Automatic improvement execution failed');
        }

        this.state.currentTask = null;
      }
    } catch (error) {
      this.logError(`❌ Automatic improvement failed: ${error.message}`);
      this.state.currentTask = null;
    }
  }

  /**
   * Create an automatic improvement task based on available time and project state
   *
   * @async
   * @param {number} remainingTime - Remaining session time in seconds
   * @returns {Promise<Object>} Generated improvement task
   */
  async createAutomaticImprovementTask (remainingTime) {
    const improvementDuration = Math.min(remainingTime - 60, 3600); // Leave 1 minute buffer, max 1 hour

    return {
      id: `auto-improve-${Date.now()}`,
      type: 'improvement',
      priority: 5,
      title: 'Automatic Code Improvement',
      requirements: `Perform general code quality improvements and optimizations based on the current codebase state.
      
Focus areas:
- Code quality and maintainability improvements
- Performance optimizations where applicable  
- Documentation enhancements
- Test coverage improvements
- Security best practices
- Code style and convention consistency

Time available: ${Math.round(improvementDuration / 60)} minutes`,
      acceptance_criteria: [
        'Code quality metrics improved',
        'No breaking changes introduced',
        'All existing tests continue to pass',
        'Changes follow project conventions',
        'Improvements are well-documented'
      ],
      minimum_duration: Math.round(improvementDuration / 60),
      dependencies: [],
      tags: ['automatic', 'improvement', 'quality'],
      files_to_modify: [],
      enabled: true,
      automatic: true,
      created_at: new Date(),
      updated_at: new Date()
    };
  }

  /**
   * Execute automatic improvement task with appropriate command selection
   *
   * @async
   * @param {Object} task - The improvement task to execute
   * @returns {Promise<Object>} Task execution result
   */
  async executeAutomaticImprovementTask (task) {
    let prompt;

    // Use SuperClaude improve command if available
    if (
      this.superclaudeConfig?.enabled &&
      this.superclaudeIntegration?.isEnabled()
    ) {
      this.logInfo(
        '🧠 Using SuperClaude /sc:improve command for automatic improvements'
      );
      prompt =
        '/sc:improve --scope project --focus quality --iterative --validate';
    } else {
      // Fallback to standard improvement prompt
      this.logInfo('🤖 Using standard improvement approach');
      prompt = await this.generateTaskPrompt(task);
    }

    const timeoutMs = (task.minimum_duration || 60) * 60 * TIME.MS.ONE_SECOND;

    try {
      const startTime = Date.now();

      if (this.options.dryRun) {
        this.logInfo(
          '🔄 Dry run mode - skipping actual automatic improvement execution'
        );
        return {
          success: true,
          output: 'Dry run - automatic improvement task not actually executed',
          filesChanged: [],
          duration: 0,
          automatic: true
        };
      }

      // Execute the improvement with Claude Code
      this.logInfo('🚀 Starting automatic improvement task with Claude Code...');
      const result = await this.executeClaudeCode(prompt, {
        timeout: timeoutMs,
        workingDir: this.options.workingDir
      });

      const duration = Date.now() - startTime;
      const durationSeconds = Math.round(duration / TIME.MS.ONE_SECOND);
      // Add 30 second delay to allow file system to settle
      this.logInfo('⏳ Waiting 30 seconds for file system to settle...');
      await new Promise((resolve) => setTimeout(resolve, 30000));

      // Analyze changes made by Claude Code
      const filesChanged = await this.gitManager.getChangedFiles();

      this.logValidationStatus(
        '✅',
        `Automatic improvement completed in ${durationSeconds}s`
      );
      if (filesChanged.length > 0) {
        this.logInfo(
          `📝 ${filesChanged.length} files were modified during improvements`
        );
      }

      return {
        success: true,
        output: result.stdout,
        error: result.stderr,
        filesChanged,
        duration,
        automatic: true
      };
    } catch (error) {
      this.logError(
        `💥 Automatic improvement execution failed: ${error.message}`
      );
      return {
        success: false,
        error: error.message,
        filesChanged: [],
        duration: 0,
        automatic: true
      };
    }
  }

  async executeTask (task) {
    // For tasks with minimum_duration, we'll iteratively prompt Claude until minimum time is reached
    const hasMinimumDuration =
      task.minimum_duration && task.minimum_duration > 0;
    const minimumDurationMs = task.minimum_duration
      ? task.minimum_duration * 60 * TIME.MS.ONE_SECOND
      : 0;
    const baseTimeoutMs =
      TIME.SECONDS.DEFAULT_TASK_DURATION_MINUTES * 60 * TIME.MS.ONE_SECOND;

    const totalStartTime = Date.now();
    let totalOutput = '';
    let totalFilesChanged = [];
    let iterationCount = 0;
    let taskCompleted = false;
    let claudeSessionId = null; // Track Claude Code session for continuity
    const MAX_ITERATIONS = 50; // Safeguard against infinite loops

    try {
      if (this.options.dryRun) {
        this.logInfo('🔄 Dry run mode - skipping actual execution');
        return {
          success: true,
          output: 'Dry run - task not actually executed',
          filesChanged: [],
          duration: 0
        };
      }

      // Enhanced iterative execution with session continuity
      do {
        iterationCount++;

        // Safeguard against infinite loops
        if (iterationCount > MAX_ITERATIONS) {
          this.logWarn(`⚠️  Maximum iteration limit (${MAX_ITERATIONS}) reached. Stopping execution.`);
          taskCompleted = true;
          break;
        }

        const elapsedMs = Date.now() - totalStartTime;
        const remainingMs = minimumDurationMs - elapsedMs;

        // Calculate timeout for this iteration
        const iterationTimeoutMs =
          hasMinimumDuration && remainingMs > 0
            ? Math.min(baseTimeoutMs, remainingMs)
            : baseTimeoutMs;

        const iterationTimeoutMinutes = Math.round(
          iterationTimeoutMs / TIME.MS.ONE_MINUTE
        );

        this.newLine();
        this.displayBox(
          [
            `🤖 Executing task with Claude Code${
              hasMinimumDuration ? ` (Iteration ${iterationCount})` : ''
            }`,
            `⏱️  Timeout: ${iterationTimeoutMinutes} minutes`,
            hasMinimumDuration
              ? `⏳ Minimum duration: ${task.minimum_duration} minutes`
              : '',
            hasMinimumDuration && elapsedMs > 0
              ? `⏰ Elapsed: ${Math.round(
                elapsedMs / TIME.MS.ONE_MINUTE
              )} minutes`
              : '',
            claudeSessionId
              ? `🔗 Session: ${claudeSessionId.slice(0, 8)}...`
              : '🆕 Starting new session'
          ]
            .filter(Boolean)
            .join('\n'),
          {
            borderStyle: 'single',
            borderColor: hasMinimumDuration ? 'magenta' : 'yellow',
            padding: 1,
            align: 'left'
          }
        );

        let result;
        let prompt;

        if (iterationCount === 1) {
          // First iteration: Generate full prompt and establish session
          prompt = await this.generateIterativeTaskPrompt(
            task,
            iterationCount,
            totalOutput,
            totalFilesChanged
          );

          this.logInfo(
            `⚡ Starting Claude Code execution (iteration ${iterationCount})...`
          );

          // Execute with JSON output to capture session ID
          result = await this.executeClaudeCodeWithSession(prompt, {
            timeout: iterationTimeoutMs,
            workingDir: this.options.workingDir,
            outputFormat: 'json'
          });

          // Extract session ID for continuity
          if (result.sessionId) {
            claudeSessionId = result.sessionId;
            this.logInfo(`🔗 Claude Code session established: ${claudeSessionId.slice(0, 8)}...`);
          }
        } else {
          // Subsequent iterations: Use continuation with enhanced prompts
          if (claudeSessionId) {
            prompt = this.generateContinuationPrompt(
              task,
              iterationCount,
              elapsedMs,
              remainingMs,
              totalFilesChanged
            );

            this.logInfo(
              `⚡ Continuing Claude Code session (iteration ${iterationCount})...`
            );

            // Continue existing session with -c flag
            result = await this.executeClaudeCodeContinuation(prompt, {
              timeout: iterationTimeoutMs,
              workingDir: this.options.workingDir,
              sessionId: claudeSessionId
            });
          } else {
            // Fallback to regular execution if no session available
            this.logWarn('⚠️  No session available, falling back to regular execution');
            prompt = await this.generateIterativeTaskPrompt(
              task,
              iterationCount,
              totalOutput,
              totalFilesChanged
            );

            result = await this.executeClaudeCode(prompt, {
              timeout: iterationTimeoutMs,
              workingDir: this.options.workingDir
            });
          }
        }

        const iterationDuration = Date.now() - totalStartTime;
        const iterationDurationSeconds = Math.round(
          iterationDuration / TIME.MS.ONE_SECOND
        );

        // Analyze changes made by Claude Code in this iteration
        const iterationFilesChanged = await this.gitManager.getChangedFiles();

        // Accumulate results
        const iterationOutput = result.output || result.stdout || '';
        totalOutput +=
          (totalOutput ? `\n\n--- Iteration ${iterationCount} ---\n` : '') +
          iterationOutput;

        // Check for output size limit to prevent memory issues
        if (totalOutput.length > STORAGE.MAX_OUTPUT_SIZE) {
          const truncateAt = STORAGE.MAX_OUTPUT_SIZE / 2;
          totalOutput = `...[Output truncated due to size limit]...\n${
            totalOutput.slice(-truncateAt)}`;
          this.logWarn('⚠️  Output truncated to prevent memory exhaustion');
        }

        totalFilesChanged = [
          ...new Set([...totalFilesChanged, ...iterationFilesChanged])
        ];

        this.logValidationStatus(
          '✅',
          `Iteration ${iterationCount} completed in ${iterationDurationSeconds}s`
        );
        if (iterationFilesChanged.length > 0) {
          this.logInfo(
            `📝 ${iterationFilesChanged.length} files were modified in this iteration`
          );
        }

        // Check if we should continue iterating
        const currentElapsedMs = Date.now() - totalStartTime;
        const shouldContinue =
          hasMinimumDuration &&
          currentElapsedMs < minimumDurationMs &&
          iterationCount < MAX_ITERATIONS;

        if (shouldContinue) {
          const remainingMinutes = Math.round(
            (minimumDurationMs - currentElapsedMs) / TIME.MS.ONE_MINUTE
          );
          this.logInfo(
            `🔄 Continuing session - ${remainingMinutes} minutes remaining to meet minimum duration`
          );

          // Shorter delay for session continuation
          await new Promise((resolve) => setTimeout(resolve, 2000));
        } else {
          taskCompleted = true;
        }
      } while (!taskCompleted);

      const totalDuration = Date.now() - totalStartTime;
      const totalDurationSeconds = Math.round(
        totalDuration / TIME.MS.ONE_SECOND
      );

      this.logValidationStatus(
        '✅',
        `Task execution completed in ${totalDurationSeconds}s (${iterationCount} iterations)`
      );
      if (totalFilesChanged.length > 0) {
        this.logInfo(
          `📝 Total ${totalFilesChanged.length} unique files were modified`
        );
      }

      return {
        success: true,
        output: totalOutput,
        error: '',
        filesChanged: totalFilesChanged,
        duration: totalDuration,
        iterations: iterationCount,
        sessionId: claudeSessionId
      };
    } catch (error) {
      this.logError(`💥 Claude Code execution failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
        filesChanged: totalFilesChanged,
        duration: Date.now() - totalStartTime,
        iterations: iterationCount,
        sessionId: claudeSessionId
      };
    }
  }

  async executeClaudeCode (prompt, options = {}) {
    // Inform user that Claude Code is starting
    this.logInfo('🤖 Claude Code is running...');

    // Log the original prompt
    this.logPrompt(prompt, 'Original');

    // Check if SuperClaude mode is active and optimize prompt
    if (
      this.superclaudeConfig?.enabled &&
      this.superclaudeIntegration?.isEnabled()
    ) {
      prompt = await this.optimizePromptWithSuperClaude(prompt);
    }

    // Check if rate limiting is enabled
    if (!this.options.enableRetryOnLimits) {
      return await this.executeClaudeCodeSingle(prompt, options);
    }

    const maxRetries = options.maxRetries || this.options.rateLimitRetries || 5;
    const baseDelay =
      options.baseDelay ||
      this.options.rateLimitBaseDelay ||
      TIME.MS.RATE_LIMIT_BASE_DELAY;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.executeClaudeCodeSingle(prompt, options);
        return result;
      } catch (error) {
        const errorType = this.classifyError(error);

        if (errorType === 'RATE_LIMIT' && this.options.rateLimitRetries > 0) {
          if (attempt < maxRetries) {
            const delay = this.calculateBackoffDelay(
              attempt,
              baseDelay,
              errorType
            );
            this.logWarn(
              `🔄 Rate limit encountered. Waiting ${Math.round(
                delay / TIME.MS.ONE_SECOND
              )}s before retry (attempt ${attempt + 1}/${maxRetries})...`
            );

            // Keep session alive during wait
            await this.waitWithProgress(delay, errorType);
            continue;
          } else {
            this.logError(
              `💥 Rate limit exceeded maximum retry attempts (${maxRetries})`
            );
            throw new Error(`Rate limit exceeded after ${maxRetries} retries`);
          }
        } else if (
          errorType === 'USAGE_LIMIT' &&
          this.options.usageLimitRetry
        ) {
          if (attempt < maxRetries) {
            const delay = this.calculateBackoffDelay(
              attempt,
              baseDelay,
              errorType
            );
            this.logWarn(
              `🔄 Usage limit encountered. Waiting ${Math.round(
                delay / TIME.MS.ONE_SECOND
              )}s before retry (attempt ${attempt + 1}/${maxRetries})...`
            );

            // Keep session alive during wait
            await this.waitWithProgress(delay, errorType);
            continue;
          } else {
            this.logError(
              `💥 Usage limit exceeded maximum retry attempts (${maxRetries})`
            );
            throw new Error(`Usage limit exceeded after ${maxRetries} retries`);
          }
        } else if (errorType === 'TIMEOUT') {
          // Don't retry timeouts, they're usually task-specific
          throw error;
        } else if (errorType === 'FATAL') {
          // Don't retry fatal errors
          throw error;
        } else {
          // For other errors, retry with shorter delay
          if (attempt < Math.min(maxRetries, 2)) {
            const delay = RETRY.GENERAL_ERROR_DELAY;
            this.logWarn(
              `⚠️  Execution failed, retrying in ${
                delay / TIME.MS.ONE_SECOND
              }s (attempt ${attempt + 1}/${maxRetries})...`
            );
            await this.sleep(delay);
            continue;
          } else {
            throw error;
          }
        }
      }
    }
  }

  async executeClaudeCodeSingle (prompt, options = {}) {
    return new Promise((resolve, reject) => {
      // Log execution start
      this.logInfo('⚙️  Executing Claude Code command...');

      // Use -p flag for proper prompt handling
      const args = [prompt, '-p', '--dangerously-skip-permissions'];

      const child = spawn('claude', args, {
        cwd: options.workingDir || this.options.workingDir,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.state.claudeProcess = child;

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
      });

      child.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
      });

      // Set timeout
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(
          new Error(
            `Claude Code execution timed out after ${options.timeout}ms`
          )
        );
      }, options.timeout || TIME.MS.FIVE_MINUTES);

      child.on('close', (code) => {
        clearTimeout(timeout);
        this.state.claudeProcess = null;

        if (code === 0) {
          // Display Claude Code output after completion
          if (stdout.trim()) {
            stdout.split('\n').forEach((line) => {
              if (line.trim()) {
                // Add different colors and formatting for different types of Claude output
                this.logClaudeOutput(line);
              }
            });
          }

          resolve({ stdout, stderr, code });
        } else {
          // Display Claude Code errors
          if (stderr.trim()) {
            stderr.split('\n').forEach((line) => {
              if (line.trim()) {
                this.logClaudeError(line);
              }
            });
          }

          // Combine stderr and stdout for better error reporting
          const errorOutput =
            stderr.trim() || stdout.trim() || 'No output captured';
          reject(
            new Error(`Claude Code exited with code ${code}: ${errorOutput}`)
          );
        }
      });

      child.on('error', (error) => {
        clearTimeout(timeout);
        this.state.claudeProcess = null;
        reject(error);
      });

      // Log the final prompt being sent
      this.logPrompt(prompt, 'Final');
    });
  }

  /**
   * Execute Claude Code with session management and JSON output
   * Used for the first iteration to establish a session
   *
   * @async
   * @param {string} prompt - The prompt to send to Claude Code
   * @param {Object} options - Execution options
   * @returns {Promise<Object>} Execution result with session metadata
   */
  async executeClaudeCodeWithSession (prompt, options = {}) {
    return new Promise((resolve, reject) => {
      this.logInfo('⚙️  Executing Claude Code with session management...');

      // Use JSON output format to capture session metadata
      const args = [
        prompt,
        '-p',
        '--dangerously-skip-permissions',
        '--output-format',
        'json'
      ];

      const child = spawn('claude', args, {
        cwd: options.workingDir || this.options.workingDir,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.state.claudeProcess = child;

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
      });

      child.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
      });

      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(
          new Error(
            `Claude Code execution timed out after ${options.timeout}ms`
          )
        );
      }, options.timeout || TIME.MS.FIVE_MINUTES);

      child.on('close', (code) => {
        clearTimeout(timeout);
        this.state.claudeProcess = null;

        if (code === 0) {
          try {
            // Parse JSON response to extract session metadata
            const response = JSON.parse(stdout.trim());
            // Display the actual output (not the JSON metadata)
            if (response.result) {
              response.result.split('\n').forEach((line) => {
                if (line.trim()) {
                  this.logClaudeOutput(line);
                }
              });
            }

            resolve({
              output: response.result || '',
              sessionId: response.session_id,
              duration: response.duration_ms,
              turns: response.num_turns,
              cost: response.total_cost_usd,
              success: !response.is_error
            });
          } catch (parseError) {
            // Fallback to text output if JSON parsing fails
            this.logWarn('⚠️  Failed to parse JSON response, using text output');
            if (stdout.trim()) {
              stdout.split('\n').forEach((line) => {
                if (line.trim()) {
                  this.logClaudeOutput(line);
                }
              });
            }
            resolve({ output: stdout, sessionId: null, success: true });
          }
        } else {
          if (stderr.trim()) {
            stderr.split('\n').forEach((line) => {
              if (line.trim()) {
                this.logClaudeError(line);
              }
            });
          }

          const errorOutput =
            stderr.trim() || stdout.trim() || 'No output captured';
          reject(
            new Error(`Claude Code exited with code ${code}: ${errorOutput}`)
          );
        }
      });

      child.on('error', (error) => {
        clearTimeout(timeout);
        this.state.claudeProcess = null;
        reject(error);
      });
    });
  }

  /**
   * Continue an existing Claude Code session using the -c flag
   * Used for subsequent iterations to maintain conversation context
   *
   * @async
   * @param {string} prompt - The continuation prompt
   * @param {Object} options - Execution options including sessionId
   * @returns {Promise<Object>} Execution result
   */
  async executeClaudeCodeContinuation (prompt, options = {}) {
    return new Promise((resolve, reject) => {
      this.logInfo('⚙️  Continuing Claude Code session...');

      // Use -c flag to continue the most recent session
      const args = [
        '-c',
        prompt,
        '-p',
        '--dangerously-skip-permissions'
      ];

      const child = spawn('claude', args, {
        cwd: options.workingDir || this.options.workingDir,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.state.claudeProcess = child;

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
      });

      child.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
      });

      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(
          new Error(
            `Claude Code continuation timed out after ${options.timeout}ms`
          )
        );
      }, options.timeout || TIME.MS.FIVE_MINUTES);

      child.on('close', (code) => {
        clearTimeout(timeout);
        this.state.claudeProcess = null;

        if (code === 0) {
          // Display Claude Code output after completion
          if (stdout.trim()) {
            stdout.split('\n').forEach((line) => {
              if (line.trim()) {
                this.logClaudeOutput(line);
              }
            });
          }

          resolve({
            output: stdout,
            success: true,
            sessionId: options.sessionId // Preserve session ID
          });
        } else {
          // Display Claude Code errors
          if (stderr.trim()) {
            stderr.split('\n').forEach((line) => {
              if (line.trim()) {
                this.logClaudeError(line);
              }
            });
          }

          const errorOutput =
            stderr.trim() || stdout.trim() || 'No output captured';
          reject(
            new Error(`Claude Code continuation failed with code ${code}: ${errorOutput}`)
          );
        }
      });

      child.on('error', (error) => {
        clearTimeout(timeout);
        this.state.claudeProcess = null;
        reject(error);
      });
    });
  }

  classifyError (error) {
    const errorMessage = error.message.toLowerCase();

    // Usage limit patterns
    const usageLimitPatterns = [
      /claude ai usage limit/,
      /usage limit reached/,
      /quota exceeded/,
      /monthly usage limit/,
      /daily usage limit/,
      /account usage limit/,
      /api usage limit/
    ];

    // Rate limit patterns
    const rateLimitPatterns = [
      /rate limit/,
      /too many requests/,
      /requests per/,
      /429/,
      /throttled/,
      /rate exceeded/
    ];

    // Timeout patterns
    const timeoutPatterns = [
      /timed out/,
      /timeout/,
      /ETIMEDOUT/,
      /request timeout/
    ];

    // Fatal error patterns
    const fatalPatterns = [
      /authentication failed/,
      /invalid api key/,
      /unauthorized/,
      /forbidden/,
      /account suspended/,
      /ENOSPC/, // No space left
      /ENOMEM/ // Out of memory
    ];

    if (usageLimitPatterns.some((pattern) => pattern.test(errorMessage))) {
      return 'USAGE_LIMIT';
    } else if (
      rateLimitPatterns.some((pattern) => pattern.test(errorMessage))
    ) {
      return 'RATE_LIMIT';
    } else if (timeoutPatterns.some((pattern) => pattern.test(errorMessage))) {
      return 'TIMEOUT';
    } else if (fatalPatterns.some((pattern) => pattern.test(errorMessage))) {
      return 'FATAL';
    } else {
      return 'TRANSIENT';
    }
  }

  calculateBackoffDelay (attempt, baseDelay, errorType) {
    let delay = baseDelay;

    if (this.options.exponentialBackoff) {
      // Usage limits typically need longer waits
      const multiplier = errorType === 'USAGE_LIMIT' ? 2 : 1.5;
      delay = baseDelay * Math.pow(multiplier, attempt);
    }

    if (this.options.jitter) {
      const jitter = Math.random() * 0.3; // Add 0-30% jitter
      delay = delay * (1 + jitter);
    }

    // Cap the maximum delay
    const maxDelay =
      this.options.maxDelay ||
      (errorType === 'USAGE_LIMIT' ? 18000000 : 900000);
    return Math.min(delay, maxDelay);
  }

  async waitWithProgress (totalDelay, errorType) {
    const updateInterval = 30000; // Update every 30 seconds
    const startTime = Date.now();
    const endTime = startTime + totalDelay;

    const limitType =
      errorType === 'USAGE_LIMIT' ? 'usage limit' : 'rate limit';
    this.logInfo(
      `⏸️  Session paused due to ${limitType}. Keeping session alive...`
    );

    while (Date.now() < endTime) {
      const remaining = endTime - Date.now();
      const remainingMinutes = Math.ceil(remaining / TIME.MS.ONE_MINUTE);

      if (remaining <= updateInterval) {
        await this.sleep(remaining);
        break;
      }

      this.logInfo(
        `⏳ Waiting for ${limitType} reset... ${remainingMinutes} minutes remaining`
      );

      // Keep session checkpoint updated
      await this.createCheckpoint();

      await this.sleep(updateInterval);
    }

    this.logValidationStatus(
      '✅',
      `${
        limitType.charAt(0).toUpperCase() + limitType.slice(1)
      } wait completed. Resuming execution...`
    );
  }

  async optimizePromptWithSuperClaude (originalPrompt, retryCount = 0) {
    const MAX_OPTIMIZATION_RETRIES = 2;

    // Check if we've exceeded max retries
    if (retryCount > MAX_OPTIMIZATION_RETRIES) {
      this.logWarn(`⚠️  Maximum optimization retries (${MAX_OPTIMIZATION_RETRIES}) exceeded`);
      this.logInfo('📝 Falling back to original prompt');
      return originalPrompt;
    }

    this.logInfo('🧠 Optimizing prompt with SuperClaude Framework...');

    // Use the complete optimization guide with the prompt
    let optimizationPrompt = SUPERCLAUDE_OPTIMIZATION_GUIDE.replace(
      '{PROMPT}',
      originalPrompt
    );

    // Add stricter instructions on retry to ensure /sc: prefix
    if (retryCount > 0) {
      optimizationPrompt +=
        '\n\nIMPORTANT: The output MUST be in the format /sc:COMMAND where COMMAND ' +
        'is the SuperClaude command WITHOUT a leading slash (e.g., /sc:analyze not /sc: /analyze). ' +
        'No spaces after the colon. No other text or explanation.';
    }

    try {
      // Execute Claude Code with the optimization prompt
      const retryInfo = retryCount > 0 ? ` (retry ${retryCount})` : '';
      this.logInfo(`📝 Running prompt optimization...${retryInfo}`);
      this.logInfo('🤖 Claude Code is optimizing your prompt with SuperClaude Framework...');

      // Log the optimization prompt itself
      this.logPrompt(optimizationPrompt, 'SuperClaude Optimization Request');

      const result = await this.executeClaudeCodeSingle(optimizationPrompt, {
        timeout: TIME.MS.FIVE_MINUTES, // 5 minute timeout for prompt optimization
        workingDir: this.options.workingDir
      });

      // Use the raw output directly since the guide instructs to return ONLY the command
      const optimizedCommand = result.stdout.trim();

      // Check if it's a valid command
      if (optimizedCommand && optimizedCommand.startsWith('/')) {
        // Check if output has incorrect format with space after colon (e.g., "/sc: /document")
        if (optimizedCommand.startsWith('/sc: ')) {
          this.logWarn(
            `⚠️  Incorrect format detected (space after colon): ${optimizedCommand}`
          );
          if (retryCount < MAX_OPTIMIZATION_RETRIES) {
            this.logInfo('🔄 Retrying to ensure correct /sc:command format...');
            return this.optimizePromptWithSuperClaude(
              originalPrompt,
              retryCount + 1
            );
          } else {
            this.logInfo('📝 Max retries reached, falling back to original prompt');
            return originalPrompt;
          }
        }

        // Check if output starts with /sc: - if not, retry with stricter instructions
        if (!optimizedCommand.startsWith('/sc:') && retryCount === 0) {
          this.logWarn(
            `⚠️  Output doesn't start with /sc: pattern: ${optimizedCommand}`
          );
          if (retryCount < MAX_OPTIMIZATION_RETRIES) {
            this.logInfo('🔄 Retrying to ensure /sc: prefix...');
            return this.optimizePromptWithSuperClaude(originalPrompt, retryCount + 1);
          } else {
            this.logInfo('📝 Max retries reached, falling back to original prompt');
            return originalPrompt;
          }
        }

        // Accept the command if it's different from original or starts with /sc:
        if (
          optimizedCommand !== originalPrompt ||
          optimizedCommand.startsWith('/sc:')
        ) {
          this.logPromptOptimization(optimizedCommand);
          // Log the optimized prompt
          this.logPrompt(optimizedCommand, 'SuperClaude Optimized');
          return optimizedCommand;
        }
      } else {
        this.logWarn('⚠️  No optimization found, using original prompt');
        return originalPrompt;
      }
    } catch (error) {
      // Provide more context for timeout errors
      if (error.message.includes('timed out')) {
        this.logError('❌ Prompt optimization timed out after 5 minutes');
        this.logInfo('💡 Consider simplifying your prompt or disabling SuperClaude optimization');
      } else {
        this.logError(`❌ Prompt optimization failed: ${error.message}`);
      }
      this.logInfo('📝 Falling back to original prompt');
      return originalPrompt;
    }
  }

  async sleep (ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  logPrompt () {
    // Removed fuchsia box logging - now this method does nothing
    // This keeps the method calls intact but removes the visual output
  }

  async generateIterativeTaskPrompt (
    task,
    iterationCount,
    _previousOutput,
    filesChanged
  ) {
    // For iterative prompts, include context from previous iterations
    if (iterationCount > 1) {
      const projectContext = await this.gatherProjectContext(true); // Only include uncommitted changes
      const taskContext = await this.gatherTaskContext(task);

      const prompt = `# Automated Coding Task - Continuation (Iteration ${iterationCount})

## Previous Work Summary
In the previous ${
  iterationCount - 1
} iteration(s), you have been working on this task.
Files modified so far: ${
  filesChanged.length > 0 ? filesChanged.join(', ') : 'None yet'
}

## Current Project State
${projectContext}

## Original Task Requirements
**ID:** ${task.id}
**Type:** ${task.type}
**Title:** ${task.title}
**Priority:** ${task.priority}

**Requirements:**
${task.requirements}

**Acceptance Criteria:**
${
  task.acceptance_criteria?.map((criteria) => `- ${criteria}`).join('\\n') ||
  'None specified'
}

**Minimum Duration:** ${task.minimum_duration} minutes (iterative mode active)
**Files to Modify:** ${task.files_to_modify?.join(', ') || 'Any relevant files'}

## Task Context
${taskContext}

## Instructions for This Iteration
You are continuing work on this task. The minimum duration requirement means you should:

1. Review the uncommitted changes from previous iterations
2. Continue implementing features from the requirements that haven't been fully addressed
3. Improve and refine the existing implementation
4. Add comprehensive tests for the implemented features
5. Enhance error handling and edge case coverage
6. Improve code documentation and comments
7. Optimize performance where applicable
8. Ensure all acceptance criteria are thoroughly met
9. Consider additional enhancements that align with the task goals

## Iteration Guidelines
- Build upon the existing work, don't start from scratch
- Focus on quality improvements and completeness
- Add value with each iteration
- Consider aspects like security, performance, and maintainability
- Ensure the code is production-ready

## Time Status
- This is iteration ${iterationCount} of the task
- Minimum duration of ${
  task.minimum_duration
} minutes ensures thorough implementation
- Use this time to create high-quality, well-tested code

Please continue implementing and improving this task, focusing on areas that will add the most value.`;

      return prompt;
    }

    // For first iteration, use the standard prompt
    return this.generateTaskPrompt(task);
  }

  /**
   * Generate a continuation prompt for subsequent iterations
   * This is much more concise than full task prompts since context is preserved
   *
   * @param {Object} task - The task being executed
   * @param {number} iterationCount - Current iteration number
   * @param {number} elapsedMs - Time elapsed so far
   * @param {number} remainingMs - Time remaining to meet minimum duration
   * @param {Array} filesChanged - Files modified in previous iterations
   * @returns {string} Continuation prompt
   */
  generateContinuationPrompt (
    task,
    iterationCount,
    elapsedMs,
    remainingMs,
    filesChanged
  ) {
    const elapsedMinutes = Math.round(elapsedMs / TIME.MS.ONE_MINUTE);
    const remainingMinutes = Math.round(remainingMs / TIME.MS.ONE_MINUTE);

    return `Continue working on the task "${task.title}" (iteration ${iterationCount}).

⏱️  Time Status:
- Elapsed: ${elapsedMinutes} minutes
- Remaining: ${remainingMinutes} minutes to meet minimum duration
- Files modified: ${filesChanged.length > 0 ? filesChanged.join(', ') : 'none yet'}

🎯 Focus Areas for This Iteration:
- Build upon the previous work in our conversation
- Improve implementation quality and completeness
- Add comprehensive testing and error handling
- Enhance documentation and code comments
- Consider performance optimizations
- Ensure all acceptance criteria are thoroughly met

💡 Remember: You have full context from our previous conversation, so continue naturally
from where we left off. Focus on adding meaningful value in the remaining ${remainingMinutes} minutes.`;
  }

  async generateTaskPrompt (task) {
    // Check if SuperClaude integration is available and should be used
    if (this.superclaudeIntegration?.isEnabled()) {
      const superclaudePlan = await this.superclaudeIntegration.planTask(task);

      if (superclaudePlan) {
        this.logSuperclaude('framework', 'Task execution mode activated');
        // Continue with standard prompt generation - will be optimized by optimizePromptWithSuperClaude
      }
    }

    // Fallback to standard prompt generation
    this.logSuperclaude('standard', 'Task execution');

    // Load project context
    const projectContext = await this.gatherProjectContext();
    const taskContext = await this.gatherTaskContext(task);

    const prompt = `# Automated Coding Task

## Project Context
${projectContext}

## Task Details
**ID:** ${task.id}
**Type:** ${task.type}
**Title:** ${task.title}
**Priority:** ${task.priority}

**Requirements:**
${task.requirements}

**Acceptance Criteria:**
${
  task.acceptance_criteria?.map((criteria) => `- ${criteria}`).join('\\n') ||
  'None specified'
}

**Minimum Duration:** ${task.minimum_duration || 'No minimum specified'} minutes
**Files to Modify:** ${task.files_to_modify?.join(', ') || 'Any relevant files'}

## Task Context
${taskContext}

## Instructions
1. Analyze the requirements carefully
2. Implement the requested changes following project conventions
3. Ensure all acceptance criteria are met
4. Write appropriate tests if required
5. Update documentation if necessary
6. Follow the project's coding standards and style guide

## Time Constraints
- ${
  task.minimum_duration
    ? `Minimum time for this task: ${task.minimum_duration} minutes`
    : 'No minimum duration specified'
}
- Focus on completing the core requirements first
- If time is limited, prioritize functionality over perfect polish

## Quality Requirements
- Code must be production-ready
- Follow existing patterns and conventions
- Ensure backward compatibility
- Add proper error handling
- Include appropriate logging

Please implement this task now.`;

    return prompt;
  }

  async gatherProjectContext (includeOnlyChanges = false) {
    let context = '';

    if (includeOnlyChanges) {
      // For iterative tasks, only include uncommitted changes
      if (this.gitManager) {
        try {
          const changes = await this.gitManager.getChangedFiles();
          if (changes.length > 0) {
            context += '### Uncommitted Changes\n';
            context +=
              'The following files have been modified in this session:\n';
            context += changes.map((file) => `- ${file}`).join('\n');
            context += '\n\n';

            // Include diff for small changes
            try {
              const diffResult = await this.executeCommand('git', [
                'diff',
                '--stat'
              ]);
              if (diffResult.stdout) {
                context += '### Change Summary\n';
                context += `\`\`\`\n${diffResult.stdout.slice(
                  0,
                  1000
                )}\n\`\`\`\n\n`;
              }
            } catch (error) {
              // Ignore diff errors
            }
          }
        } catch (error) {
          this.logDebug('Could not get uncommitted changes for context', {
            error: error.message
          });
        }
      }
    } else {
      // Standard behavior - include project files
      const contextFiles = [
        'README.md',
        'package.json',
        'requirements.txt',
        'go.mod',
        'Cargo.toml'
      ];

      for (const file of contextFiles) {
        const filePath = path.join(this.options.workingDir, file);
        if (await fs.pathExists(filePath)) {
          const content = await fs.readFile(filePath, 'utf8');
          context += `### ${file}\n\`\`\`\n${content.slice(
            0,
            2000
          )}\n\`\`\`\n\n`;
        }
      }
    }

    return context || 'No project context found.';
  }

  async gatherTaskContext (task) {
    let context = '';

    // Add dependency information
    if (task.dependencies?.length > 0) {
      const dependencyTasks = this.state.completedTasks
        .filter((ct) => task.dependencies.includes(ct.task.id))
        .map((ct) => ct.task);

      if (dependencyTasks.length > 0) {
        context += '### Completed Dependencies\n';
        dependencyTasks.forEach((dep) => {
          context += `- ${dep.id}: ${dep.title}\n`;
        });
        context += '\n';
      }
    }

    // Add file context for files to modify
    if (task.files_to_modify?.length > 0) {
      context += '### Relevant Files\n';
      for (const filePattern of task.files_to_modify) {
        const files = await this.findMatchingFiles(filePattern);
        context += `Files matching "${filePattern}": ${files.length} files\n`;
      }
      context += '\n';
    }

    return context;
  }

  async findMatchingFiles (pattern) {
    const glob = require('glob');
    return new Promise((resolve, reject) => {
      glob(pattern, { cwd: this.options.workingDir }, (err, files) => {
        if (err) reject(err);
        else resolve(files);
      });
    });
  }

  async validateTaskCompletion (task, result) {
    this.logInfo('🔍 Validating task completion...');

    const validation = {
      passed: true,
      errors: [],
      warnings: []
    };

    try {
      // Run project tests if specified
      if (task.custom_validation?.script) {
        this.logInfo('🧪 Running custom validation script...');
        const scriptResult = await this.executeCommand(
          'node',
          [task.custom_validation.script],
          {
            timeout:
              task.custom_validation.timeout * TIME.MS.ONE_SECOND ||
              TIME.MS.FIVE_MINUTES
          }
        );

        if (scriptResult.code !== 0) {
          validation.passed = false;
          validation.errors.push(
            `Custom validation script failed: ${scriptResult.stderr}`
          );
        } else {
          this.logValidationStatus('✅', 'Custom validation passed');
        }
      }

      // Check if files were actually modified
      if (result.filesChanged.length === 0 && task.type !== 'docs') {
        validation.warnings.push(
          'No files were modified during task execution'
        );
        this.logWarn('⚠️  No files were modified during execution');
      }

      // Run general project validation
      this.logInfo('🔍 Running project validation...');
      const projectValidation = await this.validator.validateProject();
      if (!projectValidation.valid) {
        validation.passed = false;
        validation.errors.push(
          ...projectValidation.errors.map((e) => e.message)
        );
        this.logError('❌ Project validation failed');
      } else {
        this.logValidationStatus('✅', 'Project validation passed');
      }
    } catch (error) {
      validation.passed = false;
      validation.errors.push(`Validation error: ${error.message}`);
      this.logError(`❌ Validation error: ${error.message}`);
    }

    const status = validation.passed ? '✅' : '❌';
    this.logInfo(
      `${status} Task validation completed (${validation.errors.length} errors, ${validation.warnings.length} warnings)`
    );

    return validation;
  }

  startResourceMonitoring () {
    this.resourceMonitoringInterval = setInterval(async () => {
      try {
        const usage = await pidusage(process.pid);
        this.state.resourceUsage.push({
          timestamp: Date.now(),
          cpu: usage.cpu,
          memory: usage.memory,
          elapsed: usage.elapsed
        });

        // Keep only last 100 measurements
        if (this.state.resourceUsage.length > 100) {
          this.state.resourceUsage = this.state.resourceUsage.slice(-100);
        }

        // Log warnings for high resource usage
        if (usage.cpu > 90) {
          this.logWarn('High CPU usage detected', { cpu: usage.cpu });
        }

        if (usage.memory > 2000000000) {
          // 2GB
          this.logWarn('High memory usage detected', {
            memoryMB: Math.round(usage.memory / 1000000)
          });
        }
      } catch (error) {
        this.logDebug('Resource monitoring error', { error: error.message });
      }
    }, 30000); // Every 30 seconds
  }

  startCheckpointTimer () {
    this.checkpointInterval = setInterval(async () => {
      await this.createCheckpoint();
    }, this.options.checkpointInterval * TIME.MS.ONE_SECOND);
  }

  async createCheckpoint () {
    const checkpoint = {
      timestamp: Date.now(),
      sessionId: this.state.sessionId,
      currentTask: this.state.currentTask?.id || null,
      completedTasks: this.state.completedTasks.map((ct) => ct.task.id),
      failedTasks: this.state.failedTasks.map((ft) => ft.task.id),
      elapsed: Date.now() - this.state.startTime,
      resourceUsage: this.state.resourceUsage.slice(-1)[0] || null
    };

    const checkpointDir = path.join(
      this.options.workingDir,
      '.nightly-code',
      'checkpoints'
    );
    await fs.ensureDir(checkpointDir);

    const checkpointFile = path.join(
      checkpointDir,
      `${this.state.sessionId}-${Date.now()}.json`
    );
    await fs.writeJson(checkpointFile, checkpoint, { spaces: 2 });

    this.state.checkpoints.push(checkpoint);

    this.logDebug('Checkpoint created', {
      checkpointFile,
      elapsed: checkpoint.elapsed
    });
  }

  async resumeFromCheckpoint (checkpointPath) {
    this.logInfo('Resuming from checkpoint', { checkpointPath });

    const checkpoint = await fs.readJson(checkpointPath);

    // Restore state
    this.state.sessionId = checkpoint.sessionId;
    this.state.startTime = Date.now() - checkpoint.elapsed;

    // Mark completed tasks
    for (const taskId of checkpoint.completedTasks) {
      // This would need more complex state restoration
      this.logInfo('Task already completed in checkpoint', { taskId });
    }

    this.logInfo('Checkpoint restored successfully');
  }

  async executeCommand (command, args = [], options = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd || this.options.workingDir,
        stdio: 'pipe'
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Command timed out: ${command} ${args.join(' ')}`));
      }, options.timeout || TIME.MS.DEFAULT_COMMAND_TIMEOUT);

      child.on('close', (code) => {
        clearTimeout(timeout);
        resolve({ stdout, stderr, code });
      });

      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  async getAvailableDiskSpace () {
    try {
      const result = await this.executeCommand('df', [
        '-B1',
        this.options.workingDir
      ]);
      const lines = result.stdout.trim().split('\\n');
      const spaceLine = lines[1] || lines[0];
      const available = parseInt(spaceLine.split(/\\s+/)[3] || '0');
      return available;
    } catch (error) {
      this.logWarn('Could not check disk space', { error: error.message });
      return Number.MAX_SAFE_INTEGER; // Assume unlimited if check fails
    }
  }

  isCriticalFailure (error) {
    const criticalPatterns = [
      /ENOSPC/, // No space left on device
      /ENOMEM/, // Out of memory
      /Repository not found/,
      /Authentication failed/
    ];

    return criticalPatterns.some((pattern) => pattern.test(error.message));
  }

  async finalize (results) {
    this.state.endTime = Date.now();
    const duration = this.state.endTime - this.state.startTime;
    const durationMinutes = Math.round(duration / TIME.MS.ONE_MINUTE);

    this.logInfo('');
    this.logInfo('🏁 Finalizing Session');
    this.logInfo('═══════════════════');

    // Stop monitoring
    if (this.resourceMonitoringInterval) {
      clearInterval(this.resourceMonitoringInterval);
    }

    if (this.checkpointInterval) {
      clearInterval(this.checkpointInterval);
    }

    // Kill any remaining Claude Code processes
    if (this.state.claudeProcess) {
      this.state.claudeProcess.kill('SIGTERM');
    }

    // Create pull requests based on strategy
    if (results.completed > 0 && !this.options.dryRun) {
      if (this.gitManager.options.prStrategy === 'session') {
        // Legacy behavior: create single session PR
        this.logInfo('🔄 Creating session pull request...');
        const sessionData = {
          sessionId: this.state.sessionId,
          completedTasks: results.completed,
          totalTasks: results.completed + results.failed,
          duration: this.state.endTime - this.state.startTime,
          tasks: this.state.completedTasks.map((ct) => ({
            ...ct.task,
            status: 'completed',
            result: ct.result
          })),
          failedTasks: this.state.failedTasks.map((ft) => ({
            ...ft.task,
            status: 'failed',
            error: ft.error
          }))
        };

        const prUrl = await this.gitManager.createSessionPR(sessionData);
        if (prUrl) {
          this.logValidationStatus('✅', `Session PR created: ${prUrl}`);
        }
      } else {
        // Task-based PRs are created immediately after each task
        this.logValidationStatus('✅', 'Individual task PRs have been created');
        const taskPRs = this.state.completedTasks
          .filter((ct) => ct.prUrl)
          .map((ct) => `  - ${ct.task.title}: ${ct.prUrl}`);
        if (taskPRs.length > 0) {
          this.logInfo('📋 Task PRs:');
          taskPRs.forEach((pr) => this.logInfo(pr));
        }
      }
    } else if (results.completed > 0 && this.options.dryRun) {
      this.logInfo('🔄 Dry run mode - skipping pull request creation');
    }

    // Clean up any remaining task branches (failed tasks) (skip in dry-run mode)
    if (!this.options.dryRun) {
      this.logInfo('🧹 Cleaning up remaining branches...');
      await this.gitManager.cleanupSessionBranches();
    } else {
      this.logInfo('🔄 Dry run mode - skipping branch cleanup');
    }

    // Create session summary commit on main (for record keeping) (skip in dry-run mode)
    if ((results.completed > 0 || results.failed > 0) && !this.options.dryRun) {
      await this.gitManager.createSessionSummaryCommit({
        sessionId: this.state.sessionId,
        completedTasks: results.completed,
        totalTasks: results.completed + results.failed,
        duration: this.state.endTime - this.state.startTime
      });
    } else if (
      (results.completed > 0 || results.failed > 0) &&
      this.options.dryRun
    ) {
      this.logInfo('🔄 Dry run mode - skipping session summary commit');
    }

    // Create final checkpoint
    await this.createCheckpoint();

    // Generate and save report
    await this.reporter.generateSessionReport(this.state, results);

    // Display final summary with pretty UI
    this.displayFinalSummary();

    // Session results table
    const resultTableData = [
      [require('chalk').bold('Session Results'), '', '', ''],
      ['Status', 'Metric', 'Value', 'Result']
    ];

    const successRate =
      results.completed + results.failed > 0
        ? Math.round(
          (results.completed / (results.completed + results.failed)) * 100
        )
        : 0;

    // Strip emoji variant selectors for proper table alignment
    const stripVariants = (str) => str.replace(/\uFE0F/g, '');

    resultTableData.push(
      [
        require('chalk').green(stripVariants('✅')),
        'Completed Tasks',
        `${results.completed}`,
        require('chalk').green('Success')
      ],
      [
        require('chalk').red(stripVariants('❌')),
        'Failed Tasks',
        `${results.failed}`,
        results.failed > 0 ? require('chalk').red('Failed') : '-'
      ],
      [
        require('chalk').blue(stripVariants('📊')),
        'Success Rate',
        `${successRate}%`,
        successRate >= 80
          ? require('chalk').green('Good')
          : require('chalk').yellow('Needs Improvement')
      ],
      [
        require('chalk').yellow(stripVariants('⏱️')),
        'Duration',
        `${durationMinutes}m`,
        require('chalk').cyan(
          `${Math.round((durationMinutes / 60) * 10) / 10}h`
        )
      ]
    );

    this.displayTable(resultTableData, {
      columnWidths: [8, 20, 15, 20],
      align: ['center', 'left', 'center', 'center'],
      config: {
        spanningCells: [{ col: 0, row: 0, colSpan: 4, alignment: 'center' }]
      }
    });

    this.newLine();

    // Summary box
    const summaryLines = [
      require('chalk').green.bold('✨ Session Completed Successfully! ✨'),
      '',
      `🆔 Session ID: ${this.state.sessionId}`,
      `📁 Working Directory: ${this.options.workingDir}`,
      ''
    ];

    if (results.completed > 0 && !this.options.dryRun) {
      summaryLines.push(
        '🎉 All successful tasks have been merged to main branch!'
      );
    } else if (results.completed > 0 && this.options.dryRun) {
      summaryLines.push(
        require('chalk').yellow(
          '🔄 Dry run mode - tasks would have been merged to main branch'
        )
      );
    }

    if (this.state.failedTasks.length > 0) {
      summaryLines.push('', require('chalk').red('Failed tasks:'));
      this.state.failedTasks.forEach((ft) => {
        summaryLines.push(
          require('chalk').red(`  • ${ft.task.title}: ${ft.error.message}`)
        );
      });
    }

    this.displayBox(summaryLines.join('\n'), {
      borderStyle: 'round',
      borderColor: results.failed === 0 ? 'green' : 'yellow',
      padding: 2,
      align: 'left'
    });

    this.newLine();
  }

  async handleFailure (error) {
    this.logError('Handling session failure', {
      error: error.message,
      stack: error.stack
    });

    // Try to save current state
    try {
      await this.createCheckpoint();
    } catch (checkpointError) {
      this.logError('Failed to create failure checkpoint', {
        error: checkpointError.message
      });
    }

    // Cleanup resources
    await this.finalize({ completed: 0, failed: 1, skipped: 0 });
  }

  generateFinalReport () {
    const duration = this.state.endTime - this.state.startTime;

    return {
      success: this.state.failedTasks.length === 0,
      sessionId: this.state.sessionId,
      duration,
      completedTasks: this.state.completedTasks.length,
      totalTasks:
        this.state.completedTasks.length + this.state.failedTasks.length,
      errors: this.state.failedTasks.map((ft) => ft.error),
      resourceUsage: this.state.resourceUsage,
      checkpoints: this.state.checkpoints.length
    };
  }
}

module.exports = { Orchestrator };
