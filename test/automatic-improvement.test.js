const { Orchestrator } = require('../src/core/orchestrator');

describe('Automatic Improvement Feature', () => {
  let orchestrator;
  let mockLogger;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };

    orchestrator = new Orchestrator({
      maxDuration: 3600, // 1 hour
      dryRun: true
    });

    // Override logger
    orchestrator.logger = mockLogger;

    // Mock state
    orchestrator.state = {
      startTime: Date.now() - 1800000, // 30 minutes ago
      completedTasks: [],
      failedTasks: []
    };
  });

  describe('handleAutomaticImprovements', () => {
    it('should skip automatic improvements if tasks failed', async () => {
      const results = { completed: 2, failed: 1, skipped: 0 };

      await orchestrator.handleAutomaticImprovements(results);

      expect(mockLogger.info).toHaveBeenCalledWith(
        '⚠️  Skipping automatic improvements due to failed tasks'
      );
    });

    it('should skip automatic improvements if insufficient time remaining', async () => {
      const results = { completed: 2, failed: 0, skipped: 0 };

      // Set start time to leave less than 5 minutes
      orchestrator.state.startTime = Date.now() - 3540000; // 59 minutes ago

      await orchestrator.handleAutomaticImprovements(results);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Insufficient time remaining for automatic improvements')
      );
    });

    it('should trigger automatic improvements when conditions are met', async () => {
      const results = { completed: 2, failed: 0, skipped: 0 };

      // Mock required methods
      orchestrator.createAutomaticImprovementTask = jest.fn().mockResolvedValue({
        id: 'auto-improve-123',
        title: 'Automatic Code Improvement',
        minimum_duration: 30
      });

      orchestrator.executeAutomaticImprovementTask = jest.fn().mockResolvedValue({
        success: true,
        filesChanged: ['src/test.js'],
        duration: 1800000
      });

      orchestrator.validateTaskCompletion = jest.fn().mockResolvedValue({
        passed: true,
        errors: [],
        warnings: []
      });

      orchestrator.gitManager = {
        commitTask: jest.fn().mockResolvedValue()
      };

      orchestrator.prettyLogger = {
        divider: jest.fn(),
        box: jest.fn()
      };

      await orchestrator.handleAutomaticImprovements(results);

      expect(mockLogger.info).toHaveBeenCalledWith(
        '🚀 All tasks completed successfully! Starting automatic improvements...'
      );
      expect(orchestrator.createAutomaticImprovementTask).toHaveBeenCalled();
      expect(orchestrator.executeAutomaticImprovementTask).toHaveBeenCalled();
      expect(results.completed).toBe(3); // Should increment completed count
    });
  });

  describe('createAutomaticImprovementTask', () => {
    it('should create a valid automatic improvement task', async () => {
      const remainingTime = 1800; // 30 minutes

      const task = await orchestrator.createAutomaticImprovementTask(remainingTime);

      expect(task).toMatchObject({
        type: 'improvement',
        title: 'Automatic Code Improvement',
        automatic: true,
        enabled: true,
        tags: ['automatic', 'improvement', 'quality']
      });

      expect(task.id).toMatch(/^auto-improve-\d+$/);
      expect(task.requirements).toContain('Time available: 29 minutes'); // 30 - 1 minute buffer
      expect(task.minimum_duration).toBe(29);
    });

    it('should limit improvement duration to maximum 1 hour', async () => {
      const remainingTime = 7200; // 2 hours

      const task = await orchestrator.createAutomaticImprovementTask(remainingTime);

      expect(task.minimum_duration).toBe(60); // Should be capped at 1 hour
    });
  });

  describe('executeAutomaticImprovementTask', () => {
    it('should use SuperClaude command when available', async () => {
      const task = { minimum_duration: 30 };

      // Set dry run to false for this test
      orchestrator.options.dryRun = false;

      orchestrator.superclaudeConfig = { enabled: true };
      orchestrator.superclaudeIntegration = {
        isEnabled: () => true
      };

      orchestrator.executeClaudeCode = jest.fn().mockResolvedValue({
        stdout: 'Improvement completed',
        stderr: ''
      });

      orchestrator.gitManager = {
        getChangedFiles: jest.fn().mockResolvedValue(['src/improved.js'])
      };

      const result = await orchestrator.executeAutomaticImprovementTask(task);

      expect(mockLogger.info).toHaveBeenCalledWith(
        '🧠 Using SuperClaude /sc:improve command for automatic improvements'
      );
      expect(orchestrator.executeClaudeCode).toHaveBeenCalledWith(
        '/sc:improve --scope project --focus quality --iterative --validate',
        expect.any(Object)
      );
      expect(result.success).toBe(true);
      expect(result.automatic).toBe(true);
    });

    it('should fallback to standard approach when SuperClaude unavailable', async () => {
      const task = { minimum_duration: 30 };

      // Set dry run to false for this test
      orchestrator.options.dryRun = false;

      orchestrator.superclaudeConfig = { enabled: false };
      orchestrator.generateTaskPrompt = jest.fn().mockResolvedValue('Standard improvement prompt');
      orchestrator.executeClaudeCode = jest.fn().mockResolvedValue({
        stdout: 'Improvement completed',
        stderr: ''
      });

      orchestrator.gitManager = {
        getChangedFiles: jest.fn().mockResolvedValue(['src/improved.js'])
      };

      const result = await orchestrator.executeAutomaticImprovementTask(task);

      expect(mockLogger.info).toHaveBeenCalledWith(
        '🤖 Using standard improvement approach'
      );
      expect(orchestrator.generateTaskPrompt).toHaveBeenCalledWith(task);
      expect(result.success).toBe(true);
      expect(result.automatic).toBe(true);
    });

    it('should handle dry run mode', async () => {
      const task = { minimum_duration: 30 };
      orchestrator.options.dryRun = true;

      const result = await orchestrator.executeAutomaticImprovementTask(task);

      expect(result.success).toBe(true);
      expect(result.output).toBe('Dry run - automatic improvement task not actually executed');
      expect(result.automatic).toBe(true);
    });
  });
});
