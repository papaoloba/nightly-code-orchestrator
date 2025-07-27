# SuperClaude Integration for Nightly Code

## Overview

Nightly Code now supports SuperClaude Framework integration, which automatically optimizes natural language prompts into optimal SuperClaude slash commands. When enabled, every prompt sent to Claude Code is automatically transformed using the SuperClaude Prompt Optimization Guide.

## How It Works

When SuperClaude mode is active:

1. **Prompt Interception**: Your natural language prompt is intercepted before execution
2. **Optimization**: Claude Code runs: `"Optimize the following prompt based on @SUPERCLAUDE_PROMPT_OPTIMIZATION_GUIDE.md: <your_prompt>"`
3. **Transformation**: Natural language is transformed into an optimal SuperClaude command
4. **Execution**: The optimized command is executed instead of the original prompt

## Enabling SuperClaude Mode

### Method 1: Configuration File

Add to your `nightly-code.yaml`:

```yaml
superclaude:
  enabled: true
  planning_mode: intelligent
  execution_mode: assisted
  task_management: hierarchical
  integration_level: deep
```

### Method 2: CLI Flag

Use the `--superclaude` flag when running:

```bash
# Enable during initialization
nightly-code init --superclaude

# Enable for a specific run (overrides config)
nightly-code run --superclaude
```

### Method 3: Programmatic

```javascript
const orchestrator = new Orchestrator({
  forceSuperclaude: true
});
```

## Prerequisites

1. **SUPERCLAUDE_PROMPT_OPTIMIZATION_GUIDE.md**: This file must exist in your project root for optimization to work
2. **Claude Code**: Must have Claude Code CLI installed and accessible

## Examples

### Example 1: Code Improvement

**Original Prompt**:
```
Make the code more maintainable
```

**Optimized Command**:
```bash
/improve @src/ --focus quality --persona-refactorer --loop
```

### Example 2: Bug Fixing

**Original Prompt**:
```
Fix the TypeScript errors
```

**Optimized Command**:
```bash
/troubleshoot @. --focus typescript --delegate auto
```

### Example 3: Feature Implementation

**Original Prompt**:
```
Add user authentication
```

**Optimized Command**:
```bash
/implement "user authentication" --think --validate --seq
```

### Example 4: System Analysis

**Original Prompt**:
```
Find performance bottlenecks in my application
```

**Optimized Command**:
```bash
/analyze @. --focus performance --think-hard --persona-performance
```

## Benefits

1. **Consistency**: All prompts follow SuperClaude best practices
2. **Efficiency**: Optimal flags and parameters are automatically selected
3. **Intelligence**: Framework features like personas, MCP servers, and wave orchestration are auto-activated
4. **Simplicity**: Users can write natural language without knowing SuperClaude syntax

## Command Optimization Patterns

The optimization follows these patterns:

### Intent Mapping
- "create", "build", "make" → `/build` or `/implement`
- "analyze", "check", "review" → `/analyze`
- "fix", "debug", "troubleshoot" → `/troubleshoot`
- "improve", "optimize", "enhance" → `/improve`
- "document", "write docs" → `/document`
- "test", "validate" → `/test`

### Complexity Assessment
- **Simple (1-3 steps)**: No thinking flags
- **Moderate (4-10 steps)**: Adds `--think --seq`
- **Complex (10+ steps)**: Adds `--think-hard` or `--ultrathink`
- **Very Complex**: Enables `--wave-mode auto`

### Scope Configuration
- **File-level**: Target specific files
- **Module-level**: Consider `--delegate files`
- **System-level**: Enable `--delegate auto` and consider `--wave-mode`

## Troubleshooting

### Optimization Not Working

1. **Check Guide File**: Ensure `SUPERCLAUDE_PROMPT_OPTIMIZATION_GUIDE.md` exists in project root
2. **Verify SuperClaude**: Check that SuperClaude is enabled in config or via CLI flag
3. **Check Logs**: Look for "🧠 Optimizing prompt with SuperClaude Framework..." in output

### Fallback Behavior

If optimization fails:
- Original prompt is used as fallback
- Warning is logged: "⚠️ No optimization found, using original prompt"
- Execution continues normally

### Performance

- Optimization adds ~1-3 seconds to execution time
- Optimization timeout is set to 30 seconds
- Failed optimizations don't block execution

## Configuration Options

```yaml
superclaude:
  enabled: true|false           # Enable/disable SuperClaude integration
  planning_mode: intelligent    # How to plan tasks
  execution_mode: assisted      # Execution strategy
  task_management: hierarchical # Task organization
  integration_level: deep       # Integration depth
```

## API Reference

### Orchestrator Options

```javascript
{
  forceSuperclaude: boolean  // Override config to enable SuperClaude
}
```

### Methods

- `optimizePromptWithSuperClaude(prompt)`: Optimizes a prompt using SuperClaude
- `extractOptimizedCommand(output)`: Extracts optimized command from Claude output

## Best Practices

1. **Keep Guide Updated**: Ensure your optimization guide reflects current SuperClaude patterns
2. **Monitor Logs**: Check optimization results to ensure expected transformations
3. **Test Locally**: Test optimization before running in production
4. **Fallback Planning**: Original prompts should still be valid as fallback

## Future Enhancements

- Caching of common optimizations
- Custom optimization patterns
- Multi-language prompt support
- Performance metrics tracking
- A/B testing of optimized vs original prompts