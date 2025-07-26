// Jest globals are automatically available
const { TaskManager } = require('../src/task-manager');
const fs = require('fs-extra');
const YAML = require('yaml');

jest.mock('fs-extra');
jest.mock('yaml');

describe('TaskManager', () => {
  let taskManager;
  let mockLogger;

  beforeEach(() => {
    jest.clearAllMocks();

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    };

    taskManager = new TaskManager({
      tasksPath: 'test-tasks.yaml',
      workingDir: '/test/dir',
      logger: mockLogger
    });
  });

  describe('Task Loading', () => {
    const mockTasksData = {
      tasks: [
        {
          id: 'task1',
          type: 'feature',
          priority: 5,
          title: 'Test Task 1',
          requirements: 'Test requirements',
          acceptance_criteria: ['Criteria 1', 'Criteria 2'],
          estimated_duration: 60,
          dependencies: [],
          tags: ['test'],
          files_to_modify: ['src/'],
          enabled: true
        },
        {
          id: 'task2',
          type: 'bugfix',
          priority: 8,
          title: 'Test Task 2',
          requirements: 'Fix bug',
          estimated_duration: 30,
          dependencies: ['task1'],
          enabled: true
        }
      ]
    };

    beforeEach(() => {
      fs.pathExists.mockResolvedValue(true);
      fs.readFile.mockResolvedValue('yaml content');
      YAML.parse.mockResolvedValue(mockTasksData);
    });

    it('should load tasks from YAML file successfully', async () => {
      const tasks = await taskManager.loadTasks();

      expect(fs.pathExists).toHaveBeenCalledWith('/test/dir/test-tasks.yaml');
      expect(fs.readFile).toHaveBeenCalledWith('/test/dir/test-tasks.yaml', 'utf8');
      expect(YAML.parse).toHaveBeenCalledWith('yaml content');
      expect(tasks).toHaveLength(2);
      expect(tasks[0].id).toBe('task1');
      expect(tasks[1].id).toBe('task2');
    });

    it('should load tasks from JSON file', async () => {
      taskManager.options.tasksPath = 'test-tasks.json';
      fs.readFile.mockResolvedValue('{"tasks": []}');
      JSON.parse = jest.fn().mockReturnValue({ tasks: [] });

      await taskManager.loadTasks();

      expect(fs.pathExists).toHaveBeenCalledWith('/test/dir/test-tasks.json');
    });

    it('should throw error if tasks file does not exist', async () => {
      fs.pathExists.mockResolvedValue(false);

      await expect(taskManager.loadTasks()).rejects.toThrow('Tasks file not found');
    });

    it('should throw error for invalid tasks structure', async () => {
      YAML.parse.mockReturnValue({ invalid: 'structure' });

      await expect(taskManager.loadTasks()).rejects.toThrow('Invalid tasks file format');
    });

    it('should filter out disabled tasks', async () => {
      const tasksWithDisabled = {
        tasks: [
          { ...mockTasksData.tasks[0], enabled: false },
          mockTasksData.tasks[1]
        ]
      };
      YAML.parse.mockReturnValue(tasksWithDisabled);

      const tasks = await taskManager.loadTasks();

      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe('task2');
    });
  });

  describe('Task Validation', () => {
    it('should validate task with all required fields', async () => {
      const validTask = {
        id: 'valid-task',
        type: 'feature',
        priority: 5,
        title: 'Valid Task',
        requirements: 'Test requirements',
        estimated_duration: 60
      };

      const result = await taskManager.validateTask(validTask);

      expect(result.id).toBe('valid-task');
      expect(result.enabled).toBe(true); // default value
      expect(result.dependencies).toEqual([]); // default value
    });

    it('should reject task with missing required fields', async () => {
      const invalidTask = {
        type: 'feature',
        title: 'Missing ID'
      };

      await expect(taskManager.validateTask(invalidTask)).rejects.toThrow('Task validation failed');
    });

    it('should reject task with invalid type', async () => {
      const invalidTask = {
        id: 'invalid-type',
        type: 'invalid',
        title: 'Invalid Type',
        requirements: 'Test'
      };

      await expect(taskManager.validateTask(invalidTask)).rejects.toThrow();
    });

    it('should reject task with invalid ID pattern', async () => {
      const invalidTask = {
        id: 'invalid id with spaces',
        type: 'feature',
        title: 'Invalid ID',
        requirements: 'Test'
      };

      await expect(taskManager.validateTask(invalidTask)).rejects.toThrow();
    });

    it('should validate file patterns', () => {
      expect(taskManager.isValidFilePattern('src/')).toBe(true);
      expect(taskManager.isValidFilePattern('**/*.js')).toBe(true);
      expect(taskManager.isValidFilePattern('../../../etc/passwd')).toBe(false);
      expect(taskManager.isValidFilePattern('/absolute/path')).toBe(false);
      expect(taskManager.isValidFilePattern('~/home')).toBe(false);
    });
  });

  describe('Dependency Resolution', () => {
    it('should resolve simple dependencies correctly', async () => {
      const tasks = [
        { id: 'task1', dependencies: [] },
        { id: 'task2', dependencies: ['task1'] },
        { id: 'task3', dependencies: ['task2'] }
      ];

      const ordered = await taskManager.resolveDependencies(tasks);

      expect(ordered.map(t => t.id)).toEqual(['task1', 'task2', 'task3']);
    });

    it('should handle complex dependency graphs', async () => {
      const tasks = [
        { id: 'task1', dependencies: ['task2', 'task3'] },
        { id: 'task2', dependencies: [] },
        { id: 'task3', dependencies: ['task4'] },
        { id: 'task4', dependencies: [] }
      ];

      const ordered = await taskManager.resolveDependencies(tasks);
      const orderMap = ordered.reduce((map, task, index) => {
        map[task.id] = index;
        return map;
      }, {});

      // task2 and task4 should come before their dependents
      expect(orderMap.task2).toBeLessThan(orderMap.task1);
      expect(orderMap.task4).toBeLessThan(orderMap.task3);
      expect(orderMap.task3).toBeLessThan(orderMap.task1);
    });

    it('should detect circular dependencies', async () => {
      const tasks = [
        { id: 'task1', dependencies: ['task2'] },
        { id: 'task2', dependencies: ['task3'] },
        { id: 'task3', dependencies: ['task1'] }
      ];

      await expect(taskManager.resolveDependencies(tasks)).rejects.toThrow('Circular dependency detected');
    });

    it('should throw error for missing dependencies', async () => {
      const tasks = [
        { id: 'task1', dependencies: ['non-existent'] }
      ];

      await expect(taskManager.resolveDependencies(tasks)).rejects.toThrow('depends on non-existent task');
    });
  });

  describe('Priority Ordering', () => {
    it('should order tasks by priority within dependency levels', async () => {
      const tasks = [
        { id: 'low', priority: 1, dependencies: [] },
        { id: 'high', priority: 10, dependencies: [] },
        { id: 'medium', priority: 5, dependencies: [] }
      ];

      const ordered = await taskManager.resolveDependencies(tasks);

      expect(ordered.map(t => t.id)).toEqual(['high', 'medium', 'low']);
    });

    it('should order by type when priority is equal', async () => {
      const tasks = [
        { id: 'docs', type: 'docs', priority: 5, dependencies: [] },
        { id: 'bugfix', type: 'bugfix', priority: 5, dependencies: [] },
        { id: 'feature', type: 'feature', priority: 5, dependencies: [] }
      ];

      const ordered = await taskManager.resolveDependencies(tasks);

      // bugfix should come first, then feature, then docs
      expect(ordered.map(t => t.id)).toEqual(['bugfix', 'feature', 'docs']);
    });
  });

  describe('Task Filtering', () => {
    const sampleTasks = [
      { id: 'task1', type: 'feature', priority: 5, tags: ['frontend'], estimated_duration: 60 },
      { id: 'task2', type: 'bugfix', priority: 8, tags: ['backend'], estimated_duration: 30 },
      { id: 'task3', type: 'test', priority: 3, tags: ['frontend', 'testing'], estimated_duration: 120 }
    ];

    beforeEach(() => {
      taskManager.tasks = sampleTasks;
    });

    it('should filter by type', async () => {
      const filtered = await taskManager.filterTasks({ type: 'feature' });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('task1');
    });

    it('should filter by multiple types', async () => {
      const filtered = await taskManager.filterTasks({ type: ['feature', 'bugfix'] });

      expect(filtered).toHaveLength(2);
      expect(filtered.map(t => t.id)).toEqual(['task1', 'task2']);
    });

    it('should filter by priority range', async () => {
      const filtered = await taskManager.filterTasks({ minPriority: 5 });

      expect(filtered).toHaveLength(2);
      expect(filtered.map(t => t.id)).toEqual(['task1', 'task2']);
    });

    it('should filter by tags', async () => {
      const filtered = await taskManager.filterTasks({ tags: 'frontend' });

      expect(filtered).toHaveLength(2);
      expect(filtered.map(t => t.id)).toEqual(['task1', 'task3']);
    });

    it('should filter by estimated duration', async () => {
      const filtered = await taskManager.filterTasks({ maxDuration: 60 });

      expect(filtered).toHaveLength(2);
      expect(filtered.map(t => t.id)).toEqual(['task1', 'task2']);
    });

    it('should combine multiple filters', async () => {
      const filtered = await taskManager.filterTasks({
        type: ['feature', 'test'],
        tags: 'frontend',
        maxDuration: 80
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('task1');
    });
  });

  describe('Duration Estimation', () => {
    const sampleTasks = [
      { estimated_duration: 60 },
      { estimated_duration: 90 },
      { estimated_duration: 30 }
    ];

    beforeEach(() => {
      taskManager.tasks = sampleTasks;
    });

    it('should calculate total estimated duration', async () => {
      const estimation = await taskManager.estimateSessionDuration();

      expect(estimation.totalMinutes).toBe(195); // 180 + 15 overhead (5 min per task)
      expect(estimation.totalHours).toBe(3.25);
      expect(estimation.taskCount).toBe(3);
      expect(estimation.overhead).toBe(15);
    });

    it('should handle tasks without estimated duration', async () => {
      const tasksWithoutDuration = [
        { estimated_duration: 60 },
        {}, // no duration specified
        { estimated_duration: 30 }
      ];

      taskManager.tasks = tasksWithoutDuration;
      const estimation = await taskManager.estimateSessionDuration();

      expect(estimation.totalMinutes).toBe(165); // 60 + 60(default) + 30 + 15 overhead
    });
  });

  describe('Task Templates', () => {
    it('should create feature task template', async () => {
      const template = await taskManager.createTaskTemplate('feature');

      expect(template.type).toBe('feature');
      expect(template.id).toBe('new-feature-id');
      expect(template.priority).toBe(5);
      expect(template.acceptance_criteria).toBeInstanceOf(Array);
      expect(template.estimated_duration).toBe(120);
    });

    it('should create bugfix task template', async () => {
      const template = await taskManager.createTaskTemplate('bugfix');

      expect(template.type).toBe('bugfix');
      expect(template.priority).toBe(8);
      expect(template.estimated_duration).toBe(60);
    });

    it('should create test task template', async () => {
      const template = await taskManager.createTaskTemplate('test');

      expect(template.type).toBe('test');
      expect(template.files_to_modify).toContain('test/');
    });

    it('should fallback to feature template for unknown type', async () => {
      const template = await taskManager.createTaskTemplate('unknown');

      expect(template.type).toBe('feature');
    });
  });

  describe('Task Utilities', () => {
    const sampleTasks = [
      { id: 'task1', type: 'feature', priority: 5, tags: ['frontend'] },
      { id: 'task2', type: 'bugfix', priority: 8, tags: ['backend'] },
      { id: 'task3', type: 'feature', priority: 3, tags: ['frontend', 'api'] }
    ];

    beforeEach(() => {
      taskManager.tasks = sampleTasks;
    });

    it('should find task by ID', () => {
      const task = taskManager.getTaskById('task2');

      expect(task.id).toBe('task2');
      expect(task.type).toBe('bugfix');
    });

    it('should return undefined for non-existent task ID', () => {
      const task = taskManager.getTaskById('non-existent');

      expect(task).toBeUndefined();
    });

    it('should get tasks by type', () => {
      const features = taskManager.getTasksByType('feature');

      expect(features).toHaveLength(2);
      expect(features.map(t => t.id)).toEqual(['task1', 'task3']);
    });

    it('should get tasks by priority', () => {
      const highPriority = taskManager.getTasksByPriority(8);

      expect(highPriority).toHaveLength(1);
      expect(highPriority[0].id).toBe('task2');
    });

    it('should get tasks by tag', () => {
      const frontendTasks = taskManager.getTasksByTag('frontend');

      expect(frontendTasks).toHaveLength(2);
      expect(frontendTasks.map(t => t.id)).toEqual(['task1', 'task3']);
    });
  });

  describe('Task Summary', () => {
    const sampleTasks = [
      { id: 'task1', type: 'feature', priority: 5, enabled: true, estimated_duration: 60 },
      { id: 'task2', type: 'bugfix', priority: 8, enabled: true, estimated_duration: 30 },
      { id: 'task3', type: 'feature', priority: 3, enabled: false, estimated_duration: 90 }
    ];

    beforeEach(() => {
      taskManager.tasks = sampleTasks;
    });

    it('should generate comprehensive task summary', async () => {
      const summary = await taskManager.generateTaskSummary();

      expect(summary.total).toBe(3);
      expect(summary.enabled).toBe(2);
      expect(summary.byType.feature).toBe(2);
      expect(summary.byType.bugfix).toBe(1);
      expect(summary.byPriority[5]).toBe(1);
      expect(summary.byPriority[8]).toBe(1);
      expect(summary.byPriority[3]).toBe(1);
      expect(summary.totalEstimatedTime).toBe(180);
      expect(summary.averageEstimatedTime).toBe(60);
    });
  });

  describe('Task Saving', () => {
    it('should save tasks to YAML file', async () => {
      const tasks = [{ id: 'task1', title: 'Test Task' }];
      fs.writeFile.mockResolvedValue();
      YAML.stringify.mockReturnValue('yaml content');

      await taskManager.saveTasks(tasks, '/test/path/tasks.yaml');

      expect(YAML.stringify).toHaveBeenCalled();
      expect(fs.writeFile).toHaveBeenCalledWith('/test/path/tasks.yaml', 'yaml content', 'utf8');
    });

    it('should save tasks to JSON file', async () => {
      const tasks = [{ id: 'task1', title: 'Test Task' }];
      fs.writeJson.mockResolvedValue();

      await taskManager.saveTasks(tasks, '/test/path/tasks.json');

      expect(fs.writeJson).toHaveBeenCalledWith('/test/path/tasks.json', expect.any(Object), { spaces: 2 });
    });
  });
});
