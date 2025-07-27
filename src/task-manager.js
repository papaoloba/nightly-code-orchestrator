const fs = require('fs-extra');
const path = require('path');
const YAML = require('yaml');
const Joi = require('joi');
const { TIME } = require('./constants');
const { createErrorHandler } = require('./error-handler');
const { ValidationError: CustomValidationError, FileSystemError } = require('./errors');

/**
 * TaskManager handles loading, validation, and management of tasks for nightly-claude-code
 * Provides centralized task configuration management with validation and error handling
 *
 * @class TaskManager
 * @example
 * const taskManager = new TaskManager({
 *   tasksPath: 'my-tasks.yaml',
 *   workingDir: '/path/to/project',
 *   logger: myLogger
 * });
 *
 * const tasks = await taskManager.loadTasks();
 */
class TaskManager {
  /**
   * Create a new TaskManager instance
   *
   * @param {Object} options - Configuration options
   * @param {string} [options.tasksPath='nightly-tasks.yaml'] - Path to tasks configuration file
   * @param {string} [options.workingDir=process.cwd()] - Working directory for relative paths
   * @param {Object} [options.logger=console] - Logger instance for output
   */
  constructor (options = {}) {
    this.options = {
      tasksPath: options.tasksPath || 'nightly-tasks.yaml',
      workingDir: options.workingDir || process.cwd(),
      logger: options.logger || console
    };

    this.taskSchema = this.createTaskSchema();
    this.tasks = [];
    this.errorHandler = createErrorHandler('TaskManager', this.options.logger);
  }

  /**
   * Create Joi validation schema for task objects
   * Defines the structure and validation rules for individual tasks
   *
   * @private
   * @returns {Object} Joi schema object for task validation
   */
  createTaskSchema () {
    return Joi.object({
      id: Joi.string().required().pattern(/^[a-zA-Z0-9-_]+$/),
      type: Joi.string().valid('feature', 'bugfix', 'refactor', 'test', 'docs').required(),
      priority: Joi.number().integer().min(1).max(10).default(5),
      title: Joi.string().required().max(200),
      requirements: Joi.string().required(),
      acceptance_criteria: Joi.array().items(Joi.string()).default([]),
      estimated_duration: Joi.number().integer().min(1).max(480).default(60), // minutes
      dependencies: Joi.array().items(Joi.string()).default([]),
      tags: Joi.array().items(Joi.string()).default([]),
      files_to_modify: Joi.array().items(Joi.string()).default([]),
      custom_validation: Joi.object({
        script: Joi.string(),
        timeout: Joi.number().integer().min(1).max(600).default(TIME.SECONDS.DEFAULT_TASK_TIMEOUT)
      }).optional(),
      enabled: Joi.boolean().default(true),
      created_at: Joi.date().default(() => new Date()),
      updated_at: Joi.date().default(() => new Date())
    });
  }

  /**
   * Load and validate tasks from the configured tasks file
   * Supports both YAML and JSON formats with automatic detection
   *
   * @async
   * @returns {Promise<Array>} Array of validated and enabled tasks
   * @throws {FileSystemError} When tasks file cannot be found or read
   * @throws {ValidationError} When task validation fails
   *
   * @example
   * try {
   *   const tasks = await taskManager.loadTasks();
   *   console.log(`Loaded ${tasks.length} tasks`);
   * } catch (error) {
   *   console.error('Failed to load tasks:', error.message);
   * }
   */
  async loadTasks () {
    const tasksFilePath = path.resolve(this.options.workingDir, this.options.tasksPath);

    this.options.logger.info('Loading tasks from file', { tasksFilePath });

    return this.errorHandler.executeWithRetry(
      async () => {
        if (!await fs.pathExists(tasksFilePath)) {
          throw new FileSystemError(`Tasks file not found: ${tasksFilePath}`, tasksFilePath, 'read');
        }

        return this._performTaskLoading(tasksFilePath);
      },
      {
        operationName: 'Load Tasks',
        maxRetries: 2, // Allow retries for transient file system issues
        critical: true
      }
    );
  }

