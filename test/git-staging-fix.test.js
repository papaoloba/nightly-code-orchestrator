// Test to verify Git staging fixes
jest.mock('simple-git');
jest.mock('fs-extra');

const { GitManager } = require('../src/git-manager');
const simpleGit = require('simple-git');

describe('Git Staging Fix Tests', () => {
  let gitManager;
  let mockGitInstance;
  let mockLogger;

  beforeEach(() => {
    // Create a mock for simple-git instance
    mockGitInstance = {
      checkIsRepo: jest.fn().mockResolvedValue(true),
      status: jest.fn(),
      checkout: jest.fn().mockResolvedValue(),
      checkoutLocalBranch: jest.fn().mockResolvedValue(),
      add: jest.fn().mockResolvedValue(),
      commit: jest.fn().mockResolvedValue({ commit: 'abc123' }),
      push: jest.fn().mockResolvedValue(),
      pull: jest.fn().mockResolvedValue(),
      getRemotes: jest.fn().mockResolvedValue([{ name: 'origin' }]),
      branchLocal: jest.fn().mockResolvedValue({ all: [] }),
      deleteLocalBranch: jest.fn().mockResolvedValue()
    };

    simpleGit.mockReturnValue(mockGitInstance);

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };

    gitManager = new GitManager({
      workingDir: '/test/repo',
      logger: mockLogger
    });

    // Set originalBranch since it would be set by ensureRepository
    gitManager.originalBranch = 'main';
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Enhanced File Change Detection', () => {
    test('should detect all types of file changes including untracked files', async () => {
      mockGitInstance.status.mockResolvedValue({
        current: 'test-branch',
        files: [
          { path: 'modified.js', index: 'M', working_dir: 'M' },
          { path: 'new-file.js', index: '?', working_dir: '?' },
          { path: 'deleted.js', index: 'D', working_dir: 'D' }
        ],
        modified: ['modified.js'],
        created: ['new-file.js'],
        deleted: ['deleted.js'],
        renamed: [{ from: 'old.js', to: 'new.js' }],
        staged: ['staged.js'],
        not_added: ['untracked.js']
      });

      const changedFiles = await gitManager.getChangedFiles();

      expect(changedFiles).toContain('modified.js');
      expect(changedFiles).toContain('new-file.js');
      expect(changedFiles).toContain('deleted.js');
      expect(changedFiles).toContain('new.js');
      expect(changedFiles).toContain('old.js');
      expect(changedFiles).toContain('staged.js');
      expect(changedFiles).toContain('untracked.js');
      expect(changedFiles.length).toBe(7);
    });

    test('should update filesChanged when additional files are detected during commit', async () => {
      const task = {
        id: 'task-001',
        title: 'Test task'
      };

      const result = {
        filesChanged: ['initial.js'],
        duration: 60000
      };

      // Mock status to show additional files
      mockGitInstance.status.mockResolvedValue({
        current: 'test-branch',
        files: [
          { path: 'initial.js', index: 'M', working_dir: 'M' },
          { path: 'additional.js', index: '?', working_dir: '?' }
        ],
        modified: ['initial.js'],
        created: ['additional.js'],
        deleted: [],
        renamed: [],
        staged: [],
        not_added: ['additional.js']
      });

      await gitManager.commitTaskChanges(task, result);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Found 1 additional files changed after task execution')
      );
      expect(result.filesChanged).toContain('initial.js');
      expect(result.filesChanged).toContain('additional.js');
    });
  });

  describe('Pre-PR Commit Safeguards', () => {
    test('should commit uncommitted changes before creating task PR', async () => {
      const task = {
        id: 'task-001',
        title: 'Test task'
      };

      const result = {
        filesChanged: ['test.js'],
        duration: 60000
      };

      gitManager.taskBranches.set(task.id, {
        branchName: 'nightly-task-001',
        baseBranch: 'main'
      });

      gitManager.checkGitHubCLI = jest.fn().mockResolvedValue(true);
      gitManager.executeCommand = jest.fn().mockResolvedValue({
        code: 0,
        stdout: 'https://github.com/test/repo/pull/123'
      });

      // First status check shows uncommitted changes
      mockGitInstance.status
        .mockResolvedValueOnce({
          current: 'nightly-task-001',
          files: [{ path: 'uncommitted.js' }],
          modified: ['uncommitted.js'],
          created: [],
          deleted: [],
          renamed: [],
          staged: [],
          not_added: []
        })
        // Second status check shows clean
        .mockResolvedValueOnce({
          current: 'nightly-task-001',
          files: [],
          modified: [],
          created: [],
          deleted: [],
          renamed: [],
          staged: [],
          not_added: []
        });

      await gitManager.createTaskPR(task, result);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Found 1 uncommitted changes before PR creation')
      );
      expect(mockGitInstance.add).toHaveBeenCalledWith('.');
      expect(mockGitInstance.commit).toHaveBeenCalledWith(
        expect.stringContaining('chore: Add remaining changes for task task-001')
      );
    });
  });

  describe('Double-Check Staging Logic', () => {
    test('should stage unstaged files found during commit process', async () => {
      const task = {
        id: 'task-001',
        title: 'Test task'
      };

      const result = {
        filesChanged: ['file1.js', 'file2.js'],
        duration: 60000
      };

      // First status check shows unstaged files
      mockGitInstance.status
        .mockResolvedValueOnce({
          current: 'test-branch',
          files: [],
          modified: [],
          created: [],
          deleted: [],
          renamed: [],
          staged: [],
          not_added: []
        })
        // Second status shows unstaged files after initial add
        .mockResolvedValueOnce({
          current: 'test-branch',
          files: [{ path: 'late-file.js' }],
          modified: ['late-file.js'],
          created: [],
          deleted: [],
          renamed: [],
          staged: [],
          not_added: []
        });

      await gitManager.commitTaskChanges(task, result);

      // With current implementation, add is called 3 times:
      // 1. First getChangedFiles call (from commitTaskChanges)
      // 2. Initial add for all changes (line 393)
      // 3. Double-check add for unstaged files (line 404)
      expect(mockGitInstance.add.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(mockGitInstance.add).toHaveBeenCalledWith('.');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Found 1 unstaged files, adding them now...')
      );
    });
  });
});