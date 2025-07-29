# Contributing to @nightly-code/orchestrator

Thank you for your interest in contributing to the Nightly Code Orchestrator! This document provides guidelines and information for contributors.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Contributing Guidelines](#contributing-guidelines)
- [Pull Request Process](#pull-request-process)
- [Issue Reporting](#issue-reporting)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Documentation](#documentation)

## Code of Conduct

This project adheres to a code of conduct adapted from the [Contributor Covenant](https://www.contributor-covenant.org/). By participating, you are expected to uphold this code.

### Our Standards

- **Be Respectful**: Treat everyone with respect and kindness
- **Be Inclusive**: Welcome newcomers and help them get started
- **Be Collaborative**: Work together and share knowledge
- **Be Professional**: Keep discussions focused and constructive

## Getting Started

### Prerequisites

- Node.js 18 or higher
- npm 8 or higher
- Git
- Claude Code CLI (for testing integration)

### Fork and Clone

1. Fork the repository on GitHub
2. Clone your fork locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/orchestrator.git
   cd orchestrator
   ```

3. Add the upstream repository:
   ```bash
   git remote add upstream https://github.com/nightly-code/orchestrator.git
   ```

## Development Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run tests to ensure everything works:
   ```bash
   npm test
   ```

3. Run linting:
   ```bash
   npm run lint
   ```

## Contributing Guidelines

### Types of Contributions

We welcome several types of contributions:

- **Bug Fixes**: Fix issues and improve stability
- **Features**: Add new functionality
- **Documentation**: Improve or add documentation
- **Tests**: Add or improve test coverage
- **Performance**: Optimize performance
- **Refactoring**: Improve code structure

### Coding Standards

- Follow the existing code style (enforced by ESLint)
- Write clear, self-documenting code
- Add comments for complex logic
- Use meaningful variable and function names
- Keep functions small and focused
- Follow the established project architecture

### Commit Messages

Use conventional commits format:

```
type(scope): description

[optional body]

[optional footer]
```

Types:
- `feat`: New feature
- `fix`: Bug fix  
- `docs`: Documentation changes
- `style`: Code style changes (no logic changes)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

Examples:
```
feat(orchestrator): add resume from checkpoint functionality
fix(git-manager): handle merge conflicts during branch creation
docs(readme): update installation instructions
test(task-manager): add dependency resolution tests
```

## Pull Request Process

### Before Submitting

1. **Update your fork**:
   ```bash
   git fetch upstream
   git checkout main
   git merge upstream/main
   ```

2. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **Make your changes** following the coding standards

4. **Test your changes**:
   ```bash
   npm test
   npm run lint
   ```

5. **Update documentation** if needed

6. **Commit your changes** with conventional commit messages

### Submitting the PR

1. **Push your branch**:
   ```bash
   git push origin feature/your-feature-name
   ```

2. **Create a Pull Request** on GitHub with:
   - Clear title describing the change
   - Detailed description of what was changed and why
   - Link to any related issues
   - Screenshots if UI changes are involved

3. **Address review feedback** promptly and professionally

### PR Requirements

- All tests must pass
- Code coverage should not decrease significantly
- Follow the existing code style
- Include appropriate documentation updates
- Add tests for new functionality

## Issue Reporting

### Before Creating an Issue

1. **Search existing issues** to avoid duplicates
2. **Check the documentation** for solutions
3. **Try the latest version** to see if the issue persists

### Creating a Good Issue

Include:

- **Clear title** summarizing the problem
- **Detailed description** of the issue
- **Steps to reproduce** the problem
- **Expected vs actual behavior**
- **Environment details** (OS, Node.js version, etc.)
- **Error messages** or logs if available
- **Screenshots** if relevant

### Issue Templates

Use these labels to categorize issues:

- `bug`: Something isn't working
- `enhancement`: New feature or improvement
- `documentation`: Documentation needs improvement
- `help wanted`: Extra attention is needed
- `good first issue`: Good for newcomers

## Development Workflow

### Project Structure

```
src/
├── orchestrator.js      # Main orchestration logic
├── task-manager.js      # Task loading and management
├── git-manager.js       # Git integration
├── validator.js         # Validation system
├── reporter.js          # Reporting and notifications
└── config/              # Configuration schemas

bin/
└── nightly-code         # CLI executable

test/
├── *.test.js           # Test files
└── setup.js            # Test configuration

templates/
├── session-config.yaml  # Configuration template
└── task-template.yaml   # Task template
```

### Key Components

- **Orchestrator**: Main session management
- **TaskManager**: Task loading, validation, and dependency resolution
- **GitManager**: Git operations and branch management
- **Validator**: Environment and configuration validation
- **Reporter**: Report generation and notifications

### Adding New Features

1. **Design first**: Discuss major changes in an issue
2. **Write tests**: Add tests before implementing features
3. **Implement incrementally**: Break large features into smaller PRs
4. **Update documentation**: Keep docs in sync with code changes

## Testing

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test -- orchestrator.test.js
```

### Writing Tests

- Use Jest as the testing framework
- Write unit tests for individual functions
- Write integration tests for component interactions
- Mock external dependencies appropriately
- Aim for high test coverage (>80%)

### Test Structure

```javascript
describe('ComponentName', () => {
  beforeEach(() => {
    // Setup before each test
  });

  describe('methodName', () => {
    it('should handle normal case', () => {
      // Test implementation
    });

    it('should handle error case', () => {
      // Error test implementation
    });
  });
});
```

## Documentation

### Types of Documentation

- **README**: Project overview and quick start
- **API Documentation**: Function and class documentation
- **Configuration**: Schema and options documentation
- **Examples**: Usage examples and tutorials
- **Contributing**: This file

### Documentation Standards

- Use clear, concise language
- Provide working examples
- Keep documentation up to date with code changes
- Use proper markdown formatting
- Include code examples with syntax highlighting

### Updating Documentation

When making changes:

1. Update relevant README sections
2. Update API documentation if interfaces change
3. Add examples for new features
4. Update configuration documentation for new options

## Getting Help

If you need help:

1. **Check the documentation** first
2. **Search existing issues** for similar problems
3. **Ask in discussions** for general questions
4. **Create an issue** for bugs or feature requests

### Communication Channels

- **Issues**: Bug reports and feature requests
- **Discussions**: General questions and ideas
- **Pull Requests**: Code review and collaboration

## Recognition

Contributors will be recognized in:

- The project README
- Release notes for significant contributions
- Special thanks in the CHANGELOG

Thank you for contributing to @nightly-code/orchestrator!