# @papaoloba/nightly-code-orchestrator

Automated 8-hour coding sessions using Claude Code - a comprehensive npm package that enables unattended development work.

[![npm version](https://badge.fury.io/js/@papaoloba%2Fnightly-code-orchestrator.svg)](https://badge.fury.io/js/@papaoloba%2Fnightly-code-orchestrator)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js CI](https://github.com/papaoloba/nightly-code-orchestrator/workflows/Node.js%20CI/badge.svg)](https://github.com/papaoloba/nightly-code-orchestrator/actions)

## Overview

The Nightly Code Orchestrator transforms your development workflow by automating coding sessions while you sleep. Define tasks in simple YAML files, and wake up to completed features, fixed bugs, and comprehensive reports.

### Key Features

- **🤖 Automated 8-hour coding sessions** using Claude Code
- **📋 YAML/JSON task management** with dependency resolution
- **🔀 Advanced git integration** with automatic branching and PR creation
- **📝 Commit message convention** for task tracking
- **✅ Comprehensive validation** system for code quality
- **📊 Detailed reporting** and notifications
- **⏰ Cross-platform scheduling** (cron, Task Scheduler)
- **🔒 Security-first** approach with sandboxing options
- **🏗️ Production-ready** with extensive error handling
- **🧠 SuperClaude integration** for automatic prompt optimization
- **✨ Automatic improvements** when tasks complete early with time remaining

## Quick Start

### Installation

```bash
# Install globally for CLI access
npm install -g @papaoloba/nightly-code-orchestrator

# Or install locally in your project
npm install --save-dev @papaoloba/nightly-code-orchestrator
```

### Prerequisites

- **Node.js** 18 or higher
- **Claude Code** CLI installed and configured
- **Git** repository
- **GitHub CLI** (optional, for automatic PR creation)

### Initialize Your Project

#### If installed globally:

```bash
# Navigate to your project directory
cd your-project

# Initialize configuration
nightly-code init

# Edit the generated configuration files
code nightly-code.yaml nightly-tasks.yaml

# Validate your setup
nightly-code validate

# Test with a dry run
nightly-code run --dry-run

# Schedule automated sessions
nightly-code schedule
```

#### If installed locally as a dev dependency:

```bash
# Navigate to your project directory
cd your-project

# Initialize configuration using npx
npx nightly-code init

# Edit the generated configuration files
code nightly-code.yaml nightly-tasks.yaml

# Validate your setup
npx nightly-code validate

# Test with a dry run
npx nightly-code run --dry-run

# Schedule automated sessions
npx nightly-code schedule
```

**Note:** When installed locally, you can either:
- Use `npx nightly-code` to run commands
- Add scripts to your `package.json`:
  ```json
  {
    "scripts": {
      "nightly:init": "nightly-code init",
      "nightly:run": "nightly-code run",
      "nightly:validate": "nightly-code validate"
    }
  }
  ```
  Then run: `npm run nightly:init`

## Configuration

### Session Configuration (`nightly-code.yaml`)

```yaml
session:
  max_duration: 28800  # 8 hours in seconds
  time_zone: "UTC"
  max_concurrent_tasks: 1
  checkpoint_interval: 300  # 5 minutes

project:
  root_directory: "./"
  package_manager: "npm"
  test_command: "npm test"
  lint_command: "npm run lint"
  build_command: "npm run build"
  setup_commands:
    - "npm install"

git:
  branch_prefix: "nightly-"
  auto_push: true
  create_pr: true
  pr_template: ".github/pull_request_template.md"

notifications:
  email:
    enabled: false
    # smtp_host: "smtp.gmail.com"
    # smtp_user: "your-email@gmail.com"
    # to: ["team@company.com"]
  
  slack:
    enabled: false
    # webhook_url: "https://hooks.slack.com/services/..."

# SuperClaude Framework integration
superclaude:
  enabled: false  # Enable automatic prompt optimization
  planning_mode: intelligent
  execution_mode: assisted
  task_management: hierarchical
  integration_level: deep
```

### Task Definition (`nightly-tasks.yaml`)

```yaml
version: "1.0"
tasks:
  - id: "implement-user-auth"
    type: "feature"
    priority: 8
    title: "Implement User Authentication System"
    requirements: |
      Implement a complete user authentication system with:
      1. User registration with email verification
      2. Login with JWT tokens
      3. Password reset functionality
      4. Protected routes middleware
      
      Use bcrypt for password hashing and follow security best practices.
    
    acceptance_criteria:
      - "User can register and receive verification email"
      - "Login returns valid JWT token"
      - "Protected routes reject unauthenticated requests"
      - "Password reset flow works end-to-end"
      - "All security tests pass"
    
    minimum_duration: 180  # Optional: Forces iterative prompting for at least 3 hours
    dependencies: []
    tags: ["backend", "security", "authentication"]
    files_to_modify:
      - "src/auth/"
      - "src/middleware/"
      - "test/auth/"
    
    custom_validation:
      script: "./scripts/validate-auth.js"
      timeout: 300
    
    enabled: true

  - id: "fix-memory-leak"
    type: "bugfix"
    priority: 9
    title: "Fix Memory Leak in Data Processing"
    requirements: |
      Investigate and fix memory leak in data processing module.
      Memory usage increases by ~50MB/hour during operation.
      Issue appears related to event listeners not being cleaned up.
    
    acceptance_criteria:
      - "Memory usage remains stable during extended operation"
      - "Event listeners are properly cleaned up"
      - "Unit tests verify proper cleanup"
      - "Application can run 24+ hours without issues"
    
    minimum_duration: 90  # Optional: Forces iterative prompting for at least 90 minutes
    dependencies: []
    tags: ["bugfix", "performance", "memory"]
    files_to_modify:
      - "src/processors/"
    
    enabled: true
```

## CLI Commands

### `nightly-code init`

Initialize configuration in the current repository.

```bash
# If installed globally
nightly-code init
nightly-code init --force --template python

# If installed locally
npx nightly-code init
npx nightly-code init --force --template python
```

**Options:**
- `--force, -f` - Overwrite existing configuration
- `--template, -t` - Use predefined template (node, python, go)

### `nightly-code run`

Execute a coding session manually.

```bash
# If installed globally
nightly-code run
nightly-code run --max-duration 240 --dry-run
nightly-code run --resume checkpoint-123

# If installed locally
npx nightly-code run
npx nightly-code run --max-duration 240 --dry-run
npx nightly-code run --resume checkpoint-123
```

**Options:**
- `--config, -c` - Path to configuration file
- `--tasks, -t` - Path to tasks file
- `--max-duration` - Maximum duration in minutes
- `--dry-run` - Validate without executing
- `--resume` - Resume from checkpoint

### `nightly-code schedule`

Set up automated scheduling.

```bash
# If installed globally
nightly-code schedule
nightly-code schedule --cron "0 22 * * *" --timezone "America/New_York"

# If installed locally
npx nightly-code schedule
npx nightly-code schedule --cron "0 22 * * *" --timezone "America/New_York"
```

**Options:**
- `--cron, -c` - Cron expression for scheduling
- `--timezone, -t` - Timezone for scheduling
- `--dry-run` - Show what would be scheduled

### `nightly-code status`

Check the last session results.

```bash
# If installed globally
nightly-code status
nightly-code status --verbose --json

# If installed locally
npx nightly-code status
npx nightly-code status --verbose --json
```

**Options:**
- `--verbose, -v` - Show detailed information
- `--json` - Output in JSON format

### `nightly-code validate`

Validate current configuration and environment.

```bash
# If installed globally
nightly-code validate
nightly-code validate --fix

# If installed locally
npx nightly-code validate
npx nightly-code validate --fix
```

**Options:**
- `--config, -c` - Path to configuration file
- `--tasks, -t` - Path to tasks file
- `--fix` - Attempt to fix common issues

### `nightly-code describe`

Describe work to be done in natural language and generate optimized `nightly-tasks.yaml` file.

```bash
# If installed globally
nightly-code describe "Implement user authentication with email verification"
nightly-code describe --interactive
nightly-code describe --file tasks.txt

# If installed locally
npx nightly-code describe "Fix the memory leak in data processing"
npx nightly-code describe --interactive
```

**Options:**
- `--output, -o` - Output file path (default: nightly-tasks.yaml)
- `--interactive, -i` - Interactive mode for entering multiple tasks
- `--file, -f` - Read descriptions from a text file
- `--append` - Append to existing tasks file instead of overwriting

**Examples:**

1. Simple task description:
   ```bash
   nightly-code describe "Fix the critical bug in payment processing"
   ```

2. Complex feature with details:
   ```bash
   nightly-code describe "Implement user authentication system with:
   - Email and password registration
   - JWT token generation
   - Password reset functionality
   - Email verification
   - Protected routes middleware"
   ```

3. Load multiple tasks from file:
   ```bash
   nightly-code describe --file task-descriptions.txt
   ```

4. Interactive mode:
   ```bash
   nightly-code describe --interactive
   ```

The AI will automatically:
- Detect task type (feature, bugfix, refactor, test, docs)
- Assign appropriate priority based on keywords (critical, urgent, high, etc.)
- Extract relevant tags from the description
- Estimate duration based on complexity indicators
- Generate acceptance criteria
- Identify files that may need modification

### `nightly-code report`

Generate and view session reports.

```bash
# If installed globally
nightly-code report
nightly-code report 2024-01-15 --format markdown
nightly-code report --last 5 --output report.json

# If installed locally
npx nightly-code report
npx nightly-code report 2024-01-15 --format markdown
npx nightly-code report --last 5 --output report.json
```

**Options:**
- `--format, -f` - Output format (json, markdown, table)
- `--output, -o` - Output file path
- `--last` - Show last N sessions

## Advanced Usage

### Programmatic API

```javascript
const { Orchestrator, TaskManager } = require('@papaoloba/nightly-code-orchestrator');

// Create orchestrator instance
const orchestrator = new Orchestrator({
  configPath: 'custom-config.yaml',
  tasksPath: 'custom-tasks.yaml',
  maxDuration: 14400  // 4 hours
});

// Run session
orchestrator.run()
  .then(result => {
    console.log(`Session completed: ${result.completedTasks}/${result.totalTasks} tasks`);
  })
  .catch(error => {
    console.error('Session failed:', error);
  });

// Work with tasks directly
const taskManager = new TaskManager();
const tasks = await taskManager.loadTasks();
const ordered = await taskManager.resolveDependencies(tasks);
```

### Automatic Code Improvements

When all scheduled tasks complete successfully but time remains in the session, the orchestrator automatically triggers general code improvement tasks. This feature maximizes the value of your 8-hour coding sessions.

#### How It Works

1. **Automatic Trigger**: After all tasks complete, if 5+ minutes remain in session
2. **Intelligent Selection**: Uses SuperClaude `/sc:improve` command when available, falls back to standard improvement prompts
3. **Quality Focus**: Automatically focuses on code quality, performance, documentation, and security
4. **Safe Execution**: Includes validation and rollback if improvements fail
5. **Git Integration**: Commits improvements with automatic tagging

#### SuperClaude Integration

When SuperClaude is enabled, automatic improvements use the optimized command:

```bash
/sc:improve --scope project --focus quality --iterative --validate
```

This leverages the SuperClaude framework's intelligent analysis and improvement patterns.

#### Configuration

Automatic improvements can be controlled via configuration:

```yaml
# nightly-code.yaml
session:
  max_duration: 28800  # 8 hours
  auto_improvements: true  # Enable automatic improvements (default: true)
  min_improvement_time: 300  # Minimum time required (5 minutes default)

superclaude:
  enabled: true  # Enable SuperClaude for optimized improvements
```

#### Dry Run Mode

In dry run mode, automatic improvements are logged but not executed:

```bash
npx nightly-code --dry-run
# Shows what improvements would be made without executing them
```

### Custom Validation Scripts

Create custom validation scripts for specific requirements:

```javascript
// scripts/validate-auth.js
const { spawn } = require('child_process');

async function validateAuth() {
  console.log('Running authentication validation...');
  
  // Run security audit
  const audit = spawn('npm', ['audit', '--audit-level', 'high']);
  await new Promise((resolve, reject) => {
    audit.on('close', code => code === 0 ? resolve() : reject());
  });
  
  // Run auth-specific tests
  const tests = spawn('npm', ['test', '--', '--grep', 'auth']);
  await new Promise((resolve, reject) => {
    tests.on('close', code => code === 0 ? resolve() : reject());
  });
  
  console.log('Authentication validation passed!');
}

validateAuth().catch(error => {
  console.error('Validation failed:', error);
  process.exit(1);
});
```

### GitHub Actions Integration

```yaml
# .github/workflows/nightly-code.yml
name: Nightly Code Session

on:
  schedule:
    - cron: '0 2 * * *'  # 2 AM UTC daily
  workflow_dispatch:

jobs:
  nightly-code:
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    
    steps:
      - uses: actions/checkout@v4
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Install Nightly Code
        run: npm install -g @papaoloba/nightly-code-orchestrator
      
      - name: Run Nightly Code Session
        run: nightly-code run --max-duration 240
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Docker Integration

```dockerfile
# Dockerfile.nightly
FROM node:18-alpine

# Install system dependencies
RUN apk add --no-cache git openssh-client

# Install Claude Code and Nightly Code
RUN npm install -g claude-code @papaoloba/nightly-code-orchestrator

# Set up working directory
WORKDIR /workspace

# Copy configuration
COPY nightly-code.yaml nightly-tasks.yaml ./

# Set up git configuration
RUN git config --global user.name "Nightly Code Bot" && \
    git config --global user.email "nightly@example.com"

# Run nightly session
CMD ["nightly-code", "run"]
```

## Task Types and Templates

### Feature Tasks

For implementing new functionality:

```yaml
- id: "add-payment-integration"
  type: "feature"
  priority: 7
  title: "Add Stripe Payment Integration"
  requirements: |
    Integrate Stripe payment processing with:
    - Payment form with validation
    - Webhook handling for payment events
    - Error handling and retry logic
    - Invoice generation
  
  acceptance_criteria:
    - "Payment form accepts credit cards"
    - "Successful payments create invoices"
    - "Failed payments show appropriate errors"
    - "Webhook events are processed correctly"
  
  minimum_duration: 240
  tags: ["backend", "payments", "integration"]
```

### Bug Fix Tasks

For resolving issues:

```yaml
- id: "fix-search-performance"
  type: "bugfix"
  priority: 8
  title: "Fix Slow Search Performance"
  requirements: |
    Search queries are taking 5+ seconds on large datasets.
    Investigation shows missing database indexes and inefficient queries.
    
    Root causes:
    - No index on search columns
    - N+1 query problem in results
    - No query result caching
  
  acceptance_criteria:
    - "Search completes in under 500ms"
    - "Database queries are optimized"
    - "Caching reduces repeat query time"
  
  minimum_duration: 120
  tags: ["bugfix", "performance", "database"]
```

### Refactoring Tasks

For improving code structure:

```yaml
- id: "extract-service-layer"
  type: "refactor"
  priority: 4
  title: "Extract Business Logic to Service Layer"
  requirements: |
    Controllers have become too large with business logic mixed in.
    Extract to dedicated service classes for better separation of concerns.
    
    Goals:
    - Thin controllers focused on HTTP concerns
    - Testable service classes
    - Consistent error handling
    - Improved code organization
  
  acceptance_criteria:
    - "Controllers are under 100 lines each"
    - "Business logic is in service classes"
    - "Service classes have 90%+ test coverage"
    - "All existing functionality still works"
  
  minimum_duration: 180
  tags: ["refactor", "architecture"]
```

## Git Integration and Commit Convention

### Commit Message Convention

Nightly Code uses a structured commit message convention for tracking task completion. This provides better integration with standard git workflows and improved searchability.

#### Convention Format

```
<type>(<scope>): <description> [task:<task-id>]

<body>

Task-ID: <task-id>
Task-Title: <full task title>
Task-Type: <feature|bugfix|refactor|test|docs>
Task-Status: completed
Task-Duration: <duration in seconds>
Task-Session: <session-id>
Task-Date: <ISO timestamp>
```

#### Example Commits

**Single Commit Task:**
```
feat(auth): implement user login [task:auth-001]

Implemented JWT-based authentication with refresh tokens.

Task-ID: auth-001
Task-Title: Implement user authentication system
Task-Type: feature
Task-Status: completed
Task-Duration: 3600
Task-Session: session-2024-01-20-120000
Task-Date: 2024-01-20T12:00:00Z
```

**Multi-Commit Task:**
```
# Progress commits
feat(ui): add dashboard layout [task:ui-005] [1/3]
feat(ui): implement dashboard widgets [task:ui-005] [2/3]

# Final commit
feat(ui): complete dashboard implementation [task:ui-005] [3/3]

Finalized dashboard with all widgets and responsive design.

Task-ID: ui-005
Task-Title: Create user dashboard with analytics widgets
Task-Type: feature
Task-Status: completed
Task-Duration: 7200
Task-Session: session-2024-01-20-090000
Task-Date: 2024-01-20T11:00:00Z
```

### Finding Task Commits

```bash
# Find all task completions
git log --grep="\[task:" --oneline

# Find specific task
git log --grep="\[task:auth-001\]"

# List completed tasks with details
git log --grep="Task-Status: completed" --pretty=format:"%h %s %ad" --date=short

# Export task report
git log --grep="Task-Status: completed" --pretty=format:"%h|%s|%ad" --date=short > tasks.csv
```

### Git Hook Installation

Install the commit-msg hook to validate task commits:

```bash
# Copy hook to your git directory
cp node_modules/@papaoloba/nightly-code-orchestrator/hooks/commit-msg .git/hooks/
chmod +x .git/hooks/commit-msg
```

The hook validates:
- Proper commit format for task completions
- Required metadata in commit footer
- Task ID format and consistency
- Conventional commit compliance

## Security and Safety

### Sandboxing

Enable sandbox mode for additional security:

```yaml
security:
  sandbox_mode: true
  allowed_commands:
    - "npm"
    - "node"
    - "git"
  blocked_patterns:
    - "rm -rf"
    - "sudo"
    - "curl"
  max_file_size: 10485760  # 10MB
```

### File Access Control

Restrict file modifications:

```yaml
tasks:
  - id: "safe-task"
    files_to_modify:
      - "src/components/"  # Only allow changes in specific directories
      - "test/"
```

### Command Validation

All commands are validated before execution:

- Commands must be in the allowed list (if specified)
- Blocked patterns are rejected
- File size limits are enforced
- Network access can be restricted

## Performance and Monitoring

### Resource Monitoring

The orchestrator continuously monitors:

- **CPU usage** - Warns if consistently above 90%
- **Memory usage** - Alerts on excessive memory consumption
- **Disk space** - Ensures adequate space for operations
- **Network connectivity** - Validates access to required services

### Checkpointing

Automatic checkpoints every 5 minutes (configurable) include:

- Current task state
- Completed/failed tasks
- Resource usage history
- Git branch information
- Time elapsed

### Performance Metrics

Each session tracks:

- Tasks completed per hour
- Average task duration
- Time utilization percentage
- Error rate
- Resource efficiency

## Troubleshooting

### Common Issues

#### "Claude Code CLI not found"

```bash
# Install Claude Code
npm install -g claude-code

# Verify installation
claude-code --version
```

#### "Configuration validation failed"

```bash
# Check configuration syntax
# If installed globally
nightly-code validate

# If installed locally
npx nightly-code validate

# Fix common issues automatically
# If installed globally
nightly-code validate --fix

# If installed locally
npx nightly-code validate --fix
```

#### "Git repository not found"

```bash
# Initialize git repository
git init
git add .
git commit -m "Initial commit"
```

#### "Task dependencies cannot be resolved"

Check for circular dependencies:

```yaml
tasks:
  - id: "task-a"
    dependencies: ["task-b"]  # task-a depends on task-b
  - id: "task-b" 
    dependencies: ["task-a"]  # task-b depends on task-a (circular!)
```

### Dependency-Aware Branching

Nightly Code now supports intelligent Git branching that respects task dependencies. When a task depends on another task, it will automatically branch from the dependency's branch instead of main, ensuring all dependent code is available.

#### How It Works

1. **Independent Tasks**: Branch from main as usual
2. **Dependent Tasks**: Branch from the last dependency's branch
3. **Missing Dependencies**: Fall back to main with a warning

Example workflow:
```
main
 └─ task/setup-db (Task A)
     └─ task/create-api (Task B depends on A)
         └─ task/add-tests (Task C depends on B)
```

#### Configuration

Control dependency branching behavior in `nightly-code.yaml`:

```yaml
git:
  # Enable branching from dependency branches (default: true)
  dependency_aware_branching: true
  
  # Auto-merge tasks that have dependents (default: false)
  merge_dependency_chains: false
  
  # Fail if dependency branches are missing (default: false)
  strict_dependency_checking: false
```

#### Task Dependencies Example

```yaml
tasks:
  - id: "setup-database"
    type: "feature"
    title: "Set up database schema"
    requirements: "Create initial database tables and migrations"
    dependencies: []  # No dependencies - branches from main

  - id: "create-api"
    type: "feature"
    title: "Create REST API"
    requirements: "Implement CRUD endpoints for database entities"
    dependencies: ["setup-database"]  # Branches from setup-database branch

  - id: "add-authentication"
    type: "feature"
    title: "Add authentication"
    requirements: "Implement JWT authentication for API"
    dependencies: ["create-api"]  # Branches from create-api branch

  - id: "add-tests"
    type: "test"
    title: "Add integration tests"
    requirements: "Test API endpoints with authentication"
    dependencies: ["create-api", "add-authentication"]  # Branches from add-authentication (last dependency)
```

### Debug Mode

Enable detailed logging:

```bash
# Set log level
export NIGHTLY_CODE_LOG_LEVEL=debug

# Run with verbose output
# If installed globally
nightly-code run --verbose

# If installed locally
npx nightly-code run --verbose
```

### Log Files

Logs are stored in `.nightly-code/logs/`:

- `nightly-code.log` - General application logs
- `sessions.log` - Detailed session logs
- `scheduler.log` - Scheduling and cron logs

## Best Practices

### Task Design

1. **Be Specific**: Write detailed requirements and acceptance criteria
2. **Keep Tasks Focused**: Aim for 1-3 hours per task
3. **Define Dependencies**: Clearly specify task relationships
4. **Include Validation**: Add custom validation scripts for complex tasks
5. **Test Thoroughly**: Ensure acceptance criteria are testable

### Configuration Management

1. **Version Control**: Commit configuration files to git
2. **Environment Specific**: Use different configs for dev/staging/prod
3. **Secret Management**: Use environment variables for sensitive data
4. **Regular Validation**: Run `nightly-code validate` after changes

### Security Guidelines

1. **Principle of Least Privilege**: Only allow necessary commands
2. **Regular Updates**: Keep dependencies and tools updated
3. **Code Review**: Review generated code before merging
4. **Backup Strategy**: Maintain regular backups of important data

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Setup

```bash
# Clone the repository
git clone https://github.com/papaoloba/nightly-code-orchestrator.git
cd nightly-code-orchestrator

# Install dependencies
npm install

# Run tests
npm test

# Run with watch mode
npm run test:watch

# Check linting
npm run lint

# Build the project
npm run build
```

### Running Tests

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test -- orchestrator.test.js

# Run tests in watch mode
npm run test:watch
```

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Support

- **Documentation**: [Full documentation](https://nightly-code.github.io/orchestrator)
- **Issues**: [GitHub Issues](https://github.com/papaoloba/nightly-code-orchestrator/issues)
- **Discussions**: [GitHub Discussions](https://github.com/papaoloba/nightly-code-orchestrator/discussions)
- **Email**: support@nightly-code.dev

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history and updates.

---

<div align="center">
  <p>
    <strong>Transform your development workflow with automated coding sessions</strong>
  </p>
  <p>
    Made with ❤️ by the Paolo Barbato
  </p>
</div>