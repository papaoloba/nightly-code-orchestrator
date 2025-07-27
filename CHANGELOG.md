# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.0] - 2025-07-27

### Added
- **Automatic Code Improvements**: When all scheduled tasks complete successfully but time remains in the session, the orchestrator automatically triggers general code improvement tasks
- SuperClaude integration for automatic improvements using `/sc:improve` command with intelligent flags
- Configurable minimum time threshold for automatic improvements (default: 5 minutes)
- Comprehensive validation and rollback for automatic improvements
- Git integration for automatic improvement commits with proper tagging
- Dry run support for automatic improvements
- Complete test coverage for automatic improvement functionality

### Enhanced
- Session workflow now maximizes value by utilizing remaining time for code quality improvements
- Better time management with automatic buffer calculations
- Enhanced logging and UI feedback for automatic improvement sessions

## [1.1.1] - 2025-01-27

### Fixed
- SuperClaude prompt optimization no longer requires external SUPERCLAUDE_PROMPT_OPTIMIZATION_GUIDE.md file
- Embedded the complete optimization guide directly in the code for better portability
- The full SuperClaude Prompt Optimization Guide is now included in the codebase

## [1.1.0] - 2025-01-27

### Added
- SuperClaude Framework integration for automatic prompt optimization
- `--superclaude` CLI flag for enabling optimization mode
- Automatic transformation of natural language prompts to optimal SuperClaude commands
- Comprehensive documentation for SuperClaude integration

## [1.0.0] - 2025-01-25

### Changed
- **BREAKING**: Removed git tag system for task tracking in favor of commit message convention
- Task completion now tracked exclusively via `[task:<id>]` in commit messages
- Added structured footer metadata to task completion commits for better tracking

### Added
- Commit message convention documentation (`docs/COMMIT_CONVENTION.md`)
- Git commit-msg hook for validating task completion commits (`hooks/commit-msg`)
- Support for multi-commit tasks with progress indicators `[1/3]`, `[2/3]`, etc.

### Removed
- **BREAKING**: Completely removed git tag creation system
- Removed `createTaskTag()` method
- Removed `taskTags` property from session branch tracking
- Removed tag-related code from PR generation
- Removed deprecated methods: `createPullRequest()`, `mergeTaskToMain()`, `pushBranch()`
- Removed migration script (no longer needed)

## [1.0.0] - 2025-01-25

### Added
- Initial release of @papaoloba/nightly-code-orchestrator
- Complete CLI interface with all core commands (init, run, schedule, status, config, validate, report)
- 8-hour automated coding session orchestration
- YAML/JSON task management with dependency resolution
- Advanced git integration with automatic branching and PR creation
- Comprehensive validation system for environment, configuration, and code quality
- Detailed reporting system with email, Slack, and webhook notifications
- Cross-platform scheduling support (cron and Windows Task Scheduler)
- Resource monitoring and checkpoint/resume functionality
- Security features including sandboxing and command filtering
- Extensive test coverage with Jest
- Professional documentation and examples

### Features
- **Orchestrator Core**: Session management, resource monitoring, error handling
- **Task Management**: YAML/JSON loading, dependency resolution, priority ordering
- **Git Integration**: Branch creation, commit generation, PR automation
- **Validation System**: Multi-level validation for projects and configurations
- **Reporting**: HTML, Markdown, JSON reports with notification delivery
- **CLI Tools**: Complete command-line interface with interactive prompts
- **Configuration**: JSON schema validation with YAML templates
- **Security**: Sandboxing, file access controls, command filtering
- **Cross-platform**: Windows, macOS, and Linux support

### Technical Details
- Node.js 18+ required
- Claude Code CLI integration
- Git repository management
- Comprehensive error handling and logging
- Performance monitoring and optimization
- Production-ready architecture

### Documentation
- Complete README with usage examples
- Configuration schema documentation
- Task definition templates
- Best practices guide
- Troubleshooting documentation