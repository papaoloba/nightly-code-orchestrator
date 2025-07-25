// Jest globals are automatically available
const { Orchestrator } = require('../src/orchestrator');
const { TaskManager } = require('../src/task-manager');
const { GitManager } = require('../src/git-manager');
const { Validator } = require('../src/validator');
const { Reporter } = require('../src/reporter');
const fs = require('fs-extra');
const path = require('path');

// Mock dependencies
jest.mock('../src/task-manager');
jest.mock('../src/git-manager');
jest.mock('../src/validator');
jest.mock('../src/reporter');
jest.mock('fs-extra');

describe('Orchestrator', () => {
  let orchestrator;
  let mockTaskManager;
  let mockGitManager;
  let mockValidator;
  let mockReporter;
  let consoleLogSpy;
  
  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();
    
    // Setup mock implementations
    mockTaskManager = {
      loadTasks: jest.fn(),
      resolveDependencies: jest.fn()
    };
    mockGitManager = {
      ensureRepository: jest.fn(),
      createTaskBranch: jest.fn(),
      commitTask: jest.fn(),
      revertTaskChanges: jest.fn(),
      getChangedFiles: jest.fn(),
      createSessionSummaryCommit: jest.fn()
    };
    mockValidator = {
      validateAll: jest.fn(),
      validateProject: jest.fn()
    };
    mockReporter = {
      generateSessionReport: jest.fn()
    };
    
    // Mock constructors
    TaskManager.mockImplementation(() => mockTaskManager);
    GitManager.mockImplementation(() => mockGitManager);
    Validator.mockImplementation(() => mockValidator);
    Reporter.mockImplementation(() => mockReporter);
    
    // Mock fs operations
    fs.ensureDirSync = jest.fn();
    fs.readFile = jest.fn();
    fs.writeFile = jest.fn();
    fs.pathExists = jest.fn();
    
    // Spy on console.log to suppress output during tests
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    
    orchestrator = new Orchestrator({
      configPath: 'test-config.yaml',
      tasksPath: 'test-tasks.yaml',
      maxDuration: 3600,
      dryRun: true
    });
  });
  
  afterEach(() => {
    consoleLogSpy.mockRestore();
  });
  
  describe('Constructor', () => {
    it('should initialize with default options', () => {
      const defaultOrchestrator = new Orchestrator();
      
      expect(defaultOrchestrator.options.configPath).toBe('nightly-code.yaml');
      expect(defaultOrchestrator.options.tasksPath).toBe('nightly-tasks.yaml');
      expect(defaultOrchestrator.options.maxDuration).toBe(28800);
      expect(defaultOrchestrator.options.dryRun).toBe(false);
    });
    
    it('should initialize with custom options', () => {
      expect(orchestrator.options.configPath).toBe('test-config.yaml');
      expect(orchestrator.options.tasksPath).toBe('test-tasks.yaml');
      expect(orchestrator.options.maxDuration).toBe(3600);
      expect(orchestrator.options.dryRun).toBe(true);
    });
    
    it('should generate unique session IDs', () => {
      const orchestrator1 = new Orchestrator();
      const orchestrator2 = new Orchestrator();
      
      expect(orchestrator1.state.sessionId).not.toBe(orchestrator2.state.sessionId);
      expect(orchestrator1.state.sessionId).toMatch(/^session-\\d{4}-\\d{2}-\\d{2}-\\d{6}$/);
    });
  });
  
  describe('Environment Validation', () => {
    beforeEach(() => {
      // Mock successful validation by default
      mockValidator.validateAll.mockResolvedValue({
        valid: true,
        errors: [],
        warnings: []
      });
      
      mockGitManager.ensureRepository.mockResolvedValue();
      
      // Mock claude version check
      orchestrator.executeCommand = jest.fn().mockResolvedValue({
        stdout: 'claude version 1.0.0',
        stderr: '',
        code: 0
      });
      
      // Mock disk space check
      orchestrator.getAvailableDiskSpace = jest.fn().mockResolvedValue(5000000000); // 5GB
    });
    
    it('should validate environment successfully', async () => {
      await expect(orchestrator.validateEnvironment()).resolves.not.toThrow();
      
      expect(orchestrator.executeCommand).toHaveBeenCalledWith('claude', ['--version'], { timeout: 10000 });
      expect(mockValidator.validateAll).toHaveBeenCalled();
      expect(mockGitManager.ensureRepository).toHaveBeenCalled();
    });
    
    it('should throw error if claude is not available', async () => {
      orchestrator.executeCommand.mockRejectedValue(new Error('Command not found'));
      
      await expect(orchestrator.validateEnvironment()).rejects.toThrow('Claude Code CLI not found');
    });
    
    it('should throw error if configuration validation fails', async () => {
      mockValidator.validateAll.mockResolvedValue({
        valid: false,
        errors: [{ message: 'Invalid configuration' }],
        warnings: []
      });
      
      await expect(orchestrator.validateEnvironment()).rejects.toThrow('Configuration validation failed');
    });
    
    it('should warn about low disk space', async () => {
      orchestrator.getAvailableDiskSpace.mockResolvedValue(500000000); // 500MB
      
      await orchestrator.validateEnvironment();
      
      expect(orchestrator.logger.warn).toHaveBeenCalledWith(
        'Low disk space detected',
        expect.objectContaining({ freeSpaceGB: 0 })
      );
    });
  });
  
  describe('Task Loading and Execution', () => {
    const mockTasks = [
      {
        id: 'task1',
        title: 'Test Task 1',
        type: 'feature',
        estimated_duration: 60,
        requirements: 'Test requirements'
      },
      {
        id: 'task2',
        title: 'Test Task 2',
        type: 'bugfix',
        estimated_duration: 30,
        requirements: 'Fix bug'
      }
    ];
    
    beforeEach(() => {
      mockTaskManager.loadTasks.mockResolvedValue(mockTasks);
      mockTaskManager.resolveDependencies.mockResolvedValue(mockTasks);
    });
    
    it('should load and order tasks correctly', async () => {
      const tasks = await orchestrator.loadTasks();
      
      expect(mockTaskManager.loadTasks).toHaveBeenCalled();
      expect(mockTaskManager.resolveDependencies).toHaveBeenCalledWith(mockTasks);
      expect(tasks).toEqual(mockTasks);
    });
    
    it('should execute tasks in dry run mode', async () => {
      const mockResult = await orchestrator.executeTask(mockTasks[0]);
      
      expect(mockResult.success).toBe(true);
      expect(mockResult.output).toBe('Dry run - task not actually executed');
    });
    
    it('should handle task execution timeout', async () => {
      orchestrator.options.dryRun = false;
      orchestrator.executeClaudeCode = jest.fn().mockRejectedValue(new Error('Timeout'));
      
      const result = await orchestrator.executeTask(mockTasks[0]);
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Timeout');
    });
  });
  
  describe('Git Integration', () => {
    it('should create task branch successfully', async () => {
      const mockTask = { id: 'test-task', title: 'Test Task' };
      const expectedBranchName = 'nightly-2023-01-01-test-task-test-task';
      
      mockGitManager.createTaskBranch.mockResolvedValue(expectedBranchName);
      
      const branchName = await mockGitManager.createTaskBranch(mockTask);
      
      expect(branchName).toBe(expectedBranchName);
      expect(mockGitManager.createTaskBranch).toHaveBeenCalledWith(mockTask);
    });
    
    it('should commit task changes', async () => {
      const mockTask = { id: 'test-task', title: 'Test Task' };
      const mockResult = { filesChanged: ['file1.js', 'file2.js'], duration: 5000 };
      
      await mockGitManager.commitTask(mockTask, mockResult);
      
      expect(mockGitManager.commitTask).toHaveBeenCalledWith(mockTask, mockResult);
    });
    
    it('should revert changes on task failure', async () => {
      const mockTask = { id: 'test-task', title: 'Test Task' };
      
      await mockGitManager.revertTaskChanges(mockTask);
      
      expect(mockGitManager.revertTaskChanges).toHaveBeenCalledWith(mockTask);
    });
  });
  
  describe('Resource Monitoring', () => {
    it('should start resource monitoring', () => {
      orchestrator.startResourceMonitoring();
      
      expect(orchestrator.resourceMonitoringInterval).toBeDefined();
      
      // Clean up
      clearInterval(orchestrator.resourceMonitoringInterval);
    });
    
    it('should create checkpoints at regular intervals', () => {
      orchestrator.startCheckpointTimer();
      
      expect(orchestrator.checkpointInterval).toBeDefined();
      
      // Clean up
      clearInterval(orchestrator.checkpointInterval);
    });
    
    it('should create checkpoint with current state', async () => {
      fs.ensureDir = jest.fn().mockResolvedValue();
      fs.writeJson = jest.fn().mockResolvedValue();
      
      await orchestrator.createCheckpoint();
      
      expect(fs.ensureDir).toHaveBeenCalled();
      expect(fs.writeJson).toHaveBeenCalled();
      expect(orchestrator.state.checkpoints).toHaveLength(1);
    });
  });
  
  describe('Session Execution', () => {
    beforeEach(() => {
      // Mock all dependencies for a complete run
      orchestrator.validateEnvironment = jest.fn().mockResolvedValue();
      orchestrator.loadTasks = jest.fn().mockResolvedValue([
        { id: 'task1', title: 'Task 1', estimated_duration: 30 }
      ]);
      orchestrator.startResourceMonitoring = jest.fn();
      orchestrator.startCheckpointTimer = jest.fn();
      orchestrator.executeTasks = jest.fn().mockResolvedValue({
        completed: 1,
        failed: 0,
        skipped: 0,
        totalTasks: 1
      });
      orchestrator.finalize = jest.fn().mockResolvedValue();
      orchestrator.generateFinalReport = jest.fn().mockReturnValue({
        success: true,
        sessionId: 'test-session',
        completedTasks: 1,
        totalTasks: 1
      });
    });
    
    it('should run complete session successfully', async () => {
      const result = await orchestrator.run();
      
      expect(result.success).toBe(true);
      expect(result.completedTasks).toBe(1);
      expect(result.totalTasks).toBe(1);
      
      expect(orchestrator.validateEnvironment).toHaveBeenCalled();
      expect(orchestrator.loadTasks).toHaveBeenCalled();
      expect(orchestrator.startResourceMonitoring).toHaveBeenCalled();
      expect(orchestrator.startCheckpointTimer).toHaveBeenCalled();
      expect(orchestrator.executeTasks).toHaveBeenCalled();
      expect(orchestrator.finalize).toHaveBeenCalled();
    });
    
    it('should handle session failure gracefully', async () => {
      orchestrator.validateEnvironment.mockRejectedValue(new Error('Validation failed'));
      orchestrator.handleFailure = jest.fn().mockResolvedValue();
      
      await expect(orchestrator.run()).rejects.toThrow('Validation failed');
      expect(orchestrator.handleFailure).toHaveBeenCalled();
    });
  });
  
  describe('Prompt Generation', () => {
    const mockTask = {
      id: 'test-task',
      type: 'feature',
      title: 'Test Feature',
      priority: 5,
      requirements: 'Implement test feature',
      acceptance_criteria: ['Feature works', 'Tests pass'],
      estimated_duration: 60,
      files_to_modify: ['src/']
    };
    
    beforeEach(() => {
      orchestrator.gatherProjectContext = jest.fn().mockResolvedValue('Project context');
      orchestrator.gatherTaskContext = jest.fn().mockResolvedValue('Task context');
    });
    
    it('should generate comprehensive task prompt', async () => {
      const prompt = await orchestrator.generateTaskPrompt(mockTask);
      
      expect(prompt).toContain('# Automated Coding Task');
      expect(prompt).toContain('## Project Context');
      expect(prompt).toContain('## Task Details');
      expect(prompt).toContain(mockTask.title);
      expect(prompt).toContain(mockTask.requirements);
      expect(prompt).toContain('Feature works');
      expect(prompt).toContain('Tests pass');
      
      expect(orchestrator.gatherProjectContext).toHaveBeenCalled();
      expect(orchestrator.gatherTaskContext).toHaveBeenCalledWith(mockTask);
    });
  });
  
  describe('Error Handling', () => {
    it('should identify critical failures correctly', () => {
      const criticalErrors = [
        new Error('ENOSPC: no space left on device'),
        new Error('ENOMEM: out of memory'),
        new Error('Repository not found'),
        new Error('Authentication failed')
      ];
      
      const nonCriticalError = new Error('Regular error');
      
      criticalErrors.forEach(error => {
        expect(orchestrator.isCriticalFailure(error)).toBe(true);
      });
      
      expect(orchestrator.isCriticalFailure(nonCriticalError)).toBe(false);
    });
  });
  
  describe('Final Report Generation', () => {
    beforeEach(() => {
      orchestrator.state.startTime = Date.now() - 3600000; // 1 hour ago
      orchestrator.state.endTime = Date.now();
      orchestrator.state.completedTasks = [
        { task: { id: 'task1' }, result: { duration: 1800000 } }
      ];
      orchestrator.state.failedTasks = [];
      orchestrator.state.checkpoints = [{ timestamp: Date.now() }];
      orchestrator.state.resourceUsage = [
        { timestamp: Date.now(), cpu: 50, memory: 1000000 }
      ];
    });
    
    it('should generate comprehensive final report', () => {
      const report = orchestrator.generateFinalReport();
      
      expect(report.success).toBe(true);
      expect(report.sessionId).toBe(orchestrator.state.sessionId);
      expect(report.completedTasks).toBe(1);
      expect(report.totalTasks).toBe(1);
      expect(report.errors).toHaveLength(0);
      expect(report.checkpoints).toBe(1);
      expect(typeof report.duration).toBe('number');
    });
    
    it('should indicate failure when there are failed tasks', () => {
      orchestrator.state.failedTasks = [
        { task: { id: 'task1' }, error: 'Task failed' }
      ];
      
      const report = orchestrator.generateFinalReport();
      
      expect(report.success).toBe(false);
      expect(report.errors).toHaveLength(1);
      expect(report.errors[0]).toBe('Task failed');
    });
  });
});