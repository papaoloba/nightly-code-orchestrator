// Mock dependencies before requiring modules
jest.mock('simple-git');
jest.mock('fs-extra');
jest.mock('cross-spawn');

const { GitManager } = require('../src/integrations/git-manager');
const simpleGit = require('simple-git');
const fs = require('fs-extra');
const path = require('path');

// Create a mock for simple-git instance
const mockGitInstance = {
  checkIsRepo: jest.fn(),
  status: jest.fn(),
  checkout: jest.fn(),
  checkoutLocalBranch: jest.fn(),
  add: jest.fn(),
  commit: jest.fn(),
  push: jest.fn(),
  pull: jest.fn(),
  getRemotes: jest.fn(),
  branchLocal: jest.fn(),
  deleteLocalBranch: jest.fn()
};

describe('GitManager', () => {
  let gitManager;
  let mockLogger;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Mock simpleGit to return our mock instance
    simpleGit.mockReturnValue(mockGitInstance);

    // Configure mock git instance
    mockGitInstance.checkIsRepo.mockResolvedValue(true);
    mockGitInstance.status.mockResolvedValue({
      current: 'main',
      files: []
    });
    mockGitInstance.checkout.mockResolvedValue();
    mockGitInstance.checkoutLocalBranch.mockResolvedValue();
    mockGitInstance.add.mockResolvedValue();
    mockGitInstance.commit.mockResolvedValue({ commit: 'abc123' });
    mockGitInstance.push.mockResolvedValue();
    mockGitInstance.pull.mockResolvedValue();
    mockGitInstance.getRemotes.mockResolvedValue([{ name: 'origin' }]);
    mockGitInstance.branchLocal.mockResolvedValue({ all: [] });
    mockGitInstance.deleteLocalBranch.mockResolvedValue();

    // Mock fs.pathExists for working directory
    fs.pathExists = jest.fn().mockResolvedValue(true);

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };

    gitManager = new GitManager({
      workingDir: '/test/repo',
      logger: mockLogger,
      prStrategy: 'task', // Default to task-based PRs
      branchPrefix: 'nightly/'
    });

    // Set originalBranch since it would be set by ensureRepository
    gitManager.originalBranch = 'main';
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Task Branch Management', () => {
    test('should create task branch when using task PR strategy', async () => {
      const task = {
        id: 'task-001',
        title: 'Implement feature',
        type: 'feature',
        dependencies: []
      };

      const branchName = await gitManager.createTaskBranch(task);

      expect(branchName).toMatch(/^nightly\/feature-task-001-implement-feature$/);
      expect(mockGitInstance.checkout).toHaveBeenCalledWith('main');
      expect(mockGitInstance.checkoutLocalBranch).toHaveBeenCalledWith(branchName);
      expect(gitManager.taskBranches.has(task.id)).toBe(true);
    });

    test('should use session branch when using session PR strategy', async () => {
      gitManager.options.prStrategy = 'session';
      gitManager.sessionBranch = {
        branchName: 'nightly/session-2024-01-01-120000',
        sessionId: 'session-2024-01-01-120000'
      };

      const task = {
        id: 'task-001',
        title: 'Implement feature',
        type: 'feature'
      };

      const branchName = await gitManager.createTaskBranch(task);

      expect(branchName).toBe('nightly/session-2024-01-01-120000');
      expect(mockGitInstance.checkoutLocalBranch).not.toHaveBeenCalled();
    });

    test('should branch from dependency when task has dependencies', async () => {
      const dependencyTask = {
        id: 'task-001',
        title: 'Base feature',
        type: 'feature',
        dependencies: []
      };

      const dependentTask = {
        id: 'task-002',
        title: 'Extended feature',
        type: 'feature',
        dependencies: ['task-001']
      };

      // Create first task branch
      const depBranchName = await gitManager.createTaskBranch(dependencyTask);

      // Mock that the dependency branch exists
      mockGitInstance.branchLocal.mockResolvedValue({
        all: ['main', depBranchName]
      });

      // Create dependent task branch
      const taskBranchName = await gitManager.createTaskBranch(dependentTask);

      expect(mockGitInstance.checkout).toHaveBeenLastCalledWith(depBranchName);
      expect(taskBranchName).toMatch(/^nightly\/feature-task-002-extended-feature$/);
    });

    test('should throw error when dependency task not found', async () => {
      // Enable strict dependency checking for this test
      gitManager.options.strictDependencyChecking = true;

      const dependentTask = {
        id: 'task-002',
        title: 'Extended feature',
        type: 'feature',
        dependencies: ['task-001'] // This dependency was not completed
      };

      await expect(gitManager.createTaskBranch(dependentTask))
        .rejects
        .toThrow('Task task-002 has unresolved dependencies: task-001');
    });

    test('should throw error when originalBranch is not set', async () => {
      gitManager.originalBranch = null;

      const task = {
        id: 'task-001',
        title: 'Test task',
        type: 'feature',
        dependencies: []
      };

      await expect(gitManager.createTaskBranch(task))
        .rejects
        .toThrow('Git repository not initialized');
    });
  });

  describe('Task PR Creation', () => {
    beforeEach(() => {
      gitManager.executeCommand = jest.fn().mockResolvedValue({
        code: 0,
        stdout: 'https://github.com/test/repo/pull/123'
      });
      gitManager.checkGitHubCLI = jest.fn().mockResolvedValue(true);

      // Mock clean status for PR creation (no uncommitted changes)
      mockGitInstance.status.mockResolvedValue({
        current: 'main',
        files: [],
        modified: [],
        created: [],
        deleted: [],
        renamed: [],
        staged: [],
        not_added: []
      });
    });

    test('should create task PR with correct base branch', async () => {
      const task = {
        id: 'task-001',
        title: 'Implement feature',
        type: 'feature',
        dependencies: [],
        requirements: 'Implement a new feature',
        acceptance_criteria: ['Works correctly', 'Has tests']
      };

      const result = {
        filesChanged: ['src/feature.js', 'test/feature.test.js'],
        duration: 60000
      };

      gitManager.taskBranches.set(task.id, {
        branchName: 'nightly/feature-task-001-implement-feature',
        baseBranch: 'main',
        taskId: task.id
      });

      const prUrl = await gitManager.createTaskPR(task, result);

      expect(prUrl).toBe('https://github.com/test/repo/pull/123');
      expect(gitManager.executeCommand).toHaveBeenCalledWith('gh', [
        'pr', 'create',
        '--title', '[Task task-001] Implement feature',
        '--body', expect.stringContaining('## Task Details'),
        '--base', 'main',
        '--head', 'nightly/feature-task-001-implement-feature'
      ]);
    });

    test('should include dependency information in PR body', async () => {
      const task = {
        id: 'task-002',
        title: 'Extended feature',
        type: 'feature',
        dependencies: ['task-001']
      };

      const result = {
        filesChanged: ['src/extended.js'],
        duration: 30000
      };

      gitManager.taskBranches.set(task.id, {
        branchName: 'nightly/feature-task-002-extended-feature',
        baseBranch: 'nightly/feature-task-001-base-feature',
        taskId: task.id
      });

      gitManager.completedTasks.set('task-001', {
        task: { id: 'task-001', title: 'Base feature' },
        branch: 'nightly/feature-task-001-base-feature',
        prUrl: 'https://github.com/test/repo/pull/122'
      });

      await gitManager.createTaskPR(task, result);

      expect(gitManager.executeCommand).toHaveBeenCalledWith('gh', [
        'pr', 'create',
        '--title', expect.any(String),
        '--body', expect.stringContaining('Depends on: https://github.com/test/repo/pull/122'),
        '--base', 'nightly/feature-task-001-base-feature',
        '--head', 'nightly/feature-task-002-extended-feature'
      ]);
    });
  });

  describe('Branch Cleanup', () => {
    test('should clean up task branches when using task PR strategy', async () => {
      gitManager.options.prStrategy = 'task';

      gitManager.taskBranches.set('task-001', {
        branchName: 'nightly/feature-task-001-test',
        baseBranch: 'main'
      });
      gitManager.taskBranches.set('task-002', {
        branchName: 'nightly/feature-task-002-test',
        baseBranch: 'main'
      });

      mockGitInstance.branchLocal.mockResolvedValue({
        all: ['main', 'nightly/feature-task-001-test', 'nightly/feature-task-002-test']
      });

      await gitManager.cleanupSessionBranches();

      expect(mockGitInstance.deleteLocalBranch).toHaveBeenCalledTimes(2);
      expect(mockGitInstance.deleteLocalBranch).toHaveBeenCalledWith('nightly/feature-task-001-test', true);
      expect(mockGitInstance.deleteLocalBranch).toHaveBeenCalledWith('nightly/feature-task-002-test', true);
      expect(gitManager.taskBranches.size).toBe(0);
    });

    test('should clean up session branch when using session PR strategy', async () => {
      gitManager.options.prStrategy = 'session';
      gitManager.sessionBranch = {
        branchName: 'nightly/session-2024-01-01-120000',
        sessionId: 'session-2024-01-01-120000'
      };

      mockGitInstance.branchLocal.mockResolvedValue({
        all: ['main', 'nightly/session-2024-01-01-120000']
      });

      await gitManager.cleanupSessionBranches();

      expect(mockGitInstance.deleteLocalBranch).toHaveBeenCalledWith('nightly/session-2024-01-01-120000', true);
      expect(gitManager.sessionBranch).toBeNull();
    });
  });

  describe('PR Strategy Configuration', () => {
    test('should default to task-based PR strategy', () => {
      const gm = new GitManager({ logger: mockLogger, branchPrefix: 'nightly/' });
      expect(gm.options.prStrategy).toBe('task');
    });

    test('should accept session PR strategy', () => {
      const gm = new GitManager({
        logger: mockLogger,
        prStrategy: 'session',
        branchPrefix: 'nightly/'
      });
      expect(gm.options.prStrategy).toBe('session');
    });
  });
});