  /**
   * Internal method to perform the actual task loading and validation
   * Separated for better error handling and retry logic
   *
   * @private
   * @async
   * @param {string} tasksFilePath - Absolute path to the tasks file
   * @returns {Promise<Array>} Array of validated tasks
   * @throws {ValidationError} When task structure or individual tasks are invalid
   */
  async _performTaskLoading (tasksFilePath) {
    const fileContent = await fs.readFile(tasksFilePath, 'utf8');
    let tasksData;

    // Support both YAML and JSON formats
    if (tasksFilePath.endsWith('.yaml') || tasksFilePath.endsWith('.yml')) {
      tasksData = YAML.parse(fileContent);
    } else if (tasksFilePath.endsWith('.json')) {
      tasksData = JSON.parse(fileContent);
    } else {
      // Try to parse as YAML first, then JSON
      try {
        tasksData = YAML.parse(fileContent);
      } catch (yamlError) {
        tasksData = JSON.parse(fileContent);
      }
    }

    // Validate tasks structure
    if (!tasksData || !tasksData.tasks || !Array.isArray(tasksData.tasks)) {
      throw new CustomValidationError('Invalid tasks file format. Expected { tasks: [...] }', 'tasks', tasksData);
    }

    // Validate and process each task
    const validatedTasks = [];
    for (const [index, task] of tasksData.tasks.entries()) {
      try {
        const validatedTask = await this.validateTask(task);
        if (validatedTask.enabled) {
          validatedTasks.push(validatedTask);
        }
      } catch (validationError) {
        this.errorHandler.logError(validationError, {
          operation: 'Task Validation',
          taskIndex: index,
          taskId: task.id || `task-${index}`
        });
        throw new CustomValidationError(
          `Task ${task.id || index} validation failed: ${validationError.message}`,
          task.id || `task-${index}`,
          task
        );
      }
    }

    this.tasks = validatedTasks;

    this.options.logger.info('Tasks loaded successfully', {
      totalTasks: this.tasks.length,
      enabledTasks: this.tasks.filter(t => t.enabled).length
    });

    return this.tasks;
  }

  /**
   * Validate a single task against the schema and custom rules
   *
   * @async
   * @param {Object} task - Task object to validate
   * @returns {Promise<Object>} Validated and normalized task object
   * @throws {ValidationError} When task validation fails
   *
   * @example
   * const validatedTask = await taskManager.validateTask({
   *   id: 'fix-bug-123',
   *   type: 'bugfix',
   *   title: 'Fix login issue',
   *   requirements: 'Fix the authentication bug in login flow'
   * });
   */
  async validateTask (task) {
    const { error, value } = this.taskSchema.validate(task, {
      allowUnknown: true,
      stripUnknown: true
    });

    if (error) {
      const validationMessages = error.details.map(d => d.message).join(', ');
      throw new CustomValidationError(
        `Task validation failed: ${validationMessages}`,
        error.details[0]?.path ? error.details[0].path.join('.') : 'unknown',
        task
      );
    }

    // Additional custom validations
    await this.performCustomValidations(value);

    return value;
  }

  /**
   * Perform additional custom validations beyond schema validation
   * Checks for business logic constraints like duplicate IDs and file patterns
   *
   * @async
   * @param {Object} task - Task object to validate
   * @throws {ValidationError} When custom validation rules fail
   * @private
   */
  async performCustomValidations (task) {
    // Check for duplicate task IDs
    const existingTask = this.tasks.find(t => t.id === task.id);
    if (existingTask) {
      throw new CustomValidationError(
        `Duplicate task ID: ${task.id}`,
        'id',
        task.id
      );
    }

    // Validate file patterns
    if (task.files_to_modify && task.files_to_modify.length > 0) {
      for (const pattern of task.files_to_modify) {
        if (!this.isValidFilePattern(pattern)) {
          throw new Error(`Invalid file pattern: ${pattern}`);
        }
      }
    }

    // Validate custom validation script exists
    if (task.custom_validation?.script) {
      const scriptPath = path.resolve(this.options.workingDir, task.custom_validation.script);
      if (!await fs.pathExists(scriptPath)) {
        throw new Error(`Custom validation script not found: ${scriptPath}`);
      }
    }

    // Estimate duration validation
    if (task.estimated_duration > 240) { // More than 4 hours
      this.options.logger.warn('Task has very long estimated duration', {
        taskId: task.id,
        duration: task.estimated_duration
      });
    }
  }

