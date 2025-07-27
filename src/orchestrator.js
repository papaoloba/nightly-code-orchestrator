const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('cross-spawn');
const { EventEmitter } = require('events');
const winston = require('winston');
const pidusage = require('pidusage');
const YAML = require('yaml');

const { TaskManager } = require('./task-manager');
const { GitManager } = require('./git-manager');
const { Validator } = require('./validator');
const { Reporter } = require('./reporter');
const { SuperClaudeIntegration } = require('./superclaude-integration');
const { SUPERCLAUDE_OPTIMIZATION_GUIDE } = require('./superclaude-optimization-guide');
const { TIME, STORAGE, RETRY, LIMITS } = require('./constants');
const PrettyLogger = require('./pretty-logger');

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
      checkpointInterval: options.checkpointInterval || TIME.SECONDS.DEFAULT_CHECKPOINT_INTERVAL,
      dryRun: options.dryRun || false,
      resumeCheckpoint: options.resumeCheckpoint || null,
      workingDir: options.workingDir || process.cwd(),
      forceSuperclaude: options.forceSuperclaude || false, // CLI flag to force SuperClaude
      // Rate limiting and retry configuration
      rateLimitRetries: options.rateLimitRetries || RETRY.DEFAULT_RETRIES,
      rateLimitBaseDelay: options.rateLimitBaseDelay || TIME.MS.RATE_LIMIT_BASE_DELAY,
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
    const time = new Date().toISOString().split('T')[1].split('.')[0].replace(/:/g, '');
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
    const timeStr = seconds >= 60
      ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
      : `${seconds}s`;

    return ` \x1b[35m[took ${timeStr}]\x1b[0m`; // Magenta color for operation timing
  }

  logWithTiming (level, message, operationName = null) {
    const timing = operationName ? this.endOperation(operationName) : '';
    this.logger[level](`${message}${timing}`);
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
    const consoleFormat = winston.format.printf(({ level, message, timestamp }) => {
      // Add elapsed time since start if available
      let elapsedInfo = '';
      if (this.state.startTime) {
        const elapsed = Math.round((Date.now() - this.state.startTime) / TIME.MS.ONE_SECOND);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
        elapsedInfo = ` \x1b[36m(+${timeStr})\x1b[0m`; // Cyan color for elapsed time
      }

      return `${timestamp}${elapsedInfo} ${level}: ${message}`;
    });

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
      const configPath = path.resolve(this.options.workingDir, this.options.configPath);

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
          this.options.rateLimitRetries = config.rate_limiting.max_retries || this.options.rateLimitRetries;
          this.options.rateLimitBaseDelay = config.rate_limiting.base_delay || this.options.rateLimitBaseDelay;
          this.options.enableRetryOnLimits = config.rate_limiting.enabled !== false;
          this.options.usageLimitRetry = config.rate_limiting.usage_limit_retry !== false;
          this.options.rateLimitRetry = config.rate_limiting.rate_limit_retry !== false;
          this.options.maxDelay = config.rate_limiting.max_delay || 18000000;
          this.options.exponentialBackoff = config.rate_limiting.exponential_backoff !== false;
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
          this.logger.info('  \x1b[35m🧠 SuperClaude\x1b[0m │ Mode enabled via CLI flag');
        }

        return config;
      }
    } catch (error) {
      this.logger.warn(`Could not load configuration file: ${error.message}`);
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
      this.logger.info('🧠 SuperClaude mode enabled via CLI flag');
    }

    return null;
  }

  async initializeSuperClaude () {
    if (!this.superclaudeConfig?.enabled) {
      this.logger.debug('SuperClaude integration not enabled');
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
      // Display fancy banner
      console.clear();
      this.prettyLogger.banner('Nightly Code', 'Standard');
      this.prettyLogger.divider('═', 60, 'cyan');
      console.log();

      // Show session info in a styled box
      const workingDirDisplay = this.options.workingDir.length > 45
        ? `📁 Working Directory:\n    ${this.options.workingDir}`
        : `📁 Working Directory: ${this.options.workingDir}`;

      this.prettyLogger.box([
        '🌙 Nightly Code Orchestration Session',
        '',
        `📋 Session ID: ${this.state.sessionId}`,
        workingDirDisplay,
        `⏱️  Max Duration: ${Math.round(this.options.maxDuration / 3600)} hours`,
        `🔄 Mode: ${this.options.dryRun ? 'DRY RUN' : 'LIVE'}`
      ].join('\n'), {
        borderStyle: 'double',
        borderColor: this.options.dryRun ? 'yellow' : 'blue',
        padding: 1,
        align: 'left'
      });
      console.log();

      this.state.startTime = Date.now();

      // Load configuration file
      const fullConfig = await this.loadConfigurationFile();

      // Initialize GitManager with configuration
      this.gitManager = new GitManager({
        workingDir: this.options.workingDir,
        logger: this.logger,
        dryRun: this.options.dryRun,
        branchPrefix: fullConfig?.git?.branch_prefix || 'nightly-',
        autoPush: fullConfig?.git?.auto_push !== false,
        createPR: fullConfig?.git?.create_pr !== false,
        prTemplate: fullConfig?.git?.pr_template || null,
        prStrategy: this.options.prStrategy || fullConfig?.git?.pr_strategy || 'task' // Default to task-based PRs
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
      this.logger.error(`💥 Orchestration session failed: ${error.message}`);
      await this.handleFailure(error);
      throw error;
    }
  }

  async validateEnvironment () {
    this.startOperation('environment-validation');
    this.prettyLogger.info('🔧 Validating Environment');
    this.prettyLogger.divider('─', 30, 'gray');

    // Check if Claude Code is available
    try {
      const result = await this.executeCommand('claude', ['--version'], { timeout: 10000 });
      this.logger.info(`✅ Claude Code: ${result.stdout.trim()}`);
    } catch (error) {
      throw new Error('❌ Claude Code CLI not found. Please install claude-code first.');
    }

    // Validate configuration
    this.logger.info('🔍 Validating configuration...');
    const validation = await this.validator.validateAll();
    if (!validation.valid) {
      throw new Error(`❌ Configuration validation failed: ${validation.errors.map(e => e.message).join(', ')}`);
    }
    this.logger.info('✅ Configuration is valid');

    // Check available disk space
    const freeSpace = await this.getAvailableDiskSpace();
    const freeSpaceGB = Math.round(freeSpace / STORAGE.BYTES_IN_GB);
    if (freeSpace < STORAGE.MIN_DISK_SPACE_BYTES) {
      this.logger.warn(`⚠️  Low disk space: ${freeSpaceGB}GB available`);
    } else {
      this.logger.info(`💾 Disk space: ${freeSpaceGB}GB available`);
    }

    // Validate GitManager is initialized
    if (!this.gitManager) {
      throw new Error('GitManager not initialized. Configuration loading may have failed.');
    }

    // Initialize git if needed
    await this.gitManager.ensureRepository();

    // Create session branch only if using session PR strategy
    if (!this.options.dryRun && this.gitManager.options.prStrategy === 'session') {
      await this.gitManager.createSessionBranch(this.state.sessionId);
    } else if (!this.options.dryRun && this.gitManager.options.prStrategy === 'task') {
      this.logger.info('🌿 Task-based PR strategy - branches will be created per task');
    } else {
      this.logger.info('🔄 Dry run mode - skipping branch creation');
    }

    this.logWithTiming('info', '✅ Environment validation completed', 'environment-validation');
    this.logger.info('');
  }

  async loadTasks () {
    this.startOperation('task-loading');
    this.prettyLogger.info('📋 Loading Tasks');
    this.prettyLogger.divider('─', 30, 'gray');

    const tasks = await this.taskManager.loadTasks();
    const orderedTasks = await this.taskManager.resolveDependencies(tasks);

    const totalTasks = orderedTasks.length;
    const estimatedDuration = orderedTasks.reduce((sum, task) => sum + (task.estimated_duration || 0), 0);

    this.prettyLogger.success(`✅ Loaded ${totalTasks} tasks`);
    this.prettyLogger.info(`⏱️  Estimated duration: ${Math.round(estimatedDuration)} minutes`);

    // Show task overview in a pretty table
    if (orderedTasks.length > 0) {
      console.log();
      const tableData = [
        ['#', 'Priority', 'Task', 'Duration', 'Type']
      ];

      orderedTasks.forEach((task, index) => {
        const priority = task.priority || 'medium';
        const priorityIcon = priority === 'high' ? '🔴 High' : priority === 'low' ? '🟢 Low' : '🟡 Medium';
        tableData.push([
          `${index + 1}`,
          priorityIcon,
          task.title,
          `${task.estimated_duration || 60}m`,
          task.type || 'general'
        ]);
      });

      this.prettyLogger.table(tableData, {
        columnWidths: [4, 12, 40, 10, 12],
        align: ['center', 'center', 'left', 'center', 'center']
      });
    }

    this.logWithTiming('info', '', 'task-loading'); // Just show timing without duplicate message
    console.log();
    return orderedTasks;
  }

  async executeTasks (tasks) {
    const results = {
      completed: 0,
      failed: 0,
      skipped: 0,
      totalTasks: tasks.length
    };

    this.logger.info('🎯 Executing Tasks');
    this.logger.info('═══════════════════');

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const taskNum = i + 1;
      const totalTasks = tasks.length;

      try {
        // Check time remaining
        const elapsed = (Date.now() - this.state.startTime) / TIME.MS.ONE_SECOND;
        if (elapsed >= this.options.maxDuration) {
          this.logger.warn(`⏰ Maximum session duration reached (${Math.round(elapsed)}s)`);
          break;
        }

        this.state.currentTask = task;
        const taskOperationName = `task-${task.id}`;
        this.startOperation(taskOperationName);

        // Task header with pretty display
        console.log();
        this.prettyLogger.divider('═', 60, 'blue');
        this.prettyLogger.info(`📋 Task ${taskNum}/${totalTasks}: ${task.title}`);
        this.prettyLogger.divider('─', 60, 'gray');
        this.prettyLogger.info(`🔧 Type: ${task.type}`);
        this.prettyLogger.info(`⏱️  Estimated: ${task.estimated_duration || 60} minutes`);
        this.prettyLogger.info(`🆔 ID: ${task.id}`);

        // Create task branch if using task-based PR strategy
        if (!this.options.dryRun) {
          const branchName = await this.gitManager.createTaskBranch(task);
        }

        // Execute task with Claude Code
        const taskResult = await this.executeTask(task);

        if (taskResult.success) {
          // Validate task completion
          const validation = await this.validateTaskCompletion(task, taskResult);

          if (validation.passed) {
            // Commit changes to task branch (skip in dry-run mode)
            if (!this.options.dryRun) {
              await this.gitManager.commitTask(task, taskResult);

              // Create individual PR if using task-based strategy
              if (this.gitManager.options.prStrategy === 'task') {
                try {
                  const prUrl = await this.gitManager.createTaskPR(task, taskResult);
                  if (prUrl) {
                    task.prUrl = prUrl;
                    this.logger.info(`🎯 Task PR created: ${prUrl}`);
                  } else {
                    this.logger.warn(`⚠️  PR creation skipped for task ${task.id}`);
                  }
                } catch (error) {
                  this.logger.error(`❌ Failed to create PR for task ${task.id}: ${error.message}`);
                  // Continue execution, PR creation is not critical for task completion
                }
              }
            } else {
              this.logger.info('🔄 Dry run mode - skipping task commit and PR creation');
            }

            this.state.completedTasks.push({
              task,
              result: taskResult,
              validation,
              completedAt: Date.now(),
              prUrl: task.prUrl
            });

            results.completed++;
            this.logWithTiming('info', `🎉 Task ${taskNum}/${totalTasks} completed successfully!`, taskOperationName);
          } else {
            throw new Error(`Task validation failed: ${validation.errors.join(', ')}`);
          }
        } else {
          throw new Error(`Task execution failed: ${taskResult.error}`);
        }
      } catch (error) {
        this.logger.error(`❌ Task ${taskNum}/${totalTasks} failed: ${error.message}`);

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
          this.logger.info('🔄 Dry run mode - skipping task revert');
        }

        // Continue with next task unless critical failure
        if (this.isCriticalFailure(error)) {
          this.logger.error('💥 Critical failure detected, stopping execution');
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
      this.logger.info('⚠️  Skipping automatic improvements due to failed tasks');
      return;
    }

    // Check remaining time
    const elapsed = (Date.now() - this.state.startTime) / TIME.MS.ONE_SECOND;
    const remainingTime = this.options.maxDuration - elapsed;
    const minimumTimeForImprovement = 300; // 5 minutes minimum

    if (remainingTime < minimumTimeForImprovement) {
      this.logger.info(`⏰ Insufficient time remaining for automatic improvements (${Math.round(remainingTime)}s < ${minimumTimeForImprovement}s)`);
      return;
    }

    this.logger.info('');
    this.logger.info('🚀 All tasks completed successfully! Starting automatic improvements...');
    this.prettyLogger.divider('═', 60, 'green');
    this.logger.info(`⏱️  Time remaining: ${Math.round(remainingTime / 60)} minutes`);
    this.logger.info('');

    try {
      // Create an automatic improvement task
      const improvementTask = await this.createAutomaticImprovementTask(remainingTime);

      if (improvementTask) {
        this.state.currentTask = improvementTask;

        this.prettyLogger.box([
          '✨ Automatic Code Improvement Session',
          `⏱️  Available time: ${Math.round(remainingTime / 60)} minutes`,
          '🎯 Focus: General code quality and optimization'
        ].join('\n'), {
          borderStyle: 'double',
          borderColor: 'green',
          padding: 1,
          align: 'left'
        });

        // Execute the improvement task
        const improvementResult = await this.executeAutomaticImprovementTask(improvementTask);

        if (improvementResult.success) {
          // Validate and commit the improvements
          const validation = await this.validateTaskCompletion(improvementTask, improvementResult);

          if (validation.passed) {
            if (!this.options.dryRun) {
              await this.gitManager.commitTask(improvementTask, improvementResult);
              this.logger.info('✅ Automatic improvements committed successfully');
            } else {
              this.logger.info('🔄 Dry run mode - skipping automatic improvement commit');
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

            this.logger.info('🎉 Automatic improvement session completed successfully!');
          } else {
            this.logger.warn('⚠️  Automatic improvement validation failed, reverting changes');
            if (!this.options.dryRun) {
              await this.gitManager.revertTaskChanges(improvementTask);
            }
          }
        } else {
          this.logger.warn('⚠️  Automatic improvement execution failed');
        }

        this.state.currentTask = null;
      }
    } catch (error) {
      this.logger.error(`❌ Automatic improvement failed: ${error.message}`);
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
      estimated_duration: Math.round(improvementDuration / 60),
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
    if (this.superclaudeConfig?.enabled && this.superclaudeIntegration?.isEnabled()) {
      this.logger.info('🧠 Using SuperClaude /sc:improve command for automatic improvements');
      prompt = '/sc:improve --scope project --focus quality --iterative --validate';
    } else {
      // Fallback to standard improvement prompt
      this.logger.info('🤖 Using standard improvement approach');
      prompt = await this.generateTaskPrompt(task);
    }

    const timeoutMs = task.estimated_duration * 60 * TIME.MS.ONE_SECOND;

    try {
      const startTime = Date.now();

      if (this.options.dryRun) {
        this.logger.info('🔄 Dry run mode - skipping actual automatic improvement execution');
        return {
          success: true,
          output: 'Dry run - automatic improvement task not actually executed',
          filesChanged: [],
          duration: 0,
          automatic: true
        };
      }

      // Execute the improvement with Claude Code
      const result = await this.executeClaudeCode(prompt, {
        timeout: timeoutMs,
        workingDir: this.options.workingDir
      });

      const duration = Date.now() - startTime;
      const durationSeconds = Math.round(duration / TIME.MS.ONE_SECOND);

      // Analyze changes made by Claude Code
      const filesChanged = await this.gitManager.getChangedFiles();

      this.logger.info(`✅ Automatic improvement completed in ${durationSeconds}s`);
      if (filesChanged.length > 0) {
        this.logger.info(`📝 ${filesChanged.length} files were modified during improvements`);
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
      this.logger.error(`💥 Automatic improvement execution failed: ${error.message}`);
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
    const timeoutMs = (task.estimated_duration || TIME.SECONDS.DEFAULT_TASK_DURATION_MINUTES) * 60 * TIME.MS.ONE_SECOND; // Convert minutes to milliseconds
    const prompt = await this.generateTaskPrompt(task);

    const timeoutMinutes = Math.round(timeoutMs / TIME.MS.ONE_MINUTE);
    console.log();
    this.prettyLogger.box([
      '🤖 Executing task with Claude Code',
      `⏱️  Timeout: ${timeoutMinutes} minutes`
    ].join('\n'), {
      borderStyle: 'single',
      borderColor: 'yellow',
      padding: 1,
      align: 'left'
    });

    try {
      if (this.options.dryRun) {
        this.logger.info('🔄 Dry run mode - skipping actual execution');
        return {
          success: true,
          output: 'Dry run - task not actually executed',
          filesChanged: [],
          duration: 0
        };
      }

      const startTime = Date.now();
      this.logger.info('⚡ Starting Claude Code execution...');

      // Execute Claude Code with the generated prompt
      const result = await this.executeClaudeCode(prompt, {
        timeout: timeoutMs,
        workingDir: this.options.workingDir
      });

      const duration = Date.now() - startTime;
      const durationSeconds = Math.round(duration / TIME.MS.ONE_SECOND);

      // Analyze changes made by Claude Code
      const filesChanged = await this.gitManager.getChangedFiles();

      this.logger.info(`✅ Claude Code execution completed in ${durationSeconds}s`);
      if (filesChanged.length > 0) {
        this.logger.info(`📝 ${filesChanged.length} files were modified`);
      }

      return {
        success: true,
        output: result.stdout,
        error: result.stderr,
        filesChanged,
        duration
      };
    } catch (error) {
      this.logger.error(`💥 Claude Code execution failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
        filesChanged: [],
        duration: 0
      };
    }
  }

  async executeClaudeCode (prompt, options = {}) {
    // Log the original prompt
    this.logPrompt(prompt, 'Original');

    // Check if SuperClaude mode is active and optimize prompt
    if (this.superclaudeConfig?.enabled && this.superclaudeIntegration?.isEnabled()) {
      prompt = await this.optimizePromptWithSuperClaude(prompt);
    }

    // Check if rate limiting is enabled
    if (!this.options.enableRetryOnLimits) {
      return await this.executeClaudeCodeSingle(prompt, options);
    }

    const maxRetries = options.maxRetries || this.options.rateLimitRetries || 5;
    const baseDelay = options.baseDelay || this.options.rateLimitBaseDelay || TIME.MS.RATE_LIMIT_BASE_DELAY;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.executeClaudeCodeSingle(prompt, options);
        return result;
      } catch (error) {
        const errorType = this.classifyError(error);

        if (errorType === 'RATE_LIMIT' && this.options.rateLimitRetry) {
          if (attempt < maxRetries) {
            const delay = this.calculateBackoffDelay(attempt, baseDelay, errorType);
            this.logger.warn(`🔄 Rate limit encountered. Waiting ${Math.round(delay / TIME.MS.ONE_SECOND)}s before retry (attempt ${attempt + 1}/${maxRetries})...`);

            // Keep session alive during wait
            await this.waitWithProgress(delay, errorType);
            continue;
          } else {
            this.logger.error(`💥 Rate limit exceeded maximum retry attempts (${maxRetries})`);
            throw new Error(`Rate limit exceeded after ${maxRetries} retries`);
          }
        } else if (errorType === 'USAGE_LIMIT' && this.options.usageLimitRetry) {
          if (attempt < maxRetries) {
            const delay = this.calculateBackoffDelay(attempt, baseDelay, errorType);
            this.logger.warn(`🔄 Usage limit encountered. Waiting ${Math.round(delay / TIME.MS.ONE_SECOND)}s before retry (attempt ${attempt + 1}/${maxRetries})...`);

            // Keep session alive during wait
            await this.waitWithProgress(delay, errorType);
            continue;
          } else {
            this.logger.error(`💥 Usage limit exceeded maximum retry attempts (${maxRetries})`);
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
            this.logger.warn(`⚠️  Execution failed, retrying in ${delay / TIME.MS.ONE_SECOND}s (attempt ${attempt + 1}/${maxRetries})...`);
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
      const args = ['--dangerously-skip-permissions'];

      const child = spawn('claude', args, {
        cwd: options.workingDir || this.options.workingDir,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.state.claudeProcess = child;

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        // Display Claude Code output in real-time with improved formatting
        output.split('\n').forEach(line => {
          if (line.trim()) {
            // Add different colors and formatting for different types of Claude output
            if (line.includes('Wave') || line.includes('wave')) {
              this.logger.info(`  \x1b[35m🤖 Claude\x1b[0m │ \x1b[35m${line}\x1b[0m`); // Magenta for waves
            } else if (line.includes('✅') || line.includes('Success') || line.includes('Completed')) {
              this.logger.info(`  \x1b[32m🤖 Claude\x1b[0m │ \x1b[32m${line}\x1b[0m`); // Green for success
            } else if (line.includes('❌') || line.includes('Error') || line.includes('Failed')) {
              this.logger.info(`  \x1b[31m🤖 Claude\x1b[0m │ \x1b[31m${line}\x1b[0m`); // Red for errors
            } else if (line.includes('⚠️') || line.includes('Warning')) {
              this.logger.info(`  \x1b[33m🤖 Claude\x1b[0m │ \x1b[33m${line}\x1b[0m`); // Yellow for warnings
            } else {
              this.logger.info(`  \x1b[36m🤖 Claude\x1b[0m │ ${line}`); // Cyan for robot icon, normal text
            }
          }
        });
      });

      child.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        // Display Claude Code errors in real-time
        output.split('\n').forEach(line => {
          if (line.trim()) {
            this.logger.warn(`⚠️  Claude: ${line}`);
          }
        });
      });

      // Set timeout
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Claude Code execution timed out after ${options.timeout}ms`));
      }, options.timeout || TIME.MS.FIVE_MINUTES);

      child.on('close', (code) => {
        clearTimeout(timeout);
        this.state.claudeProcess = null;

        if (code === 0) {
          resolve({ stdout, stderr, code });
        } else {
          // Combine stderr and stdout for better error reporting
          const errorOutput = stderr.trim() || stdout.trim() || 'No output captured';
          reject(new Error(`Claude Code exited with code ${code}: ${errorOutput}`));
        }
      });

      child.on('error', (error) => {
        clearTimeout(timeout);
        this.state.claudeProcess = null;
        reject(error);
      });

      // Log the final prompt being sent
      this.logPrompt(prompt, 'Final');

      // Send the prompt to Claude Code
      child.stdin.write(prompt);
      child.stdin.end();
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

    if (usageLimitPatterns.some(pattern => pattern.test(errorMessage))) {
      return 'USAGE_LIMIT';
    } else if (rateLimitPatterns.some(pattern => pattern.test(errorMessage))) {
      return 'RATE_LIMIT';
    } else if (timeoutPatterns.some(pattern => pattern.test(errorMessage))) {
      return 'TIMEOUT';
    } else if (fatalPatterns.some(pattern => pattern.test(errorMessage))) {
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
    const maxDelay = this.options.maxDelay || (errorType === 'USAGE_LIMIT' ? 18000000 : 900000);
    return Math.min(delay, maxDelay);
  }

  async waitWithProgress (totalDelay, errorType) {
    const updateInterval = 30000; // Update every 30 seconds
    const startTime = Date.now();
    const endTime = startTime + totalDelay;

    const limitType = errorType === 'USAGE_LIMIT' ? 'usage limit' : 'rate limit';
    this.logger.info(`⏸️  Session paused due to ${limitType}. Keeping session alive...`);

    while (Date.now() < endTime) {
      const remaining = endTime - Date.now();
      const remainingMinutes = Math.ceil(remaining / TIME.MS.ONE_MINUTE);

      if (remaining <= updateInterval) {
        await this.sleep(remaining);
        break;
      }

      this.logger.info(`⏳ Waiting for ${limitType} reset... ${remainingMinutes} minutes remaining`);

      // Keep session checkpoint updated
      await this.createCheckpoint();

      await this.sleep(updateInterval);
    }

    this.logger.info(`✅ ${limitType.charAt(0).toUpperCase() + limitType.slice(1)} wait completed. Resuming execution...`);
  }

  async optimizePromptWithSuperClaude (originalPrompt, retryCount = 0) {
    this.logger.info('🧠 Optimizing prompt with SuperClaude Framework...');

    // Use the complete optimization guide with the prompt
    let optimizationPrompt = SUPERCLAUDE_OPTIMIZATION_GUIDE.replace('{PROMPT}', originalPrompt);

    // Add stricter instructions on retry to ensure /sc: prefix
    if (retryCount > 0) {
      optimizationPrompt += '\n\nIMPORTANT: The output MUST be in the format /sc:COMMAND where COMMAND ' +
        'is the SuperClaude command WITHOUT a leading slash (e.g., /sc:analyze not /sc: /analyze). ' +
        'No spaces after the colon. No other text or explanation.';
    }

    try {
      // Execute Claude Code with the optimization prompt
      const retryInfo = retryCount > 0 ? ` (retry ${retryCount})` : '';
      this.logger.info(`📝 Running prompt optimization...${retryInfo}`);

      // Log the optimization prompt itself
      this.logPrompt(optimizationPrompt, 'SuperClaude Optimization Request');

      const result = await this.executeClaudeCodeSingle(optimizationPrompt, {
        timeout: 30000, // 30 second timeout for optimization
        workingDir: this.options.workingDir
      });

      // Use the raw output directly since the guide instructs to return ONLY the command
      const optimizedCommand = result.stdout.trim();

      // Check if it's a valid command
      if (optimizedCommand && optimizedCommand.startsWith('/')) {
        // Check if output has incorrect format with space after colon (e.g., "/sc: /document")
        if (optimizedCommand.startsWith('/sc: ')) {
          this.logger.warn(`⚠️  Incorrect format detected (space after colon): ${optimizedCommand}`);
          this.logger.info('🔄 Retrying to ensure correct /sc:command format...');
          return this.optimizePromptWithSuperClaude(originalPrompt, retryCount + 1);
        }

        // Check if output starts with /sc: - if not, retry with stricter instructions
        if (!optimizedCommand.startsWith('/sc:') && retryCount === 0) {
          this.logger.warn(`⚠️  Output doesn't start with /sc: pattern: ${optimizedCommand}`);
          this.logger.info('🔄 Retrying to ensure /sc: prefix...');
          return this.optimizePromptWithSuperClaude(originalPrompt, 1);
        }

        // Accept the command if it's different from original or starts with /sc:
        if (optimizedCommand !== originalPrompt || optimizedCommand.startsWith('/sc:')) {
          this.logger.info(`  \x1b[32m✅ Prompt optimized\x1b[0m │ \x1b[1m${optimizedCommand}\x1b[0m`);
          // Log the optimized prompt
          this.logPrompt(optimizedCommand, 'SuperClaude Optimized');
          return optimizedCommand;
        }
      } else {
        this.logger.warn('⚠️  No optimization found, using original prompt');
        return originalPrompt;
      }
    } catch (error) {
      this.logger.error(`❌ Prompt optimization failed: ${error.message}`);
      this.logger.info('📝 Falling back to original prompt');
      return originalPrompt;
    }
  }

  async sleep (ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  logPrompt (prompt, type = 'Prompt') {
    // Removed fuchsia box logging - now this method does nothing
    // This keeps the method calls intact but removes the visual output
  }

  async generateTaskPrompt (task) {
    // Check if SuperClaude integration is available and should be used
    if (this.superclaudeIntegration?.isEnabled()) {
      const superclaudePlan = await this.superclaudeIntegration.planTask(task);

      if (superclaudePlan) {
        this.logger.info('  \x1b[35m🧠 SuperClaude Framework\x1b[0m │ Task execution mode activated');
        // Continue with standard prompt generation - will be optimized by optimizePromptWithSuperClaude
      }
    }

    // Fallback to standard prompt generation
    this.logger.info('  \x1b[36m🤖 Standard mode\x1b[0m │ Task execution');

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
${task.acceptance_criteria?.map(criteria => `- ${criteria}`).join('\\n') || 'None specified'}

**Estimated Duration:** ${task.estimated_duration || 60} minutes
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
- Maximum time for this task: ${task.estimated_duration || 60} minutes
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

  async gatherProjectContext () {
    const contextFiles = ['README.md', 'package.json', 'requirements.txt', 'go.mod', 'Cargo.toml'];
    let context = '';

    for (const file of contextFiles) {
      const filePath = path.join(this.options.workingDir, file);
      if (await fs.pathExists(filePath)) {
        const content = await fs.readFile(filePath, 'utf8');
        context += `### ${file}\n\`\`\`\n${content.slice(0, 2000)}\n\`\`\`\n\n`;
      }
    }

    return context || 'No project context files found.';
  }

  async gatherTaskContext (task) {
    let context = '';

    // Add dependency information
    if (task.dependencies?.length > 0) {
      const dependencyTasks = this.state.completedTasks
        .filter(ct => task.dependencies.includes(ct.task.id))
        .map(ct => ct.task);

      if (dependencyTasks.length > 0) {
        context += '### Completed Dependencies\n';
        dependencyTasks.forEach(dep => {
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
    this.logger.info('🔍 Validating task completion...');

    const validation = {
      passed: true,
      errors: [],
      warnings: []
    };

    try {
      // Run project tests if specified
      if (task.custom_validation?.script) {
        this.logger.info('🧪 Running custom validation script...');
        const scriptResult = await this.executeCommand('node', [task.custom_validation.script], {
          timeout: task.custom_validation.timeout * TIME.MS.ONE_SECOND || TIME.MS.FIVE_MINUTES
        });

        if (scriptResult.code !== 0) {
          validation.passed = false;
          validation.errors.push(`Custom validation script failed: ${scriptResult.stderr}`);
        } else {
          this.logger.info('✅ Custom validation passed');
        }
      }

      // Check if files were actually modified
      if (result.filesChanged.length === 0 && task.type !== 'docs') {
        validation.warnings.push('No files were modified during task execution');
        this.logger.warn('⚠️  No files were modified during execution');
      }

      // Run general project validation
      this.logger.info('🔍 Running project validation...');
      const projectValidation = await this.validator.validateProject();
      if (!projectValidation.valid) {
        validation.passed = false;
        validation.errors.push(...projectValidation.errors.map(e => e.message));
        this.logger.error('❌ Project validation failed');
      } else {
        this.logger.info('✅ Project validation passed');
      }
    } catch (error) {
      validation.passed = false;
      validation.errors.push(`Validation error: ${error.message}`);
      this.logger.error(`❌ Validation error: ${error.message}`);
    }

    const status = validation.passed ? '✅' : '❌';
    this.logger.info(`${status} Task validation completed (${validation.errors.length} errors, ${validation.warnings.length} warnings)`);

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
          this.logger.warn('High CPU usage detected', { cpu: usage.cpu });
        }

        if (usage.memory > 2000000000) { // 2GB
          this.logger.warn('High memory usage detected', { memoryMB: Math.round(usage.memory / 1000000) });
        }
      } catch (error) {
        this.logger.debug('Resource monitoring error', { error: error.message });
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
      completedTasks: this.state.completedTasks.map(ct => ct.task.id),
      failedTasks: this.state.failedTasks.map(ft => ft.task.id),
      elapsed: Date.now() - this.state.startTime,
      resourceUsage: this.state.resourceUsage.slice(-1)[0] || null
    };

    const checkpointDir = path.join(this.options.workingDir, '.nightly-code', 'checkpoints');
    await fs.ensureDir(checkpointDir);

    const checkpointFile = path.join(checkpointDir, `${this.state.sessionId}-${Date.now()}.json`);
    await fs.writeJson(checkpointFile, checkpoint, { spaces: 2 });

    this.state.checkpoints.push(checkpoint);

    this.logger.debug('Checkpoint created', { checkpointFile, elapsed: checkpoint.elapsed });
  }

  async resumeFromCheckpoint (checkpointPath) {
    this.logger.info('Resuming from checkpoint', { checkpointPath });

    const checkpoint = await fs.readJson(checkpointPath);

    // Restore state
    this.state.sessionId = checkpoint.sessionId;
    this.state.startTime = Date.now() - checkpoint.elapsed;

    // Mark completed tasks
    for (const taskId of checkpoint.completedTasks) {
      // This would need more complex state restoration
      this.logger.info('Task already completed in checkpoint', { taskId });
    }

    this.logger.info('Checkpoint restored successfully');
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
      const result = await this.executeCommand('df', ['-B1', this.options.workingDir]);
      const lines = result.stdout.trim().split('\\n');
      const spaceLine = lines[1] || lines[0];
      const available = parseInt(spaceLine.split(/\\s+/)[3] || '0');
      return available;
    } catch (error) {
      this.logger.warn('Could not check disk space', { error: error.message });
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

    return criticalPatterns.some(pattern => pattern.test(error.message));
  }

  async finalize (results) {
    this.state.endTime = Date.now();
    const duration = this.state.endTime - this.state.startTime;
    const durationMinutes = Math.round(duration / TIME.MS.ONE_MINUTE);

    this.logger.info('');
    this.logger.info('🏁 Finalizing Session');
    this.logger.info('═══════════════════');

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
        this.logger.info('🔄 Creating session pull request...');
        const sessionData = {
          sessionId: this.state.sessionId,
          completedTasks: results.completed,
          totalTasks: results.completed + results.failed,
          duration: this.state.endTime - this.state.startTime,
          tasks: this.state.completedTasks.map(ct => ({
            ...ct.task,
            status: 'completed',
            result: ct.result
          })),
          failedTasks: this.state.failedTasks.map(ft => ({
            ...ft.task,
            status: 'failed',
            error: ft.error
          }))
        };

        const prUrl = await this.gitManager.createSessionPR(sessionData);
        if (prUrl) {
          this.logger.info(`✅ Session PR created: ${prUrl}`);
        }
      } else {
        // Task-based PRs are created immediately after each task
        this.logger.info('✅ Individual task PRs have been created');
        const taskPRs = this.state.completedTasks
          .filter(ct => ct.prUrl)
          .map(ct => `  - ${ct.task.title}: ${ct.prUrl}`);
        if (taskPRs.length > 0) {
          this.logger.info('📋 Task PRs:');
          taskPRs.forEach(pr => this.logger.info(pr));
        }
      }
    } else if (results.completed > 0 && this.options.dryRun) {
      this.logger.info('🔄 Dry run mode - skipping pull request creation');
    }

    // Clean up any remaining task branches (failed tasks) (skip in dry-run mode)
    if (!this.options.dryRun) {
      this.logger.info('🧹 Cleaning up remaining branches...');
      await this.gitManager.cleanupSessionBranches();
    } else {
      this.logger.info('🔄 Dry run mode - skipping branch cleanup');
    }

    // Create session summary commit on main (for record keeping) (skip in dry-run mode)
    if ((results.completed > 0 || results.failed > 0) && !this.options.dryRun) {
      await this.gitManager.createSessionSummaryCommit({
        sessionId: this.state.sessionId,
        completedTasks: results.completed,
        totalTasks: results.completed + results.failed,
        duration: this.state.endTime - this.state.startTime
      });
    } else if ((results.completed > 0 || results.failed > 0) && this.options.dryRun) {
      this.logger.info('🔄 Dry run mode - skipping session summary commit');
    }

    // Create final checkpoint
    await this.createCheckpoint();

    // Generate and save report
    const report = await this.reporter.generateSessionReport(this.state, results);

    // Display final summary with pretty UI
    console.log();
    this.prettyLogger.divider('═', 60, 'cyan');

    // Session results table
    const resultTableData = [
      [require('chalk').bold('Session Results'), '', '', ''],
      ['Status', 'Metric', 'Value', 'Result']
    ];

    const successRate = results.completed + results.failed > 0
      ? Math.round((results.completed / (results.completed + results.failed)) * 100)
      : 0;

    // Strip emoji variant selectors for proper table alignment
    const stripVariants = (str) => str.replace(/\uFE0F/g, '');

    resultTableData.push(
      [require('chalk').green(stripVariants('✅')), 'Completed Tasks', `${results.completed}`, require('chalk').green('Success')],
      [require('chalk').red(stripVariants('❌')), 'Failed Tasks', `${results.failed}`, results.failed > 0 ? require('chalk').red('Failed') : '-'],
      [require('chalk').blue(stripVariants('📊')), 'Success Rate', `${successRate}%`, successRate >= 80 ? require('chalk').green('Good') : require('chalk').yellow('Needs Improvement')],
      [require('chalk').yellow(stripVariants('⏱️')), 'Duration', `${durationMinutes}m`, require('chalk').cyan(`${Math.round(durationMinutes / 60 * 10) / 10}h`)]
    );

    this.prettyLogger.table(resultTableData, {
      columnWidths: [8, 20, 15, 20],
      align: ['center', 'left', 'center', 'center'],
      config: {
        spanningCells: [
          { col: 0, row: 0, colSpan: 4, alignment: 'center' }
        ]
      }
    });

    console.log();

    // Summary box
    const summaryLines = [
      require('chalk').green.bold('✨ Session Completed Successfully! ✨'),
      '',
      `🆔 Session ID: ${this.state.sessionId}`,
      `📁 Working Directory: ${this.options.workingDir}`,
      ''
    ];

    if (results.completed > 0 && !this.options.dryRun) {
      summaryLines.push('🎉 All successful tasks have been merged to main branch!');
    } else if (results.completed > 0 && this.options.dryRun) {
      summaryLines.push(require('chalk').yellow('🔄 Dry run mode - tasks would have been merged to main branch'));
    }

    if (this.state.failedTasks.length > 0) {
      summaryLines.push('', require('chalk').red('Failed tasks:'));
      this.state.failedTasks.forEach(ft => {
        summaryLines.push(require('chalk').red(`  • ${ft.task.title}: ${ft.error.message}`));
      });
    }

    this.prettyLogger.box(summaryLines.join('\n'), {
      borderStyle: 'round',
      borderColor: results.failed === 0 ? 'green' : 'yellow',
      padding: 2,
      align: 'left'
    });

    console.log();
  }

  async handleFailure (error) {
    this.logger.error('Handling session failure', { error: error.message, stack: error.stack });

    // Try to save current state
    try {
      await this.createCheckpoint();
    } catch (checkpointError) {
      this.logger.error('Failed to create failure checkpoint', { error: checkpointError.message });
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
      totalTasks: this.state.completedTasks.length + this.state.failedTasks.length,
      errors: this.state.failedTasks.map(ft => ft.error),
      resourceUsage: this.state.resourceUsage,
      checkpoints: this.state.checkpoints.length
    };
  }
}

module.exports = { Orchestrator };
