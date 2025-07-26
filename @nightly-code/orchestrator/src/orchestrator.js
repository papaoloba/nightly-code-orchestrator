const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('cross-spawn');
const { EventEmitter } = require('events');
const winston = require('winston');
const pidusage = require('pidusage');
const YAML = require('js-yaml');

const { TaskManager } = require('./task-manager');
const { GitManager } = require('./git-manager');
const { Validator } = require('./validator');
const { Reporter } = require('./reporter');

class Orchestrator extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      configPath: options.configPath || 'nightly-code.yaml',
      tasksPath: options.tasksPath || 'nightly-tasks.yaml',
      maxDuration: options.maxDuration || 28800, // 8 hours in seconds
      checkpointInterval: options.checkpointInterval || 300, // 5 minutes
      dryRun: options.dryRun || false,
      resumeCheckpoint: options.resumeCheckpoint || null,
      workingDir: options.workingDir || process.cwd(),
      // Rate limiting and retry configuration
      rateLimitRetries: options.rateLimitRetries || 5,
      rateLimitBaseDelay: options.rateLimitBaseDelay || 60000, // 1 minute
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
    
    this.setupLogging();
    this.setupComponents();
  }
  
  generateSessionId() {
    const date = new Date().toISOString().split('T')[0];
    const time = new Date().toISOString().split('T')[1].split('.')[0].replace(/:/g, '');
    return `session-${date}-${time}`;
  }
  
  // Helper methods for timing operations
  startOperation(operationName) {
    if (!this.operationTimers) {
      this.operationTimers = new Map();
    }
    this.operationTimers.set(operationName, Date.now());
  }
  
  endOperation(operationName) {
    if (!this.operationTimers || !this.operationTimers.has(operationName)) {
      return '';
    }
    const startTime = this.operationTimers.get(operationName);
    const duration = Date.now() - startTime;
    this.operationTimers.delete(operationName);
    
    const seconds = Math.round(duration / 1000);
    const timeStr = seconds >= 60 ? 
      `${Math.floor(seconds / 60)}m ${seconds % 60}s` : 
      `${seconds}s`;
    
    return ` \x1b[35m[took ${timeStr}]\x1b[0m`; // Magenta color for operation timing
  }
  
  logWithTiming(level, message, operationName = null) {
    const timing = operationName ? this.endOperation(operationName) : '';
    this.logger[level](`${message}${timing}`);
  }
  
  setupLogging() {
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
        const elapsed = Math.round((Date.now() - this.state.startTime) / 1000);
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
  
  async loadConfigurationFile() {
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
          this.options.maxDelay = config.rate_limiting.max_delay || 3600000;
          this.options.exponentialBackoff = config.rate_limiting.exponential_backoff !== false;
          this.options.jitter = config.rate_limiting.jitter !== false;
        }
        
        return config;
      }
    } catch (error) {
      this.logger.warn(`Could not load configuration file: ${error.message}`);
    }
    return null;
  }

  setupComponents() {
    this.taskManager = new TaskManager({
      tasksPath: this.options.tasksPath,
      logger: this.logger
    });
    
    this.gitManager = new GitManager({
      workingDir: this.options.workingDir,
      logger: this.logger
    });
    
    this.validator = new Validator({
      configPath: this.options.configPath,
      tasksPath: this.options.tasksPath,
      logger: this.logger
    });
    
    this.reporter = new Reporter({
      workingDir: this.options.workingDir,
      logger: this.logger
    });
  }
  
  async run() {
    try {
      this.logger.info('');
      this.logger.info('🚀 Starting Nightly Code Orchestration Session');
      this.logger.info('═══════════════════════════════════════════════');
      this.logger.info(`📋 Session ID: ${this.state.sessionId}`);
      this.logger.info(`📁 Working Directory: ${this.options.workingDir}`);
      this.logger.info('');
      
      this.state.startTime = Date.now();
      
      // Load configuration file
      await this.loadConfigurationFile();
      
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
  
  async validateEnvironment() {
    this.startOperation('environment-validation');
    this.logger.info('🔧 Validating Environment');
    this.logger.info('─────────────────────────');
    
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
    const freeSpaceGB = Math.round(freeSpace / 1000000000);
    if (freeSpace < 1000000000) { // Less than 1GB
      this.logger.warn(`⚠️  Low disk space: ${freeSpaceGB}GB available`);
    } else {
      this.logger.info(`💾 Disk space: ${freeSpaceGB}GB available`);
    }
    
    // Initialize git if needed
    await this.gitManager.ensureRepository();
    
    // Create session branch for this coding session
    await this.gitManager.createSessionBranch(this.state.sessionId);
    
    this.logWithTiming('info', '✅ Environment validation completed', 'environment-validation');
    this.logger.info('');
  }
  
  async loadTasks() {
    this.startOperation('task-loading');
    this.logger.info('📋 Loading Tasks');
    this.logger.info('─────────────────');
    
    const tasks = await this.taskManager.loadTasks();
    const orderedTasks = await this.taskManager.resolveDependencies(tasks);
    
    const totalTasks = orderedTasks.length;
    const estimatedDuration = orderedTasks.reduce((sum, task) => sum + (task.estimated_duration || 0), 0);
    
    this.logger.info(`✅ Loaded ${totalTasks} tasks`);
    this.logger.info(`⏱️  Estimated duration: ${Math.round(estimatedDuration)} minutes`);
    
    // Show task overview
    if (orderedTasks.length > 0) {
      this.logger.info('📝 Task Overview:');
      orderedTasks.forEach((task, index) => {
        const priority = task.priority || 'medium';
        const priorityIcon = priority === 'high' ? '🔴' : priority === 'low' ? '🟢' : '🟡';
        this.logger.info(`   ${index + 1}. ${priorityIcon} ${task.title} (${task.estimated_duration || 60}min)`);
      });
    }
    
    this.logWithTiming('info', '', 'task-loading'); // Just show timing without duplicate message
    this.logger.info('');
    return orderedTasks;
  }
  
  async executeTasks(tasks) {
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
        const elapsed = (Date.now() - this.state.startTime) / 1000;
        if (elapsed >= this.options.maxDuration) {
          this.logger.warn(`⏰ Maximum session duration reached (${Math.round(elapsed)}s)`);
          break;
        }
        
        this.state.currentTask = task;
        const taskOperationName = `task-${task.id}`;
        this.startOperation(taskOperationName);
        
        // Task header
        this.logger.info('');
        this.logger.info(`📋 Task ${taskNum}/${totalTasks}: ${task.title}`);
        this.logger.info('─'.repeat(50));
        this.logger.info(`🔧 Type: ${task.type}`);
        this.logger.info(`⏱️  Estimated: ${task.estimated_duration || 60} minutes`);
        this.logger.info(`🆔 ID: ${task.id}`);
        
        // Ensure we're on the session branch (task branch creation is now handled differently)
        const branchName = await this.gitManager.createTaskBranch(task);
        
        // Execute task with Claude Code
        const taskResult = await this.executeTask(task);
        
        if (taskResult.success) {
          // Validate task completion
          const validation = await this.validateTaskCompletion(task, taskResult);
          
          if (validation.passed) {
            // Commit changes to session branch
            await this.gitManager.commitTask(task, taskResult);
            
            this.state.completedTasks.push({
              task,
              result: taskResult,
              validation,
              completedAt: Date.now()
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
        
        // Revert to previous state
        await this.gitManager.revertTaskChanges(task);
        
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
    
    return results;
  }
  
  async executeTask(task) {
    const timeoutMs = (task.estimated_duration || 60) * 60 * 1000; // Convert minutes to milliseconds
    const prompt = await this.generateTaskPrompt(task);
    
    const timeoutMinutes = Math.round(timeoutMs / 60000);
    this.logger.info(`🤖 Executing task with Claude Code (timeout: ${timeoutMinutes}min)`);
    
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
      const durationSeconds = Math.round(duration / 1000);
      
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
  
  async executeClaudeCode(prompt, options = {}) {
    // Check if rate limiting is enabled
    if (!this.options.enableRetryOnLimits) {
      return await this.executeClaudeCodeSingle(prompt, options);
    }
    
    const maxRetries = options.maxRetries || this.options.rateLimitRetries || 5;
    const baseDelay = options.baseDelay || this.options.rateLimitBaseDelay || 60000; // 1 minute default
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.executeClaudeCodeSingle(prompt, options);
        return result;
      } catch (error) {
        const errorType = this.classifyError(error);
        
        if (errorType === 'RATE_LIMIT' && this.options.rateLimitRetry) {
          if (attempt < maxRetries) {
            const delay = this.calculateBackoffDelay(attempt, baseDelay, errorType);
            this.logger.warn(`🔄 Rate limit encountered. Waiting ${Math.round(delay / 1000)}s before retry (attempt ${attempt + 1}/${maxRetries})...`);
            
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
            this.logger.warn(`🔄 Usage limit encountered. Waiting ${Math.round(delay / 1000)}s before retry (attempt ${attempt + 1}/${maxRetries})...`);
            
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
            const delay = 5000; // 5 seconds for general errors
            this.logger.warn(`⚠️  Execution failed, retrying in ${delay / 1000}s (attempt ${attempt + 1}/${maxRetries})...`);
            await this.sleep(delay);
            continue;
          } else {
            throw error;
          }
        }
      }
    }
  }

  async executeClaudeCodeSingle(prompt, options = {}) {
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
        // Display Claude Code output in real-time
        output.split('\n').forEach(line => {
          if (line.trim()) {
            this.logger.info(`🤖 Claude: ${line}`);
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
      }, options.timeout || 300000); // Default 5 minutes
      
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
      
      // Send the prompt to Claude Code
      child.stdin.write(prompt);
      child.stdin.end();
    });
  }

  classifyError(error) {
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
      /ENOSPC/,  // No space left
      /ENOMEM/   // Out of memory
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

  calculateBackoffDelay(attempt, baseDelay, errorType) {
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
    const maxDelay = this.options.maxDelay || (errorType === 'USAGE_LIMIT' ? 3600000 : 900000);
    return Math.min(delay, maxDelay);
  }

  async waitWithProgress(totalDelay, errorType) {
    const updateInterval = 30000; // Update every 30 seconds
    const startTime = Date.now();
    const endTime = startTime + totalDelay;
    
    const limitType = errorType === 'USAGE_LIMIT' ? 'usage limit' : 'rate limit';
    this.logger.info(`⏸️  Session paused due to ${limitType}. Keeping session alive...`);
    
    while (Date.now() < endTime) {
      const remaining = endTime - Date.now();
      const remainingMinutes = Math.ceil(remaining / 60000);
      
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

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  async generateTaskPrompt(task) {
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
  
  async gatherProjectContext() {
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
  
  async gatherTaskContext(task) {
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
  
  async findMatchingFiles(pattern) {
    const glob = require('glob');
    return new Promise((resolve, reject) => {
      glob(pattern, { cwd: this.options.workingDir }, (err, files) => {
        if (err) reject(err);
        else resolve(files);
      });
    });
  }
  
  async validateTaskCompletion(task, result) {
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
          timeout: task.custom_validation.timeout * 1000 || 300000
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
  
  startResourceMonitoring() {
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
  
  startCheckpointTimer() {
    this.checkpointInterval = setInterval(async () => {
      await this.createCheckpoint();
    }, this.options.checkpointInterval * 1000);
  }
  
  async createCheckpoint() {
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
  
  async resumeFromCheckpoint(checkpointPath) {
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
  
  async executeCommand(command, args = [], options = {}) {
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
      }, options.timeout || 60000);
      
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
  
  async getAvailableDiskSpace() {
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
  
  isCriticalFailure(error) {
    const criticalPatterns = [
      /ENOSPC/, // No space left on device
      /ENOMEM/, // Out of memory
      /Repository not found/,
      /Authentication failed/
    ];
    
    return criticalPatterns.some(pattern => pattern.test(error.message));
  }
  
  async finalize(results) {
    this.state.endTime = Date.now();
    const duration = this.state.endTime - this.state.startTime;
    const durationMinutes = Math.round(duration / 60000);
    
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
    
    // Create session pull request
    if (results.completed > 0) {
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
    }
    
    // Clean up any remaining task branches (failed tasks)
    this.logger.info('🧹 Cleaning up remaining branches...');
    await this.gitManager.cleanupSessionBranches();
    
    // Create session summary commit on main (for record keeping)
    if (results.completed > 0 || results.failed > 0) {
      await this.gitManager.createSessionSummaryCommit({
        sessionId: this.state.sessionId,
        completedTasks: results.completed,
        totalTasks: results.completed + results.failed,
        duration: this.state.endTime - this.state.startTime
      });
    }
    
    // Create final checkpoint
    await this.createCheckpoint();
    
    // Generate and save report
    const report = await this.reporter.generateSessionReport(this.state, results);
    
    // Display final summary
    this.logger.info('');
    this.logger.info('📊 Session Summary');
    this.logger.info('═══════════════════');
    this.logger.info(`🆔 Session: ${this.state.sessionId}`);
    this.logger.info(`⏱️  Duration: ${durationMinutes} minutes`);
    this.logger.info(`✅ Completed: ${results.completed} tasks`);
    this.logger.info(`❌ Failed: ${results.failed} tasks`);
    this.logger.info(`📊 Success Rate: ${results.completed + results.failed > 0 ? Math.round((results.completed / (results.completed + results.failed)) * 100) : 0}%`);
    
    if (results.completed > 0) {
      this.logger.info('🎉 All successful tasks have been merged to main branch!');
    }
    
    this.logger.info('');
    this.logger.info('✨ Session completed successfully!');
    this.logger.info('');
  }
  
  async handleFailure(error) {
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
  
  generateFinalReport() {
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