// SuperClaude Prompt Optimization Guide embedded as a constant
const SUPERCLAUDE_OPTIMIZATION_GUIDE = `# SuperClaude Prompt Optimization Guide for Claude Code

A structured guide for transforming unstructured requests into optimal SuperClaude slash commands
that adhere to framework principles, syntax rules, and command specifications.

## Core Principle

**Transform natural language → Optimal SC command adhering to COMMANDS.md, FLAGS.md, PRINCIPLES.md, and RULES.md**

## Command Selection Matrix

### 1. Parse Intent → Select Command

| User Intent | Keywords | SC Command | Auto-Activations |
|------------|----------|------------|------------------|
| Create/Build | "create", "build", "make", "implement" | \`/build\` or \`/implement\` |
Frontend/Backend persona, Magic/Context7 |
| Analyze/Investigate | "analyze", "check", "review", "investigate" | \`/analyze\` | Analyzer persona, Sequential |
| Fix/Debug | "fix", "debug", "troubleshoot", "solve" | \`/troubleshoot\` | Analyzer persona, Sequential |
| Improve/Optimize | "improve", "optimize", "enhance", "refactor" | \`/improve\` | Refactorer/Performance persona |
| Document | "document", "write docs", "explain" | \`/document\` | Scribe persona, Context7 |
| Test | "test", "validate", "verify" | \`/test\` | QA persona, Playwright |

### 2. Assess Complexity → Add Flags

\`\`\`yaml
Simple (1-3 steps):
  - No thinking flags needed
  - Basic command sufficient

Moderate (4-10 steps):
  - Add: --think --seq
  - Consider: persona activation

Complex (10+ steps):
  - Add: --think-hard or --ultrathink
  - Enable: --wave-mode auto
  - Consider: --delegate auto
\`\`\`

### 3. Determine Scope → Configure Execution

\`\`\`yaml
File-level:
  - Target: @file.ext
  - No delegation needed

Module-level:
  - Target: @module/
  - Consider: --delegate files

System-level:
  - Target: @.
  - Enable: --delegate auto
  - Consider: --wave-mode
\`\`\`

## Syntax Rules Compliance

### Proper Argument Structure

\`\`\`bash
# CORRECT: Command + target + flags
/command [target] [--flags]

# Examples:
/analyze @src/ --think --seq
/build "component name" --magic --c7
/improve @. --wave-mode auto --validate
\`\`\`

### Path Specification Rules

\`\`\`bash
# Always use absolute paths or @ notation
@.              # Current directory
@src/           # Specific directory
@file.ts:45     # File with line number

# NEVER use relative paths
# Wrong: ../src/file.ts
# Right: @src/file.ts
\`\`\`

### Flag Precedence (RULES.md compliance)

1. Safety flags override optimization: \`--safe-mode > --uc\`
2. Explicit flags override auto-activation
3. Thinking depth: \`--ultrathink > --think-hard > --think\`
4. Wave mode: \`off > force > auto\`

## Framework Principles Application

### Evidence > Assumptions

\`\`\`bash
# Bad: Vague improvement request
/improve "make better"

# Good: Evidence-based improvement
/improve @src/ --focus performance --validate --think
\`\`\`

### Code > Documentation

\`\`\`bash
# Prioritize implementation
/implement "auth system" --validate  # First
/document @auth/ --persona-scribe=en  # Second
\`\`\`

### Efficiency > Verbosity

\`\`\`bash
# Enable compression for large operations
/analyze @large-project/ --uc --delegate auto
\`\`\`

## Optimization Patterns

### Pattern 1: Frontend Development

\`\`\`bash
# Unstructured: "Create a responsive dashboard with charts"
# Optimized:
/build "responsive dashboard" --magic --c7 --focus accessibility

# Why optimal:
# - Uses /build for creation
# - --magic for UI components
# - --c7 for framework patterns
# - --focus accessibility for best practices
\`\`\`

### Pattern 2: Backend API

\`\`\`bash
# Unstructured: "Build a REST API with authentication"
# Optimized:
/implement "REST API with auth" --think --seq --validate

# Why optimal:
# - Uses /implement for feature development
# - --think for moderate complexity
# - --seq for systematic approach
# - --validate for security
\`\`\`

### Pattern 3: System Analysis

\`\`\`bash
# Unstructured: "Find performance bottlenecks in my application"
# Optimized:
/analyze @. --focus performance --think-hard --persona-performance

# Why optimal:
# - Uses /analyze for investigation
# - --focus performance for targeted analysis
# - --think-hard for deep analysis
# - Auto-activates performance persona
\`\`\`

### Pattern 4: Code Quality

\`\`\`bash
# Unstructured: "Clean up and improve code quality"
# Optimized:
/improve @src/ --focus quality --loop --validate

# Why optimal:
# - Uses /improve for enhancement
# - --focus quality for targeted improvement
# - --loop for iterative refinement
# - --validate for quality gates
\`\`\`

## Wave Mode Optimization

### Auto-Activation Criteria (ORCHESTRATOR.md)

\`\`\`yaml
wave_triggers:
  - complexity >= 0.7
  - files > 20
  - operation_types > 2

# Example triggering wave mode:
/improve @legacy-system/ --wave-mode auto --wave-strategy enterprise
\`\`\`

### Wave Strategy Selection

\`\`\`bash
# Progressive (iterative enhancement)
/improve @. --wave-mode auto --wave-strategy progressive

# Systematic (comprehensive analysis)
/analyze @. --wave-mode force --wave-strategy systematic

# Enterprise (large-scale)
/improve @monorepo/ --wave-mode auto --wave-strategy enterprise
\`\`\`

## MCP Server Optimization

### Intelligent Server Selection

\`\`\`bash
# Documentation lookup
/explain "React hooks" --c7  # Auto-activates Context7

# Complex debugging
/troubleshoot "memory leak" --seq --think-hard  # Sequential analysis

# UI component
/build "data table" --magic  # Magic for UI generation

# E2E testing
/test e2e --play  # Playwright for browser automation
\`\`\`

### Multi-Server Coordination

\`\`\`bash
# Comprehensive analysis
/analyze @. --all-mcp --ultrathink

# Disable specific server
/build @ui/ --magic --no-seq

# No MCP (faster execution)
/improve @utils/ --no-mcp --uc
\`\`\`

## Persona Activation Rules

### Auto-Activation Examples

\`\`\`bash
# Frontend work → frontend persona
/build "nav component"  # Auto: --persona-frontend

# Security audit → security persona
/analyze --focus security  # Auto: --persona-security

# Documentation → scribe persona
/document @api/  # Auto: --persona-scribe=en
\`\`\`

### Manual Override

\`\`\`bash
# Force specific persona
/improve @. --persona-architect --ultrathink

# Multiple persona consultation
/design "microservices" --persona-architect --persona-backend
\`\`\`

## Command Construction Checklist

\`\`\`yaml
Step 1 - Select Base Command:
  ✓ Match user intent to command category
  ✓ Choose most specific command

Step 2 - Add Target:
  ✓ Use @ notation for paths
  ✓ Quote multi-word arguments
  ✓ Specify scope appropriately

Step 3 - Assess Complexity:
  ✓ Simple: no flags
  ✓ Moderate: --think --seq
  ✓ Complex: --think-hard or --ultrathink
  ✓ Very Complex: --wave-mode auto

Step 4 - Optimize Execution:
  ✓ Large scope: --delegate auto
  ✓ High tokens: --uc
  ✓ Critical ops: --validate
  ✓ Iterative: --loop

Step 5 - Enable Intelligence:
  ✓ Let personas auto-activate
  ✓ Let MCP servers auto-enable
  ✓ Trust wave detection
  ✓ Allow flag precedence
\`\`\`

## Quick Transformation Examples

\`\`\`bash
# "Fix the TypeScript errors"
/troubleshoot @. --focus typescript --delegate auto

# "Make the code more maintainable"
/improve @src/ --focus quality --persona-refactorer --loop

# "Add user authentication"
/implement "user authentication" --think --validate --seq

# "Document the entire API"
/document @api/ --persona-scribe=en --c7

# "Optimize database queries"
/improve @db/ --focus performance --think-hard --validate

# "Create a design system"
/design "design system" --wave-mode auto --magic --c7

# "Security audit the application"
/analyze @. --focus security --ultrathink --wave-validation

# "Modernize legacy code"
/improve @legacy/ --wave-mode enterprise --delegate auto
\`\`\`

## Common Mistakes to Avoid

\`\`\`bash
# ❌ Wrong: Vague targets
/improve "everything"

# ✅ Right: Specific targets
/improve @src/ --focus performance

# ❌ Wrong: Relative paths
/analyze ../components

# ✅ Right: @ notation
/analyze @components/

# ❌ Wrong: Multiple operations
/build and test and document

# ✅ Right: Sequential commands
/build "feature" && /test @feature/ && /document @feature/

# ❌ Wrong: Over-flagging
/analyze --think --think-hard --ultrathink --all-mcp --verbose

# ✅ Right: Appropriate complexity
/analyze --think-hard --seq
\`\`\`

## Optimization Formula

\`\`\`
Optimal SC Command = 
  Base Command (intent match) +
  Target (@ notation) +
  Complexity Flags (if needed) +
  Optimization Flags (scope-based) +
  Validation (if critical)
\`\`\`

## Summary

The key to optimal SuperClaude prompts is understanding that the framework's intelligence handles 
complexity for you. Start with the right command, add appropriate targets, let auto-activation work, 
and only add flags when truly needed. The framework will optimize execution through personas, 
MCP servers, wave orchestration, and delegation as appropriate.

Transform this prompt: "{PROMPT}"

Return ONLY the optimized command starting with /, nothing else.`;

module.exports = { SUPERCLAUDE_OPTIMIZATION_GUIDE };