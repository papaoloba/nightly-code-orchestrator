// SuperClaude Prompt Optimization Guide embedded as a constant
const SUPERCLAUDE_OPTIMIZATION_GUIDE = `# SuperClaude Prompt Optimization Guide for Claude Code

A structured guide for transforming unstructured requests into optimal SuperClaude slash commands
that adhere to framework principles, syntax rules, and command specifications.

## Core Principle

**Transform natural language → Optimal SC command that PRESERVES task-specific information while adhering to COMMANDS.md, FLAGS.md, PRINCIPLES.md, and RULES.md**

### Task Information Preservation Rules

1. **Preserve Specifics**: Maintain specific file names, paths, technologies, requirements
2. **Context Retention**: Keep domain-specific terminology and constraints
3. **Detail Preservation**: Retain quantitative metrics, deadlines, and success criteria
4. **Requirement Mapping**: Translate business requirements into technical flags
5. **Intelligent Abstraction**: Only generalize when specifics aren't provided

## Command Selection Matrix

### 1. Parse Intent + Extract Context → Select Command + Preserve Details

| User Intent | Keywords | SC Command | Context Preservation Strategy |
|------------|----------|------------|------------------------------|
| Create/Build | "create", "build", "make", "implement" | \`/build\` or \`/implement\` | Preserve: technology stack, component names, specific requirements, design specs |
| Analyze/Investigate | "analyze", "check", "review", "investigate" | \`/analyze\` | Preserve: target paths, analysis scope, specific metrics, performance criteria |
| Fix/Debug | "fix", "debug", "troubleshoot", "solve" | \`/troubleshoot\` | Preserve: error messages, symptoms, affected components, reproduction steps |
| Improve/Optimize | "improve", "optimize", "enhance", "refactor" | \`/improve\` | Preserve: performance targets, quality metrics, specific improvement areas |
| Document | "document", "write docs", "explain" | \`/document\` | Preserve: documentation type, target audience, specific topics, format requirements |
| Test | "test", "validate", "verify" | \`/test\` | Preserve: test types, coverage requirements, specific scenarios, acceptance criteria |

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

## Context-Preserving Optimization Patterns

### Pattern 1: Frontend Development with Specifics

\`\`\`bash
# Unstructured: "Create a responsive dashboard with charts showing user analytics data using React and Chart.js"
# Optimized:
/implement "responsive dashboard with user analytics charts" --type component --framework react --magic --c7 --focus accessibility

# Context Preserved:
# - Specific libraries: React, Chart.js mentioned in command description
# - Data type: "user analytics" retained in command
# - Technology stack: --framework react preserves tech choice
# - Responsive requirement: retained in component description
\`\`\`

### Pattern 2: Backend API with Requirements

\`\`\`bash
# Unstructured: "Build a REST API for user management with JWT authentication, role-based access control, and rate limiting at 100 requests per minute"
# Optimized:
/implement "REST API for user management with JWT auth, RBAC, rate limiting (100 req/min)" --type api --focus security --think --seq --validate

# Context Preserved:
# - Specific auth method: JWT mentioned in description
# - Security model: RBAC (role-based access control) specified
# - Performance requirement: 100 requests/min rate limit preserved
# - Domain: "user management" context retained
\`\`\`

### Pattern 3: System Analysis with Metrics

\`\`\`bash
# Unstructured: "Find performance bottlenecks in my Node.js e-commerce application - API response times are over 2 seconds and database queries are slow"
# Optimized:
/analyze @src/ --focus performance --think-hard --persona-performance "Node.js e-commerce app with API response >2s, slow DB queries"

# Context Preserved:
# - Technology: Node.js specified in command
# - Application type: e-commerce context retained
# - Performance metric: >2 second response time threshold preserved
# - Specific symptom: slow database queries mentioned
\`\`\`

### Pattern 4: Code Quality with Targets

\`\`\`bash
# Unstructured: "Clean up and improve code quality in the payment processing module - reduce cyclomatic complexity below 10 and achieve 90% test coverage"
# Optimized:
/improve @src/payment/ --focus quality --loop --validate "reduce complexity <10, achieve 90% test coverage"

# Context Preserved:
# - Specific module: payment processing targeted via @src/payment/
# - Quality metric: cyclomatic complexity <10 retained
# - Coverage target: 90% test coverage specified
# - Business domain: payment processing context maintained
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

## Context-Preserving Transformation Examples

\`\`\`bash
# "Fix the TypeScript strict mode errors in the auth service"
/troubleshoot @src/auth/ --focus typescript "strict mode errors in auth service" --validate

# "Make the user management code more maintainable for the new team members"
/improve @src/user-management/ --focus quality --persona-refactorer --loop "improve maintainability for new team"

# "Add OAuth 2.0 authentication with Google and GitHub providers"
/implement "OAuth 2.0 authentication with Google/GitHub providers" --type feature --focus security --think --validate --seq

# "Document the REST API endpoints with OpenAPI 3.0 specification"
/document @api/ --persona-scribe=en --c7 "REST API with OpenAPI 3.0 spec"

# "Optimize PostgreSQL queries causing 5+ second response times"
/improve @src/database/ --focus performance --think-hard --validate "PostgreSQL queries >5s response time"

# "Create a Material Design component library for the mobile app"
/design "Material Design component library for mobile" --wave-mode auto --magic --c7

# "Security audit for GDPR compliance in data processing workflows"
/analyze @. --focus security --ultrathink --wave-validation "GDPR compliance audit for data workflows"

# "Modernize legacy PHP codebase to Laravel 10 with automated testing"
/improve @legacy-php/ --wave-mode enterprise --delegate auto "migrate to Laravel 10 with automated testing"
\`\`\`

## Common Context-Loss Mistakes to Avoid

\`\`\`bash
# ❌ Wrong: Losing specific details
Original: "Fix the React hooks memory leak in UserProfile component"
Bad optimization: /troubleshoot @. --focus performance
# Lost: React hooks, memory leak type, specific component

# ✅ Right: Preserving specific context
/troubleshoot @src/UserProfile/ --focus performance "React hooks memory leak in UserProfile component" --validate

# ❌ Wrong: Generic abstraction of requirements
Original: "Implement GraphQL API with rate limiting at 1000 requests per hour"
Bad optimization: /implement "API" --validate
# Lost: GraphQL, specific rate limit

# ✅ Right: Requirement preservation
/implement "GraphQL API with rate limiting (1000 req/hour)" --type api --focus performance --validate

# ❌ Wrong: Technology-agnostic when tech is specified
Original: "Migrate MongoDB collections to PostgreSQL with zero downtime"
Bad optimization: /improve @database/ --focus performance
# Lost: MongoDB → PostgreSQL migration, zero downtime requirement

# ✅ Right: Technology and constraint preservation
/improve @database/ --focus migration "MongoDB to PostgreSQL zero-downtime migration" --validate --think-hard

# ❌ Wrong: Losing quantitative targets
Original: "Achieve 95% test coverage on payment processing with sub-100ms response times"
Bad optimization: /improve @payment/ --focus quality
# Lost: 95% coverage target, sub-100ms performance requirement

# ✅ Right: Metric preservation
/improve @src/payment/ --focus quality --validate "achieve 95% test coverage, <100ms response times"
\`\`\`

## Enhanced Optimization Formula

\`\`\`
Optimal SC Command = 
  Base Command (intent match) +
  Target (@ notation + specifics) +
  Context-Rich Description (preserve key details) +
  Appropriate Flags (complexity + requirements) +
  Validation (if critical) +
  Preserved Metrics/Constraints
\`\`\`

## Context Extraction Guidelines

### CRITICAL: Before optimization, extract and preserve:

1. **Technical Specifics**: Technologies, frameworks, libraries, versions
2. **Quantitative Requirements**: Performance metrics, coverage targets, timelines
3. **Business Context**: Domain, user types, specific use cases
4. **Constraints**: Security requirements, compatibility needs, resource limits
5. **Quality Criteria**: Acceptance criteria, success metrics, validation requirements

### Optimization Process:

1. **Parse**: Extract intent, context, specifics, and constraints
2. **Map**: Match intent to command while preserving context
3. **Enhance**: Add appropriate flags based on complexity and requirements
4. **Validate**: Ensure all critical information is preserved in the optimized command
5. **Verify**: Optimized command should be more specific than original, not more generic

## Summary

Enhanced SuperClaude optimization PRESERVES task-specific information while leveraging framework intelligence. 
The goal is to create more precise, actionable commands that maintain all critical context from the original request.
Never sacrifice specificity for syntax compliance - preserve what matters to achieve the intended outcome.

Transform this prompt: "{PROMPT}"

CRITICAL INSTRUCTION: Preserve ALL specific details, technologies, metrics, and requirements from the original prompt in your optimized command. Return ONLY the optimized command starting with /sc:, nothing else. The output MUST be a single line starting with "/sc:" followed by the command and all its arguments.`;

module.exports = { SUPERCLAUDE_OPTIMIZATION_GUIDE };
