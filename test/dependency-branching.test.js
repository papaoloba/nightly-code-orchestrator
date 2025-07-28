const { GitManager } = require('../src/integrations/git-manager');
const { TaskManager } = require('../src/core/task-manager');
const fs = require('fs-extra');
const path = require('path');
const simpleGit = require('simple-git');

describe('Dependency-Aware Branching', () => {
  let gitManager;
  let taskManager;
  let testDir;
  let git;

  beforeEach(async () => {
    // Create a temporary test directory
    testDir = path.join(__dirname, '.tmp-test-repo');
    await fs.ensureDir(testDir);

    // Initialize git repo
    git = simpleGit(testDir);
    await git.init();
    await git.addConfig('user.name', 'Test User');
    await git.addConfig('user.email', 'test@example.com');

    // Create initial commit
    const testFile = path.join(testDir, 'test.txt');
    await fs.writeFile(testFile, 'initial content');
    await git.add('.');
    await git.commit('Initial commit');

    // Initialize managers
    gitManager = new GitManager({
      workingDir: testDir,
      logger: {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn()
      },
      dependencyAwareBranching: true,
      strictDependencyChecking: false
    });

    taskManager = new TaskManager({
      workingDir: testDir,
      logger: {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn()
      }
    });

    await gitManager.ensureRepository();
  });

  afterEach(async () => {
    // Clean up test directory
    await fs.remove(testDir);
  });

  describe('createTaskBranch with dependencies', () => {
    it('should create branch from main when task has no dependencies', async () => {
      const task = {
        id: 'task-1',
        title: 'First Task',
        type: 'feature',
        dependencies: []
      };

      const branchName = await gitManager.createTaskBranch(task);

      expect(branchName).toMatch(/nightly\/feature-task-1/);

      const branches = await git.branchLocal();
      expect(branches.all).toContain(branchName);

      // Check that branch was created from main
      await git.checkout(branchName);
      const log = await git.log();
      expect(log.latest.message).toBe('Initial commit');
    });

    it('should create branch from dependency branch when available', async () => {
      // Create first task branch
      const task1 = {
        id: 'setup-db',
        title: 'Setup Database',
        type: 'feature',
        dependencies: []
      };

      await gitManager.createTaskBranch(task1);

      // Make a commit on task1 branch
      const file1 = path.join(testDir, 'db-setup.txt');
      await fs.writeFile(file1, 'database setup');
      await git.add('.');
      await git.commit('Setup database');

      // Create second task that depends on first
      const task2 = {
        id: 'create-api',
        title: 'Create API',
        type: 'feature',
        dependencies: ['setup-db']
      };

      const branch2 = await gitManager.createTaskBranch(task2);

      expect(branch2).toMatch(/nightly\/feature-create-api/);

      // Verify branch2 includes commits from branch1
      await git.checkout(branch2);
      const log = await git.log();
      const messages = log.all.map(commit => commit.message);

      expect(messages).toContain('Setup database');
      expect(messages).toContain('Initial commit');
    });

    it('should handle multiple dependencies and use the last one', async () => {
      // Create multiple dependency tasks
      const task1 = {
        id: 'task-a',
        title: 'Task A',
        type: 'feature',
        dependencies: []
      };

      const task2 = {
        id: 'task-b',
        title: 'Task B',
        type: 'feature',
        dependencies: []
      };

      const branch1 = await gitManager.createTaskBranch(task1);
      await git.checkout(branch1);
      const fileA = path.join(testDir, 'file-a.txt');
      await fs.writeFile(fileA, 'content A');
      await git.add('.');
      await git.commit('Task A changes');

      await git.checkout('main');
      const branch2 = await gitManager.createTaskBranch(task2);
      await git.checkout(branch2);
      const fileB = path.join(testDir, 'file-b.txt');
      await fs.writeFile(fileB, 'content B');
      await git.add('.');
      await git.commit('Task B changes');

      // Create task that depends on both
      const task3 = {
        id: 'task-c',
        title: 'Task C',
        type: 'feature',
        dependencies: ['task-a', 'task-b']
      };

      const branch3 = await gitManager.createTaskBranch(task3);

      // Should branch from task-b (last dependency)
      await git.checkout(branch3);
      const log = await git.log();
      const messages = log.all.map(commit => commit.message);

      expect(messages).toContain('Task B changes');
      expect(messages).not.toContain('Task A changes'); // Since we branched from B, not A
    });

    it('should fall back to main when dependency branch is missing', async () => {
      const task = {
        id: 'task-2',
        title: 'Second Task',
        type: 'feature',
        dependencies: ['non-existent-task']
      };

      const branchName = await gitManager.createTaskBranch(task);

      expect(branchName).toMatch(/nightly\/feature-task-2/);

      // Should warn about missing dependency
      expect(gitManager.options.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No dependency branches found')
      );
    });

    it('should use completedTasksMap when provided', async () => {
      // Simulate completed tasks from orchestrator
      const completedTasksMap = new Map();
      completedTasksMap.set('setup-db', {
        taskId: 'setup-db',
        branchName: 'nightly-feature-setup-db-setup-database',
        completedAt: Date.now()
      });

      // Create the branch that's referenced in the map
      await git.checkoutLocalBranch('nightly-feature-setup-db-setup-database');
      const file1 = path.join(testDir, 'db-setup.txt');
      await fs.writeFile(file1, 'database setup from completed task');
      await git.add('.');
      await git.commit('Setup database from completed task');

      const task = {
        id: 'create-api',
        title: 'Create API',
        type: 'feature',
        dependencies: ['setup-db']
      };

      const branchName = await gitManager.createTaskBranch(task, completedTasksMap);

      // Verify it used the completed task branch
      await git.checkout(branchName);
      const log = await git.log();
      const messages = log.all.map(commit => commit.message);

      expect(messages).toContain('Setup database from completed task');
    });
  });

  describe('dependency validation', () => {
    it('should throw error when strict checking is enabled and dependency is missing', async () => {
      gitManager.options.strictDependencyChecking = true;

      const task = {
        id: 'task-2',
        title: 'Second Task',
        type: 'feature',
        dependencies: ['missing-task']
      };

      await expect(gitManager.createTaskBranch(task))
        .rejects
        .toThrow('Task task-2 has unresolved dependencies: missing-task');
    });

    it('should not throw error when strict checking is disabled', async () => {
      gitManager.options.strictDependencyChecking = false;

      const task = {
        id: 'task-2',
        title: 'Second Task',
        type: 'feature',
        dependencies: ['missing-task']
      };

      const branchName = await gitManager.createTaskBranch(task);
      expect(branchName).toBeTruthy();
    });
  });

  describe('configuration options', () => {
    it('should use main branch when dependency branching is disabled', async () => {
      gitManager.options.dependencyAwareBranching = false;

      // Create first task
      const task1 = {
        id: 'task-1',
        title: 'First Task',
        type: 'feature',
        dependencies: []
      };

      await gitManager.createTaskBranch(task1);

      // Create dependent task
      const task2 = {
        id: 'task-2',
        title: 'Second Task',
        type: 'feature',
        dependencies: ['task-1']
      };

      const branch2 = await gitManager.createTaskBranch(task2);

      // Should log that dependency branching is disabled
      expect(gitManager.options.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Dependency-aware branching disabled')
      );

      // Branch should be created from main
      const status = await git.status();
      expect(status.current).toBe(branch2);
    });
  });

  describe('Task dependency resolution', () => {
    it('should resolve task dependencies correctly', async () => {
      const tasks = [
        {
          id: 'setup',
          type: 'feature',
          title: 'Setup',
          priority: 5,
          requirements: 'Setup project',
          dependencies: [],
          enabled: true
        },
        {
          id: 'api',
          type: 'feature',
          title: 'Create API',
          priority: 5,
          requirements: 'Create API endpoints',
          dependencies: ['setup'],
          enabled: true
        },
        {
          id: 'ui',
          type: 'feature',
          title: 'Create UI',
          priority: 5,
          requirements: 'Create user interface',
          dependencies: ['api'],
          enabled: true
        },
        {
          id: 'tests',
          type: 'test',
          title: 'Add Tests',
          priority: 8,
          requirements: 'Add test coverage',
          dependencies: ['api', 'ui'],
          enabled: true
        }
      ];

      // Manually set tasks for testing
      taskManager.tasks = tasks;

      const orderedTasks = await taskManager.resolveDependencies(tasks);

      // Check order is correct
      const taskIds = orderedTasks.map(t => t.id);
      expect(taskIds.indexOf('setup')).toBeLessThan(taskIds.indexOf('api'));
      expect(taskIds.indexOf('api')).toBeLessThan(taskIds.indexOf('ui'));
      expect(taskIds.indexOf('api')).toBeLessThan(taskIds.indexOf('tests'));
      expect(taskIds.indexOf('ui')).toBeLessThan(taskIds.indexOf('tests'));
    });

    it('should detect circular dependencies', async () => {
      const tasks = [
        {
          id: 'task-a',
          type: 'feature',
          title: 'Task A',
          priority: 5,
          requirements: 'Task A',
          dependencies: ['task-b'],
          enabled: true
        },
        {
          id: 'task-b',
          type: 'feature',
          title: 'Task B',
          priority: 5,
          requirements: 'Task B',
          dependencies: ['task-c'],
          enabled: true
        },
        {
          id: 'task-c',
          type: 'feature',
          title: 'Task C',
          priority: 5,
          requirements: 'Task C',
          dependencies: ['task-a'],
          enabled: true
        }
      ];

      taskManager.tasks = tasks;

      await expect(taskManager.resolveDependencies(tasks))
        .rejects
        .toThrow('Circular dependency detected');
    });
  });
});