  isValidFilePattern (pattern) {
    // Basic validation for file patterns - allow glob patterns with * and ?
    const invalidChars = /[<>:"|]/;
    if (invalidChars.test(pattern)) {
      return false;
    }

    // Check for dangerous patterns
    const dangerousPatterns = [
      /\.\.\//, // Directory traversal
      /^\//, // Absolute paths
      /~/ // Home directory
    ];

    return !dangerousPatterns.some(p => p.test(pattern));
  }

  async resolveDependencies (tasks = null) {
    const tasksToOrder = tasks || this.tasks;

    this.options.logger.info('Resolving task dependencies', { totalTasks: tasksToOrder.length });

    // Build dependency graph
    const dependencyGraph = new Map();
    const taskMap = new Map();

    // Initialize graph
    for (const task of tasksToOrder) {
      taskMap.set(task.id, task);
      dependencyGraph.set(task.id, {
        task,
        dependencies: task.dependencies || [],
        dependents: []
      });
    }

    // Validate dependencies exist
    for (const task of tasksToOrder) {
      for (const depId of task.dependencies || []) {
        if (!taskMap.has(depId)) {
          throw new Error(`Task ${task.id} depends on non-existent task: ${depId}`);
        }

        // Add to dependents list
        const depNode = dependencyGraph.get(depId);
        depNode.dependents.push(task.id);
      }
    }

    // Check for circular dependencies
    this.detectCircularDependencies(dependencyGraph);

    // Topological sort
    const sorted = this.topologicalSort(dependencyGraph);

    // Apply priority-based ordering within dependency levels
    const orderedTasks = this.applyPriorityOrdering(sorted, taskMap);

    this.options.logger.info('Dependencies resolved successfully', {
      originalOrder: tasksToOrder.map(t => t.id),
      resolvedOrder: orderedTasks.map(t => t.id)
    });

    return orderedTasks;
  }

  detectCircularDependencies (graph) {
    const visited = new Set();
    const recursionStack = new Set();

    const hasCycle = (nodeId, path = []) => {
      if (recursionStack.has(nodeId)) {
        const cycleStart = path.indexOf(nodeId);
        const cycle = path.slice(cycleStart).concat(nodeId);
        throw new Error(`Circular dependency detected: ${cycle.join(' -> ')}`);
      }

      if (visited.has(nodeId)) {
        return false;
      }

      visited.add(nodeId);
      recursionStack.add(nodeId);
      path.push(nodeId);

      const node = graph.get(nodeId);
      for (const depId of node.dependencies) {
        if (hasCycle(depId, [...path])) {
          return true;
        }
      }

      recursionStack.delete(nodeId);
      return false;
    };

    for (const nodeId of graph.keys()) {
      if (!visited.has(nodeId)) {
        hasCycle(nodeId);
      }
    }
  }

  topologicalSort (graph) {
    const result = [];
    const visited = new Set();
    const temp = new Set();

    const visit = (nodeId) => {
      if (temp.has(nodeId)) {
        throw new Error(`Circular dependency involving ${nodeId}`);
      }

      if (!visited.has(nodeId)) {
        temp.add(nodeId);

        const node = graph.get(nodeId);
        for (const depId of node.dependencies) {
          visit(depId);
        }

        temp.delete(nodeId);
        visited.add(nodeId);
        result.unshift(node.task);
      }
    };

    for (const nodeId of graph.keys()) {
      if (!visited.has(nodeId)) {
        visit(nodeId);
      }
    }

    return result;
  }

  applyPriorityOrdering (tasks, taskMap) {
    // Group tasks by dependency level
    const levels = [];
    const processed = new Set();

    while (processed.size < tasks.length) {
      const currentLevel = [];

      for (const task of tasks) {
        if (processed.has(task.id)) continue;

        // Check if all dependencies are processed
        const allDepsProcessed = (task.dependencies || []).every(depId =>
          processed.has(depId)
        );

        if (allDepsProcessed) {
          currentLevel.push(task);
          processed.add(task.id);
        }
      }

      if (currentLevel.length === 0) {
        throw new Error('Unable to resolve task dependencies - possible circular reference');
      }

      // Sort current level by priority (higher number = higher priority)
      currentLevel.sort((a, b) => {
        // First by priority (descending)
        if (a.priority !== b.priority) {
          return b.priority - a.priority;
        }

        // Then by type priority
        const typePriority = {
          bugfix: 4,
          feature: 3,
          refactor: 2,
          test: 1,
          docs: 0
        };

        const aPriority = typePriority[a.type] || 0;
        const bPriority = typePriority[b.type] || 0;

        if (aPriority !== bPriority) {
          return bPriority - aPriority;
        }

        // Finally by estimated duration (shorter tasks first)
        return (a.estimated_duration || 60) - (b.estimated_duration || 60);
      });

      levels.push(currentLevel);
    }

    // Flatten levels into final order
    return levels.flat();
  }

  async estimateSessionDuration (tasks = null) {
    const tasksToEstimate = tasks || this.tasks;

    let totalEstimation = 0;
    const breakdown = {
      feature: 0,
      bugfix: 0,
      refactor: 0,
      test: 0,
      docs: 0
    };

    for (const task of tasksToEstimate) {
      const duration = task.estimated_duration || 60;
      totalEstimation += duration;

      if (Object.prototype.hasOwnProperty.call(breakdown, task.type)) {
        breakdown[task.type] += duration;
      }
    }

    // Add overhead for task switching, validation, etc.
    const overhead = Math.ceil(tasksToEstimate.length * 5); // 5 minutes per task
    totalEstimation += overhead;

    this.options.logger.info('Session duration estimated', {
      totalMinutes: totalEstimation,
      totalHours: Math.round(totalEstimation / 60 * 100) / 100,
      breakdown,
      overhead,
      taskCount: tasksToEstimate.length
    });

    return {
      totalMinutes: totalEstimation,
      totalHours: totalEstimation / 60,
      breakdown,
      overhead,
      taskCount: tasksToEstimate.length,
      averagePerTask: totalEstimation / tasksToEstimate.length
    };
  }

  async filterTasks (criteria = {}) {
    let filteredTasks = [...this.tasks];

    // Filter by type
    if (criteria.type) {
      const types = Array.isArray(criteria.type) ? criteria.type : [criteria.type];
      filteredTasks = filteredTasks.filter(task => types.includes(task.type));
    }

    // Filter by priority range
    if (criteria.minPriority !== undefined) {
      filteredTasks = filteredTasks.filter(task => task.priority >= criteria.minPriority);
    }

    if (criteria.maxPriority !== undefined) {
      filteredTasks = filteredTasks.filter(task => task.priority <= criteria.maxPriority);
    }

    // Filter by tags
    if (criteria.tags) {
      const requiredTags = Array.isArray(criteria.tags) ? criteria.tags : [criteria.tags];
      filteredTasks = filteredTasks.filter(task =>
        requiredTags.some(tag => (task.tags || []).includes(tag))
      );
    }

    // Filter by estimated duration
    if (criteria.maxDuration !== undefined) {
      filteredTasks = filteredTasks.filter(task =>
        (task.estimated_duration || 60) <= criteria.maxDuration
      );
    }

    // Filter by files to modify
    if (criteria.filePattern) {
      filteredTasks = filteredTasks.filter(task =>
        (task.files_to_modify || []).some(pattern =>
          pattern.includes(criteria.filePattern)
        )
      );
    }

    this.options.logger.info('Tasks filtered', {
      originalCount: this.tasks.length,
      filteredCount: filteredTasks.length,
      criteria
    });

    return filteredTasks;
  }

  async createTaskTemplate (type = 'feature') {
    const templates = {
      feature: {
        id: 'new-feature-id',
        type: 'feature',
        priority: 5,
        title: 'New Feature Title',
        requirements: `Detailed description of the feature requirements.
        
Include:
- What functionality should be implemented
- User acceptance criteria
- Any specific technical requirements
- Integration points with existing code`,
        acceptance_criteria: [
          'Feature implements core functionality',
          'All tests pass',
          'Documentation is updated',
          'Code follows project conventions'
        ],
        estimated_duration: 120,
        dependencies: [],
        tags: ['frontend', 'backend'],
        files_to_modify: ['src/'],
        enabled: true
      },

      bugfix: {
        id: 'bug-fix-id',
        type: 'bugfix',
        priority: 8,
        title: 'Bug Fix Title',
        requirements: `Description of the bug and how to fix it.
        
Include:
- Steps to reproduce the bug
- Expected vs actual behavior
- Root cause analysis
- Proposed solution`,
        acceptance_criteria: [
          'Bug is fixed and no longer reproducible',
          'Fix does not break existing functionality',
          'Tests are added to prevent regression',
          'Documentation is updated if needed'
        ],
        estimated_duration: 60,
        dependencies: [],
        tags: ['bugfix'],
        files_to_modify: [],
        enabled: true
      },

      refactor: {
        id: 'refactor-id',
        type: 'refactor',
        priority: 3,
        title: 'Code Refactoring',
        requirements: `Description of the refactoring needed.
        
Include:
- Current code structure issues
- Desired end state
- Performance or maintainability goals
- Backward compatibility requirements`,
        acceptance_criteria: [
          'Code is cleaner and more maintainable',
          'All existing tests still pass',
          'No functionality changes',
          'Performance is maintained or improved'
        ],
        estimated_duration: 90,
        dependencies: [],
        tags: ['refactor', 'cleanup'],
        files_to_modify: [],
        enabled: true
      },

      test: {
        id: 'test-id',
        type: 'test',
        priority: 6,
        title: 'Add Tests',
        requirements: `Description of tests to be added.
        
Include:
- What functionality needs testing
- Types of tests (unit, integration, e2e)
- Coverage goals
- Test data requirements`,
        acceptance_criteria: [
          'Test coverage increases appropriately',
          'Tests are well-structured and maintainable',
          'All tests pass consistently',
          'Test documentation is clear'
        ],
        estimated_duration: 75,
        dependencies: [],
        tags: ['testing'],
        files_to_modify: ['test/', 'spec/'],
        enabled: true
      },

      docs: {
        id: 'docs-id',
        type: 'docs',
        priority: 2,
        title: 'Documentation Update',
        requirements: `Description of documentation to be created or updated.
        
Include:
- What needs to be documented
- Target audience (developers, users, etc.)
- Format requirements (API docs, README, etc.)
- Examples or diagrams needed`,
        acceptance_criteria: [
          'Documentation is clear and comprehensive',
          'Examples are working and up-to-date',
          'Formatting is consistent with project standards',
          'Links and references are valid'
        ],
        estimated_duration: 45,
        dependencies: [],
        tags: ['documentation'],
        files_to_modify: ['README.md', 'docs/'],
        enabled: true
      }
    };

    return templates[type] || templates.feature;
  }

  async saveTasks (tasks = null, filePath = null) {
    const tasksToSave = tasks || this.tasks;
    const outputPath = filePath || path.resolve(this.options.workingDir, this.options.tasksPath);

    const tasksData = {
      version: '1.0',
      created_at: new Date().toISOString(),
      tasks: tasksToSave
    };

    try {
      if (outputPath.endsWith('.json')) {
        await fs.writeJson(outputPath, tasksData, { spaces: 2 });
      } else {
        // Default to YAML
        const yamlContent = YAML.stringify(tasksData, { indent: 2 });
        await fs.writeFile(outputPath, yamlContent, 'utf8');
      }

      this.options.logger.info('Tasks saved successfully', {
        filePath: outputPath,
        taskCount: tasksToSave.length
      });
    } catch (error) {
      this.options.logger.error('Failed to save tasks', { error: error.message });
      throw new Error(`Failed to save tasks to ${outputPath}: ${error.message}`);
    }
  }

  getTaskById (taskId) {
    return this.tasks.find(task => task.id === taskId);
  }

  getTasksByType (type) {
    return this.tasks.filter(task => task.type === type);
  }

  getTasksByPriority (priority) {
    return this.tasks.filter(task => task.priority === priority);
  }

  getTasksByTag (tag) {
    return this.tasks.filter(task => (task.tags || []).includes(tag));
  }

  async generateTaskSummary () {
    const summary = {
      total: this.tasks.length,
      enabled: this.tasks.filter(t => t.enabled).length,
      byType: {},
      byPriority: {},
      totalEstimatedTime: 0,
      averageEstimatedTime: 0
    };

    // Count by type and priority
    for (const task of this.tasks) {
      // By type
      summary.byType[task.type] = (summary.byType[task.type] || 0) + 1;

      // By priority
      summary.byPriority[task.priority] = (summary.byPriority[task.priority] || 0) + 1;

      // Time estimation
      summary.totalEstimatedTime += task.estimated_duration || 60;
    }

    summary.averageEstimatedTime = summary.total > 0
      ? Math.round(summary.totalEstimatedTime / summary.total)
      : 0;

    return summary;
  }
}

module.exports = { TaskManager };
