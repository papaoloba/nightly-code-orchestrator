const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('cross-spawn');
const { EventEmitter } = require('events');
const winston = require('winston');
const pidusage = require('pidusage');

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
      workingDir: options.workingDir || process.cwd()
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
  
  setupLogging() {
    const logDir = path.join(this.options.workingDir, '.nightly-code', 'logs');
    fs.ensureDirSync(logDir);
    
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      transports: [
        new winston.transports.File({
          filename: path.join(logDir, `${this.state.sessionId}.log`)
        }),
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        })
      ]
    });
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
      this.logger.info('Starting orchestration session', {
        sessionId: this.state.sessionId,
        options: this.options
      });
      
      this.state.startTime = Date.now();
      
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
      this.logger.error('Orchestration session failed', { error: error.message, stack: error.stack });
      await this.handleFailure(error);
      throw error;
    }
  }
  
  async validateEnvironment() {
    this.logger.info('Validating environment');
    
    // Check if Claude Code is available
    try {
      const result = await this.executeCommand('claude', ['--version'], { timeout: 10000 });
      this.logger.info('Claude Code version', { version: result.stdout.trim() });
    } catch (error) {
      throw new Error('Claude Code CLI not found. Please install claude-code first.');
    }
    
    // Validate configuration
    const validation = await this.validator.validateAll();
    if (!validation.valid) {
      throw new Error(`Configuration validation failed: ${validation.errors.map(e => e.message).join(', ')}`);
    }
    
    // Check available disk space
    const stats = await fs.stat(this.options.workingDir);
    const freeSpace = await this.getAvailableDiskSpace();
    if (freeSpace < 1000000000) { // Less than 1GB
      this.logger.warn('Low disk space detected', { freeSpaceGB: Math.round(freeSpace / 1000000000) });
    }
    
    // Initialize git if needed
    await this.gitManager.ensureRepository();
    
    this.logger.info('Environment validation completed');
  }
  
  async loadTasks() {
    this.logger.info('Loading tasks');
    
    const tasks = await this.taskManager.loadTasks();
    const orderedTasks = await this.taskManager.resolveDependencies(tasks);
    
    this.logger.info('Tasks loaded and ordered', {
      totalTasks: orderedTasks.length,
      estimatedDuration: orderedTasks.reduce((sum, task) => sum + (task.estimated_duration || 0), 0)
    });
    
    return orderedTasks;
  }
  
  async executeTasks(tasks) {
    const results = {
      completed: 0,
      failed: 0,
      skipped: 0,
      totalTasks: tasks.length
    };
    
    for (const task of tasks) {
      try {
        // Check time remaining
        const elapsed = (Date.now() - this.state.startTime) / 1000;
        if (elapsed >= this.options.maxDuration) {
          this.logger.warn('Maximum session duration reached', { elapsed, maxDuration: this.options.maxDuration });
          break;
        }
        
        this.state.currentTask = task;
        this.logger.info('Starting task', { taskId: task.id, title: task.title });
        
        // Create task branch
        const branchName = await this.gitManager.createTaskBranch(task);
        
        // Execute task with Claude Code
        const taskResult = await this.executeTask(task);
        
        if (taskResult.success) {
          // Validate task completion
          const validation = await this.validateTaskCompletion(task, taskResult);
          
          if (validation.passed) {
            // Commit changes
            await this.gitManager.commitTask(task, taskResult);
            
            this.state.completedTasks.push({
              task,
              result: taskResult,
              validation,
              completedAt: Date.now()
            });
            
            results.completed++;
            this.logger.info('Task completed successfully', { taskId: task.id });
          } else {
            throw new Error(`Task validation failed: ${validation.errors.join(', ')}`);
          }
        } else {
          throw new Error(`Task execution failed: ${taskResult.error}`);
        }
        
      } catch (error) {
        this.logger.error('Task failed', { taskId: task.id, error: error.message });
        
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
    
    this.logger.info('Executing task with Claude Code', {
      taskId: task.id,
      timeoutMs,
      promptLength: prompt.length
    });
    
    try {
      if (this.options.dryRun) {
        this.logger.info('Dry run mode - skipping actual execution');
        return {
          success: true,
          output: 'Dry run - task not actually executed',
          filesChanged: [],
          duration: 0
        };
      }
      
      const startTime = Date.now();
      
      // Execute Claude Code with the generated prompt
      const result = await this.executeClaudeCode(prompt, {
        timeout: timeoutMs,
        workingDir: this.options.workingDir
      });
      
      const duration = Date.now() - startTime;
      
      // Analyze changes made by Claude Code
      const filesChanged = await this.gitManager.getChangedFiles();
      
      return {
        success: true,
        output: result.stdout,
        error: result.stderr,
        filesChanged,
        duration
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message,
        filesChanged: [],
        duration: 0
      };
    }
  }
  
  async executeClaudeCode(prompt, options = {}) {
    return new Promise((resolve, reject) => {
      const args = ['--non-interactive'];
      
      const child = spawn('claude', args, {
        cwd: options.workingDir || this.options.workingDir,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      this.state.claudeProcess = child;
      
      let stdout = '';
      let stderr = '';
      
      child.stdout.on('data', (data) => {
        stdout += data.toString();
        this.logger.debug('Claude Code stdout', { data: data.toString() });
      });
      
      child.stderr.on('data', (data) => {
        stderr += data.toString();
        this.logger.debug('Claude Code stderr', { data: data.toString() });
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
          reject(new Error(`Claude Code exited with code ${code}: ${stderr}`));
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
    this.logger.info('Validating task completion', { taskId: task.id });
    
    const validation = {
      passed: true,
      errors: [],
      warnings: []
    };
    
    try {
      // Run project tests if specified
      if (task.custom_validation?.script) {
        const scriptResult = await this.executeCommand('node', [task.custom_validation.script], {
          timeout: task.custom_validation.timeout * 1000 || 300000
        });
        
        if (scriptResult.code !== 0) {
          validation.passed = false;
          validation.errors.push(`Custom validation script failed: ${scriptResult.stderr}`);
        }
      }
      
      // Check if files were actually modified
      if (result.filesChanged.length === 0 && task.type !== 'docs') {
        validation.warnings.push('No files were modified during task execution');
      }
      
      // Run general project validation
      const projectValidation = await this.validator.validateProject();
      if (!projectValidation.valid) {
        validation.passed = false;
        validation.errors.push(...projectValidation.errors.map(e => e.message));
      }
      
    } catch (error) {
      validation.passed = false;
      validation.errors.push(`Validation error: ${error.message}`);
    }
    
    this.logger.info('Task validation completed', {
      taskId: task.id,
      passed: validation.passed,
      errors: validation.errors.length,
      warnings: validation.warnings.length
    });
    
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
    
    // Create final checkpoint
    await this.createCheckpoint();
    
    // Generate and save report
    const report = await this.reporter.generateSessionReport(this.state, results);
    
    this.logger.info('Session finalized', {
      duration: this.state.endTime - this.state.startTime,
      completed: results.completed,
      failed: results.failed
    });
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