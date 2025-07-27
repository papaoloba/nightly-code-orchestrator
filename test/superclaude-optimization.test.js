const { Orchestrator } = require('../src/orchestrator');
const fs = require('fs-extra');

// Mock all dependencies
jest.mock('../src/task-manager');
jest.mock('../src/git-manager');
jest.mock('../src/validator');
jest.mock('../src/reporter');
jest.mock('../src/superclaude-integration');
jest.mock('fs-extra');

describe('SuperClaude Prompt Optimization', () => {
  let orchestrator;

  beforeEach(() => {
    // Create orchestrator instance with minimal setup
    orchestrator = new Orchestrator({});

    // Mock fs operations
    fs.pathExists = jest.fn();
  });

  describe('optimizePromptWithSuperClaude', () => {
    it('should optimize prompts when SuperClaude is enabled', async () => {
      // Enable SuperClaude
      orchestrator.superclaudeConfig = { enabled: true };
      orchestrator.superclaudeIntegration = { isEnabled: () => true };

      // Mock executeClaudeCodeSingle to return optimized command
      orchestrator.executeClaudeCodeSingle = jest.fn().mockResolvedValue({
        stdout: '/improve @src/ --focus quality --validate',
        stderr: '',
        code: 0
      });

      const originalPrompt = 'Make the code better';
      const result = await orchestrator.optimizePromptWithSuperClaude(originalPrompt);

      expect(result).toBe('/improve @src/ --focus quality --validate');
      expect(orchestrator.executeClaudeCodeSingle).toHaveBeenCalledWith(
        expect.stringContaining('Transform this prompt:'),
        expect.objectContaining({
          timeout: 30000,
          workingDir: expect.any(String)
        })
      );
    });

    it('should return original prompt when optimization fails', async () => {
      orchestrator.superclaudeConfig = { enabled: true };
      orchestrator.superclaudeIntegration = { isEnabled: () => true };

      // Mock executeClaudeCodeSingle to throw error
      orchestrator.executeClaudeCodeSingle = jest.fn().mockRejectedValue(new Error('Optimization failed'));

      const originalPrompt = 'Make the code better';
      const result = await orchestrator.optimizePromptWithSuperClaude(originalPrompt);

      expect(result).toBe(originalPrompt);
    });
  });

  describe('extractOptimizedCommand', () => {
    it('should extract slash commands from various formats', () => {
      const testCases = [
        {
          input: '/analyze @src/ --think --seq',
          expected: '/analyze @src/ --think --seq'
        },
        {
          input: 'Optimized: /build "component" --magic',
          expected: '/build "component" --magic'
        },
        {
          input: 'The optimal command is `/improve @. --validate`',
          expected: '/improve @. --validate'
        },
        {
          input: 'Command: /test --coverage',
          expected: '/test --coverage'
        },
        {
          input: 'Optimal SC Command: /troubleshoot @. --focus typescript',
          expected: '/troubleshoot @. --focus typescript'
        },
        {
          input: `Based on analysis:
/implement "user authentication" --think --validate --seq`,
          expected: '/implement "user authentication" --think --validate --seq'
        }
      ];

      testCases.forEach(({ input, expected }) => {
        const result = orchestrator.extractOptimizedCommand(input);
        expect(result).toBe(expected);
      });
    });

    it('should return null for invalid outputs', () => {
      const testCases = [
        '',
        null,
        undefined,
        'No command here',
        'Just some text without a slash command'
      ];

      testCases.forEach(input => {
        const result = orchestrator.extractOptimizedCommand(input);
        expect(result).toBeNull();
      });
    });
  });

  describe('executeClaudeCode integration', () => {
    beforeEach(() => {
      // Mock executeClaudeCodeSingle to avoid actual execution
      orchestrator.executeClaudeCodeSingle = jest.fn().mockResolvedValue({
        stdout: 'Success',
        stderr: '',
        code: 0
      });

      // Mock optimization
      orchestrator.optimizePromptWithSuperClaude = jest.fn();
    });

    it('should optimize prompts when SuperClaude is enabled', async () => {
      orchestrator.superclaudeConfig = { enabled: true };
      orchestrator.superclaudeIntegration = { isEnabled: () => true };
      orchestrator.options.enableRetryOnLimits = false;

      orchestrator.optimizePromptWithSuperClaude.mockResolvedValue('/analyze @. --think');

      await orchestrator.executeClaudeCode('analyze my code');

      expect(orchestrator.optimizePromptWithSuperClaude).toHaveBeenCalledWith('analyze my code');
      expect(orchestrator.executeClaudeCodeSingle).toHaveBeenCalledWith('/analyze @. --think', expect.any(Object));
    });

    it('should not optimize prompts when SuperClaude is disabled', async () => {
      orchestrator.superclaudeConfig = { enabled: false };
      orchestrator.options.enableRetryOnLimits = false;

      await orchestrator.executeClaudeCode('analyze my code');

      expect(orchestrator.optimizePromptWithSuperClaude).not.toHaveBeenCalled();
      expect(orchestrator.executeClaudeCodeSingle).toHaveBeenCalledWith('analyze my code', expect.any(Object));
    });

    it('should not optimize when integration is not enabled', async () => {
      orchestrator.superclaudeConfig = { enabled: true };
      orchestrator.superclaudeIntegration = { isEnabled: () => false };
      orchestrator.options.enableRetryOnLimits = false;

      await orchestrator.executeClaudeCode('analyze my code');

      expect(orchestrator.optimizePromptWithSuperClaude).not.toHaveBeenCalled();
    });
  });
});
