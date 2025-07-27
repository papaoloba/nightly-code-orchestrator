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

    it('should retry optimization to ensure /sc: prefix in output', async () => {
      // Mock logger
      orchestrator.logger.warn = jest.fn();
      orchestrator.logger.info = jest.fn();
      
      // Mock executeClaudeCodeSingle to return non-/sc: pattern first, then correct
      let callCount = 0;
      orchestrator.executeClaudeCodeSingle = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First call returns regular command (not /sc:)
          return Promise.resolve({ stdout: '/analyze @src/ --think' });
        } else {
          // Second call returns correct /sc: pattern
          return Promise.resolve({ stdout: '/sc:analyze @src/ --think --context full' });
        }
      });

      const originalPrompt = 'analyze my code with context';
      const result = await orchestrator.optimizePromptWithSuperClaude(originalPrompt);

      expect(orchestrator.executeClaudeCodeSingle).toHaveBeenCalledTimes(2);
      expect(result).toBe('/sc:analyze @src/ --think --context full');
      
      // Verify warning was logged for first attempt
      expect(orchestrator.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Output doesn't start with /sc: pattern")
      );
      expect(orchestrator.logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Retrying to ensure /sc: prefix")
      );
    });

    it('should accept /sc: commands on first try without retry', async () => {
      // Mock logger
      orchestrator.logger.info = jest.fn();
      
      // Mock executeClaudeCodeSingle to return /sc: command on first try
      orchestrator.executeClaudeCodeSingle = jest.fn().mockResolvedValue({
        stdout: '/sc:build "GraphQL API" --rate-limit 1000 --think'
      });

      const originalPrompt = 'Build a GraphQL API with rate limiting at 1000 requests per hour';
      const result = await orchestrator.optimizePromptWithSuperClaude(originalPrompt);

      expect(orchestrator.executeClaudeCodeSingle).toHaveBeenCalledTimes(1);
      expect(result).toBe('/sc:build "GraphQL API" --rate-limit 1000 --think');
      expect(orchestrator.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('✅ Prompt optimized to:')
      );
    });
  });

  // Tests for extractOptimizedCommand removed since the method has been removed
  // The optimization now uses raw output directly from the AI model

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

    it('should preserve context in optimization', async () => {
      orchestrator.superclaudeConfig = { enabled: true };
      orchestrator.superclaudeIntegration = { isEnabled: () => true };
      orchestrator.options.enableRetryOnLimits = false;

      // Mock context-preserving optimization
      orchestrator.optimizePromptWithSuperClaude.mockResolvedValue(
        '/implement "GraphQL API with rate limiting (1000 req/hour)" --type api --focus performance --validate'
      );

      await orchestrator.executeClaudeCode('Build a GraphQL API with rate limiting at 1000 requests per hour');

      expect(orchestrator.optimizePromptWithSuperClaude).toHaveBeenCalledWith('Build a GraphQL API with rate limiting at 1000 requests per hour');
      expect(orchestrator.executeClaudeCodeSingle).toHaveBeenCalledWith(
        '/implement "GraphQL API with rate limiting (1000 req/hour)" --type api --focus performance --validate',
        expect.any(Object)
      );
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
