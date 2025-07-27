# Nightly Code Commit Message Convention

## Overview

This document defines the commit message convention for task completion in Nightly Code Orchestrator.

## Convention Format

```
<type>(<scope>): <description> [task:<task-id>]

<body>

<footer>
```

### Components

#### Type (Required)
- `feat`: New feature implementation
- `fix`: Bug fix
- `refactor`: Code refactoring
- `test`: Adding or modifying tests
- `docs`: Documentation changes
- `chore`: Maintenance tasks
- `perf`: Performance improvements
- `style`: Code style changes (formatting, etc.)

#### Scope (Optional)
- Module or component name (e.g., `api`, `ui`, `auth`, `db`)
- Extracted from task tags or file paths

#### Description (Required)
- Brief summary of the change (max 50 characters)
- Present tense, lowercase
- No period at the end

#### Task ID (Required for task completion)
- Format: `[task:<task-id>]`
- Example: `[task:task-001]`
- Placed at the end of the subject line

#### Body (Optional)
- Detailed explanation of changes
- Task requirements and acceptance criteria
- Files changed summary
- Can span multiple lines

#### Footer (Required for task completion)
- Task metadata in structured format:
  ```
  Task-ID: <task-id>
  Task-Title: <full task title>
  Task-Type: <feature|bugfix|refactor|test|docs>
  Task-Status: completed
  Task-Duration: <duration in seconds>
  Task-Session: <session-id>
  Task-Date: <ISO timestamp>
  ```

## Examples

### Simple Task Completion
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

### Bug Fix Task
```
fix(api): resolve memory leak in data processor [task:bug-042]

Fixed memory leak by properly closing database connections
after batch processing operations.

Files changed: src/api/processor.js, src/api/db-utils.js

Task-ID: bug-042
Task-Title: Fix memory leak in data processing module
Task-Type: bugfix
Task-Status: completed
Task-Duration: 1800
Task-Session: session-2024-01-20-140000
Task-Date: 2024-01-20T14:30:00Z
```

### Multi-Commit Task
For tasks that require multiple commits, use the following pattern:

#### Progress Commits
```
feat(ui): add dashboard layout structure [task:ui-005] [1/3]

Created basic dashboard layout components.
```

#### Final Completion Commit
```
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

## Benefits

1. **Better Integration**: Commit messages are part of the standard git workflow
2. **Searchability**: Easy to search and filter using git log commands
3. **Portability**: Task information is permanently linked to the code changes
4. **Tool Compatibility**: Works with all git tools and services
5. **Context**: All task metadata is preserved in the commit history

## Git Commands for Task Tracking

### Find all completed tasks
```bash
git log --grep="\[task:" --grep="Task-Status: completed"
```

### Find specific task
```bash
git log --grep="Task-ID: auth-001"
```

### List all tasks in a session
```bash
git log --grep="Task-Session: session-2024-01-20-120000"
```

### Export task completion report
```bash
git log --grep="Task-Status: completed" --pretty=format:"%h|%s|%ad" --date=short
```


## Enforcement

This convention can be enforced through:
1. Git commit hooks (commit-msg hook)
2. CI/CD pipeline validation
3. Code review guidelines
4. Automated tooling in Nightly Code Orchestrator