/**
 * Enhanced Minimum Duration Tests
 * Tests the improved iterative prompting logic with Claude Code session continuity
 */

const { Orchestrator } = require('../src/core/orchestrator');

describe('Enhanced Minimum Duration with Session Continuity', () => {
  let orchestrator;
  let mockLogger;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    };

    orchestrator = new Orchestrator({
      workingDir: '/tmp/test-project',
      dryRun: false, // Need to disable dry run for most tests
      logger: mockLogger
    });

    // Mock Date.now to simulate time passing
    let mockTime = Date.now();
    const originalDateNow = Date.now;
    Date.now = jest.fn(() => {
      // Simulate 5 minutes passing on each call
      mockTime += 300000;
      return mockTime;
    });

    // Mock the session management methods
    orchestrator.executeClaudeCodeWithSession = jest.fn().mockResolvedValue({
      output: 'First iteration output',
      sessionId: 'test-session-12345',
      success: true,
      duration: 300000 // 5 minutes
    });

    orchestrator.executeClaudeCodeContinuation = jest.fn().mockResolvedValue({
      output: 'Continuation output',
      success: true,
      sessionId: 'test-session-12345'
    });

    orchestrator.gitManager = {
      getChangedFiles: jest.fn().mockResolvedValue(['src/test.js', 'README.md'])
    };

    // Don't mock these methods, test the real implementation
    orchestrator.gatherProjectContext = jest.fn().mockResolvedValue('Mock project context');
    orchestrator.gatherTaskContext = jest.fn().mockResolvedValue('Mock task context');
    
    // Restore Date.now after tests
    afterEach(() => {
      Date.now = originalDateNow;
    });
  });

  describe('Session Management', () => {
    it('should establish session on first iteration and continue on subsequent', async () => {
      const task = {
        id: 'test-task',
        title: 'Test Task',
        type: 'feature',
        requirements: 'Test requirements',
        minimum_duration: 15, // 15 minutes to force multiple iterations
        acceptance_criteria: ['Test criterion']
      };

      const result = await orchestrator.executeTask(task);

      expect(result.success).toBe(true);
      expect(result.sessionId).toBe('test-session-12345');
      expect(result.iterations).toBeGreaterThan(1);

      // Verify session establishment
      expect(orchestrator.executeClaudeCodeWithSession).toHaveBeenCalledTimes(1);
      expect(orchestrator.executeClaudeCodeContinuation).toHaveBeenCalled();

      // Verify session continuity logging
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Claude Code session established: test-ses...')
      );
    });

    it('should use continuation prompts for subsequent iterations', async () => {
      const task = {
        id: 'test-task-2',
        title: 'Test Task 2',
        type: 'feature',
        requirements: 'Test requirements',
        minimum_duration: 10,
        acceptance_criteria: ['Test criterion']
      };

      await orchestrator.executeTask(task);

      // Verify continuation was called for subsequent iterations
      expect(orchestrator.executeClaudeCodeContinuation).toHaveBeenCalled();
    });

    it('should handle session establishment failures gracefully', async () => {
      orchestrator.executeClaudeCodeWithSession = jest.fn().mockResolvedValue({
        output: 'Output without session',
        sessionId: null,
        success: true
      });

      const task = {
        id: 'test-task-3',
        title: 'Test Task 3',
        type: 'feature',
        requirements: 'Test requirements',
        minimum_duration: 5,
        acceptance_criteria: ['Test criterion']
      };

      const result = await orchestrator.executeTask(task);

      expect(result.success).toBe(true);
      expect(result.sessionId).toBeNull();
    });
  });

  describe('Continuation Prompt Generation', () => {
    it('should generate concise continuation prompts', () => {
      const task = {
        id: 'test-task',
        title: 'Test Task',
        type: 'feature'
      };

      const elapsedMs = 300000; // 5 minutes
      const remainingMs = 600000; // 10 minutes
      const filesChanged = ['src/file1.js', 'src/file2.js'];

      const prompt = orchestrator.generateContinuationPrompt(
        task,
        2, // iteration 2
        elapsedMs,
        remainingMs,
        filesChanged
      );

      expect(prompt).toContain('Continue working on the task "Test Task" (iteration 2)');
      expect(prompt).toContain('Elapsed: 5 minutes');
      expect(prompt).toContain('Remaining: 10 minutes');
      expect(prompt).toContain('Files modified: src/file1.js, src/file2.js');
      expect(prompt).toContain('You have full context from our previous conversation');
    });

    it('should handle empty file changes list', () => {
      const task = { id: 'test-task', title: 'Test Task', type: 'feature' };
      const prompt = orchestrator.generateContinuationPrompt(task, 2, 300000, 600000, []);

      expect(prompt).toContain('Files modified: none yet');
    });
  });

  describe('Enhanced Display Information', () => {
    it('should show session information in task display', async () => {
      const task = {
        id: 'test-task',
        title: 'Test Task',
        type: 'feature',
        requirements: 'Test requirements',
        minimum_duration: 10,
        acceptance_criteria: ['Test criterion']
      };

      // Mock the display methods
      orchestrator.displayBox = jest.fn();
      orchestrator.newLine = jest.fn();

      await orchestrator.executeTask(task);

      // Verify session info is displayed
      const displayCalls = orchestrator.displayBox.mock.calls;
      expect(displayCalls.length).toBeGreaterThan(0);

      // Check that session info appears in at least one display call
      const hasSessionInfo = displayCalls.some(call =>
        call[0].includes('Session:') || call[0].includes('Starting new session')
      );
      expect(hasSessionInfo).toBe(true);
    });
  });

  describe('Integration with Existing Features', () => {
    it('should maintain backward compatibility with tasks without minimum_duration', async () => {
      const task = {
        id: 'simple-task',
        title: 'Simple Task',
        type: 'feature',
        requirements: 'Simple requirements',
        acceptance_criteria: ['Simple criterion']
        // No minimum_duration specified
      };

      const result = await orchestrator.executeTask(task);

      expect(result.success).toBe(true);
      expect(result.iterations).toBe(1); // Should only run once
      expect(orchestrator.executeClaudeCodeWithSession).toHaveBeenCalledTimes(1);
      expect(orchestrator.executeClaudeCodeContinuation).not.toHaveBeenCalled();
    });

    it('should work with dry run mode', async () => {
      const task = {
        id: 'dry-run-task',
        title: 'Dry Run Task',
        type: 'feature',
        requirements: 'Dry run requirements',
        minimum_duration: 10,
        acceptance_criteria: ['Dry run criterion']
      };

      orchestrator.options.dryRun = true;

      const result = await orchestrator.executeTask(task);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Dry run - task not actually executed');
      expect(orchestrator.executeClaudeCodeWithSession).not.toHaveBeenCalled();
    });
  });
});