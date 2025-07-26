const fs = require('fs-extra');
const path = require('path');
const YAML = require('yaml');
const Joi = require('joi');
const { spawn } = require('cross-spawn');

class Validator {
  constructor (options = {}) {
    this.options = {
      configPath: options.configPath || 'nightly-code.yaml',
      tasksPath: options.tasksPath || 'nightly-tasks.yaml',
      workingDir: options.workingDir || process.cwd(),
      logger: options.logger || console
    };

    this.configSchema = this.createConfigSchema();
    this.projectValidators = this.createProjectValidators();
  }

  createConfigSchema () {
    return Joi.object({
      session: Joi.object({
        max_duration: Joi.number().integer().min(300).max(28800).default(28800),
        time_zone: Joi.string().default('UTC'),
        max_concurrent_tasks: Joi.number().integer().min(1).max(5).default(1),
        checkpoint_interval: Joi.number().integer().min(60).max(3600).default(300)
      }).default(),

      project: Joi.object({
        root_directory: Joi.string().default('./'),
        package_manager: Joi.string().valid('npm', 'yarn', 'pnpm', 'pip', 'cargo', 'go').default('npm'),
        test_command: Joi.string().allow('').default(''),
        lint_command: Joi.string().allow('').default(''),
        build_command: Joi.string().allow('').default(''),
        setup_commands: Joi.array().items(Joi.string()).default([])
      }).default(),

      git: Joi.object({
        branch_prefix: Joi.string().pattern(/^[a-zA-Z0-9-_]+$/).default('nightly-'),
        auto_push: Joi.boolean().default(true),
        create_pr: Joi.boolean().default(true),
        pr_template: Joi.string().allow('').default(''),
        cleanup_branches: Joi.boolean().default(false)
      }).default(),

      validation: Joi.object({
        skip_tests: Joi.boolean().default(false),
        skip_lint: Joi.boolean().default(false),
        skip_build: Joi.boolean().default(false),
        custom_validators: Joi.array().items(Joi.object({
          name: Joi.string().required(),
          command: Joi.string().required(),
          timeout: Joi.number().integer().min(1).max(3600).default(300),
          required: Joi.boolean().default(true)
        })).default([])
      }).default(),

      notifications: Joi.object({
        email: Joi.object({
          enabled: Joi.boolean().default(false),
          smtp_host: Joi.string().when('enabled', { is: true, then: Joi.required() }),
          smtp_port: Joi.number().integer().min(1).max(65535).default(587),
          smtp_secure: Joi.boolean().default(false),
          smtp_user: Joi.string().when('enabled', { is: true, then: Joi.required() }),
          smtp_pass: Joi.string().when('enabled', { is: true, then: Joi.required() }),
          from: Joi.string().email().when('enabled', { is: true, then: Joi.required() }),
          to: Joi.array().items(Joi.string().email()).when('enabled', { is: true, then: Joi.required() })
        }).default(),

        slack: Joi.object({
          enabled: Joi.boolean().default(false),
          webhook_url: Joi.string().uri().when('enabled', { is: true, then: Joi.required() }),
          channel: Joi.string().default('#general')
        }).default(),

        webhook: Joi.object({
          enabled: Joi.boolean().default(false),
          url: Joi.string().uri().when('enabled', { is: true, then: Joi.required() }),
          method: Joi.string().valid('POST', 'PUT').default('POST'),
          headers: Joi.object().default({})
        }).default()
      }).default(),

      security: Joi.object({
        allowed_commands: Joi.array().items(Joi.string()).default([]),
        blocked_patterns: Joi.array().items(Joi.string()).default([]),
        max_file_size: Joi.number().integer().min(1).default(10485760), // 10MB
        sandbox_mode: Joi.boolean().default(false)
      }).default()
    });
  }

  createProjectValidators () {
    return {
      nodejs: {
        detect: () => this.fileExists('package.json'),
        validate: async () => await this.validateNodejsProject()
      },

      python: {
        detect: () => this.fileExists('requirements.txt') || this.fileExists('pyproject.toml') || this.fileExists('setup.py'),
        validate: async () => await this.validatePythonProject()
      },

      go: {
        detect: () => this.fileExists('go.mod'),
        validate: async () => await this.validateGoProject()
      },

      rust: {
        detect: () => this.fileExists('Cargo.toml'),
        validate: async () => await this.validateRustProject()
      },

      generic: {
        detect: () => true,
        validate: async () => await this.validateGenericProject()
      }
    };
  }

  async validateAll () {
    this.options.logger.info('Starting comprehensive validation');

    const results = {
      valid: true,
      errors: [],
      warnings: [],
      validations: {}
    };

    try {
      // Validate configuration
      const configValidation = await this.validateConfiguration();
      results.validations.configuration = configValidation;
      if (!configValidation.valid) {
        results.valid = false;
        results.errors.push(...configValidation.errors);
      }
      results.warnings.push(...configValidation.warnings);

      // Validate tasks
      const tasksValidation = await this.validateTasks();
      results.validations.tasks = tasksValidation;
      if (!tasksValidation.valid) {
        results.valid = false;
        results.errors.push(...tasksValidation.errors);
      }
      results.warnings.push(...tasksValidation.warnings);

      // Validate project structure
      const projectValidation = await this.validateProject();
      results.validations.project = projectValidation;
      if (!projectValidation.valid) {
        results.valid = false;
        results.errors.push(...projectValidation.errors);
      }
      results.warnings.push(...projectValidation.warnings);

      // Validate environment
      const envValidation = await this.validateEnvironment();
      results.validations.environment = envValidation;
      if (!envValidation.valid) {
        results.valid = false;
        results.errors.push(...envValidation.errors);
      }
      results.warnings.push(...envValidation.warnings);

      this.options.logger.info('Validation completed', {
        valid: results.valid,
        errors: results.errors.length,
        warnings: results.warnings.length
      });

      return results;
    } catch (error) {
      this.options.logger.error('Validation failed with exception', { error: error.message });

      results.valid = false;
      results.errors.push({
        type: 'validation_exception',
        message: error.message,
        path: 'validator'
      });

      return results;
    }
  }

  async validateConfiguration () {
    this.options.logger.debug('Validating configuration');

    const result = {
      valid: true,
      errors: [],
      warnings: []
    };

    try {
      const config = await this.loadConfig();

      const { error, value, warning } = this.configSchema.validate(config, {
        allowUnknown: true,
        stripUnknown: true
      });

      if (error) {
        result.valid = false;
        result.errors.push(...error.details.map(detail => ({
          type: 'config_validation',
          message: detail.message,
          path: detail.path.join('.')
        })));
      }

      // Additional configuration validations
      if (value) {
        await this.performAdditionalConfigValidations(value, result);
      }
    } catch (error) {
      result.valid = false;
      result.errors.push({
        type: 'config_load_error',
        message: `Failed to load configuration: ${error.message}`,
        path: this.options.configPath
      });
    }

    return result;
  }

  async performAdditionalConfigValidations (config, result) {
    // Validate time zone
    try {
      Intl.DateTimeFormat(undefined, { timeZone: config.session.time_zone });
    } catch (error) {
      result.warnings.push({
        type: 'invalid_timezone',
        message: `Invalid timezone: ${config.session.time_zone}`,
        path: 'session.time_zone'
      });
    }

    // Validate package manager
    if (config.project.package_manager) {
      const hasPackageManager = await this.commandExists(config.project.package_manager);
      if (!hasPackageManager) {
        result.warnings.push({
          type: 'missing_package_manager',
          message: `Package manager '${config.project.package_manager}' not found in PATH`,
          path: 'project.package_manager'
        });
      }
    }

    // Validate commands
    const commands = [
      { key: 'test_command', path: 'project.test_command' },
      { key: 'lint_command', path: 'project.lint_command' },
      { key: 'build_command', path: 'project.build_command' }
    ];

    for (const { key, path } of commands) {
      const command = config.project[key];
      if (command && command.trim()) {
        const isValid = await this.validateCommand(command);
        if (!isValid) {
          result.warnings.push({
            type: 'invalid_command',
            message: `Command may not be valid: ${command}`,
            path
          });
        }
      }
    }

    // Validate PR template path
    if (config.git.pr_template) {
      const templatePath = path.resolve(this.options.workingDir, config.git.pr_template);
      if (!await fs.pathExists(templatePath)) {
        result.warnings.push({
          type: 'missing_pr_template',
          message: `PR template file not found: ${config.git.pr_template}`,
          path: 'git.pr_template'
        });
      }
    }

    // Validate notification settings
    if (config.notifications.email.enabled) {
      // Test SMTP settings would go here
      result.warnings.push({
        type: 'email_not_tested',
        message: 'Email configuration not tested during validation',
        path: 'notifications.email'
      });
    }
  }

  async validateTasks () {
    this.options.logger.debug('Validating tasks');

    const result = {
      valid: true,
      errors: [],
      warnings: []
    };

    try {
      const tasksPath = path.resolve(this.options.workingDir, this.options.tasksPath);

      if (!await fs.pathExists(tasksPath)) {
        result.valid = false;
        result.errors.push({
          type: 'tasks_file_missing',
          message: `Tasks file not found: ${tasksPath}`,
          path: this.options.tasksPath
        });
        return result;
      }

      // Load and parse tasks
      const fileContent = await fs.readFile(tasksPath, 'utf8');
      let tasksData;

      try {
        if (tasksPath.endsWith('.yaml') || tasksPath.endsWith('.yml')) {
          tasksData = YAML.parse(fileContent);
        } else {
          tasksData = JSON.parse(fileContent);
        }
      } catch (parseError) {
        result.valid = false;
        result.errors.push({
          type: 'tasks_parse_error',
          message: `Failed to parse tasks file: ${parseError.message}`,
          path: this.options.tasksPath
        });
        return result;
      }

      // Validate tasks structure
      if (!tasksData || !Array.isArray(tasksData.tasks)) {
        result.valid = false;
        result.errors.push({
          type: 'invalid_tasks_structure',
          message: 'Tasks file must contain a "tasks" array',
          path: 'tasks'
        });
        return result;
      }

      // Validate each task
      const taskIds = new Set();
      const totalEstimatedTime = tasksData.tasks.reduce((sum, task, index) => {
        // Check for required fields
        if (!task.id) {
          result.errors.push({
            type: 'missing_task_id',
            message: `Task at index ${index} is missing required 'id' field`,
            path: `tasks[${index}].id`
          });
          result.valid = false;
        } else {
          // Check for duplicate IDs
          if (taskIds.has(task.id)) {
            result.errors.push({
              type: 'duplicate_task_id',
              message: `Duplicate task ID: ${task.id}`,
              path: `tasks[${index}].id`
            });
            result.valid = false;
          }
          taskIds.add(task.id);
        }

        if (!task.title) {
          result.errors.push({
            type: 'missing_task_title',
            message: `Task ${task.id || index} is missing required 'title' field`,
            path: `tasks[${index}].title`
          });
          result.valid = false;
        }

        if (!task.requirements) {
          result.errors.push({
            type: 'missing_task_requirements',
            message: `Task ${task.id || index} is missing required 'requirements' field`,
            path: `tasks[${index}].requirements`
          });
          result.valid = false;
        }

        // Validate task type
        const validTypes = ['feature', 'bugfix', 'refactor', 'test', 'docs'];
        if (task.type && !validTypes.includes(task.type)) {
          result.warnings.push({
            type: 'invalid_task_type',
            message: `Task ${task.id || index} has invalid type: ${task.type}`,
            path: `tasks[${index}].type`
          });
        }

        // Validate estimated duration
        const duration = task.estimated_duration || 60;
        if (duration > 480) { // More than 8 hours
          result.warnings.push({
            type: 'long_task_duration',
            message: `Task ${task.id || index} has very long estimated duration: ${duration} minutes`,
            path: `tasks[${index}].estimated_duration`
          });
        }

        // Validate dependencies
        if (task.dependencies) {
          for (const depId of task.dependencies) {
            if (!taskIds.has(depId) && !tasksData.tasks.some(t => t.id === depId)) {
              result.warnings.push({
                type: 'missing_dependency',
                message: `Task ${task.id || index} depends on non-existent task: ${depId}`,
                path: `tasks[${index}].dependencies`
              });
            }
          }
        }

        // Validate file patterns
        if (task.files_to_modify) {
          for (const pattern of task.files_to_modify) {
            if (!this.isValidFilePattern(pattern)) {
              result.warnings.push({
                type: 'invalid_file_pattern',
                message: `Task ${task.id || index} has potentially unsafe file pattern: ${pattern}`,
                path: `tasks[${index}].files_to_modify`
              });
            }
          }
        }

        return sum + duration;
      }, 0);

      // Check total estimated time
      if (totalEstimatedTime > 480) { // More than 8 hours
        result.warnings.push({
          type: 'session_too_long',
          message: `Total estimated time (${totalEstimatedTime} minutes) exceeds 8 hours`,
          path: 'tasks'
        });
      }

      // Validate dependency cycles (simple check)
      try {
        this.detectDependencyCycles(tasksData.tasks);
      } catch (cycleError) {
        result.valid = false;
        result.errors.push({
          type: 'dependency_cycle',
          message: cycleError.message,
          path: 'tasks.dependencies'
        });
      }
    } catch (error) {
      result.valid = false;
      result.errors.push({
        type: 'tasks_validation_error',
        message: `Tasks validation failed: ${error.message}`,
        path: this.options.tasksPath
      });
    }

    return result;
  }

  detectDependencyCycles (tasks) {
    const graph = new Map();

    // Build adjacency list
    for (const task of tasks) {
      graph.set(task.id, task.dependencies || []);
    }

    // DFS to detect cycles
    const visited = new Set();
    const recursionStack = new Set();

    const hasCycle = (nodeId, path = []) => {
      if (recursionStack.has(nodeId)) {
        const cycle = path.slice(path.indexOf(nodeId)).concat(nodeId);
        throw new Error(`Circular dependency detected: ${cycle.join(' -> ')}`);
      }

      if (visited.has(nodeId)) {
        return false;
      }

      visited.add(nodeId);
      recursionStack.add(nodeId);
      path.push(nodeId);

      const dependencies = graph.get(nodeId) || [];
      for (const depId of dependencies) {
        if (graph.has(depId) && hasCycle(depId, [...path])) {
          return true;
        }
      }

      recursionStack.delete(nodeId);
      return false;
    };

    for (const task of tasks) {
      if (!visited.has(task.id)) {
        hasCycle(task.id);
      }
    }
  }

  async validateProject () {
    this.options.logger.debug('Validating project structure');

    const result = {
      valid: true,
      errors: [],
      warnings: []
    };

    try {
      // Detect project type and run appropriate validator
      let projectType = 'generic';

      for (const [type, validator] of Object.entries(this.projectValidators)) {
        if (type === 'generic') continue;

        if (await validator.detect()) {
          projectType = type;
          break;
        }
      }

      this.options.logger.debug('Detected project type', { projectType });

      const validator = this.projectValidators[projectType];
      const projectResult = await validator.validate();

      result.valid = projectResult.valid;
      result.errors.push(...projectResult.errors);
      result.warnings.push(...projectResult.warnings);

      // General project validations
      await this.performGeneralProjectValidations(result);
    } catch (error) {
      result.valid = false;
      result.errors.push({
        type: 'project_validation_error',
        message: `Project validation failed: ${error.message}`,
        path: 'project'
      });
    }

    return result;
  }

  async performGeneralProjectValidations (result) {
    // Check for common security issues
    const sensitiveFiles = ['.env', '.env.local', '.env.production', 'secrets.json', 'config/secrets.yml'];

    for (const file of sensitiveFiles) {
      if (await this.fileExists(file)) {
        result.warnings.push({
          type: 'sensitive_file_found',
          message: `Potentially sensitive file found: ${file}`,
          path: file
        });
      }
    }

    // Check for large files that might cause issues
    try {
      const files = await this.findLargeFiles();
      for (const file of files) {
        result.warnings.push({
          type: 'large_file_found',
          message: `Large file found (${Math.round(file.size / 1024 / 1024)}MB): ${file.path}`,
          path: file.path
        });
      }
    } catch (error) {
      this.options.logger.debug('Could not check for large files', { error: error.message });
    }

    // Check available disk space
    try {
      const freeSpace = await this.getAvailableDiskSpace();
      if (freeSpace < 1000000000) { // Less than 1GB
        result.warnings.push({
          type: 'low_disk_space',
          message: `Low disk space: ${Math.round(freeSpace / 1000000000)}GB available`,
          path: 'system'
        });
      }
    } catch (error) {
      this.options.logger.debug('Could not check disk space', { error: error.message });
    }
  }

  async validateNodejsProject () {
    const result = { valid: true, errors: [], warnings: [] };

    try {
      // Check package.json
      const packageJson = await this.loadJsonFile('package.json');

      if (!packageJson.name) {
        result.warnings.push({
          type: 'missing_package_name',
          message: 'package.json is missing name field',
          path: 'package.json.name'
        });
      }

      if (!packageJson.scripts) {
        result.warnings.push({
          type: 'no_npm_scripts',
          message: 'package.json has no scripts defined',
          path: 'package.json.scripts'
        });
      }

      // Check for lock files
      const lockFiles = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];
      const hasLockFile = await Promise.all(lockFiles.map(f => this.fileExists(f)));

      if (!hasLockFile.some(Boolean)) {
        result.warnings.push({
          type: 'no_lock_file',
          message: 'No package lock file found (package-lock.json, yarn.lock, or pnpm-lock.yaml)',
          path: 'package_locks'
        });
      }

      // Check Node.js version if .nvmrc exists
      if (await this.fileExists('.nvmrc')) {
        const nvmrc = await fs.readFile(path.join(this.options.workingDir, '.nvmrc'), 'utf8');
        const requiredVersion = nvmrc.trim();

        try {
          const nodeVersion = await this.executeCommand('node', ['--version']);
          const currentVersion = nodeVersion.stdout.trim();

          if (!currentVersion.includes(requiredVersion)) {
            result.warnings.push({
              type: 'node_version_mismatch',
              message: `Node.js version mismatch. Required: ${requiredVersion}, Current: ${currentVersion}`,
              path: '.nvmrc'
            });
          }
        } catch (error) {
          result.warnings.push({
            type: 'node_version_check_failed',
            message: 'Could not check Node.js version',
            path: 'node'
          });
        }
      }

      // Test npm install
      try {
        await this.executeCommand('npm', ['ls'], { timeout: 30000 });
      } catch (error) {
        result.warnings.push({
          type: 'npm_dependencies_issues',
          message: 'npm ls failed - there may be dependency issues',
          path: 'dependencies'
        });
      }
    } catch (error) {
      result.valid = false;
      result.errors.push({
        type: 'nodejs_validation_error',
        message: `Node.js project validation failed: ${error.message}`,
        path: 'nodejs'
      });
    }

    return result;
  }

  async validatePythonProject () {
    const result = { valid: true, errors: [], warnings: [] };

    try {
      // Check Python version
      try {
        const pythonVersion = await this.executeCommand('python', ['--version']);
        this.options.logger.debug('Python version', { version: pythonVersion.stdout.trim() });
      } catch (error) {
        try {
          const python3Version = await this.executeCommand('python3', ['--version']);
          this.options.logger.debug('Python3 version', { version: python3Version.stdout.trim() });
        } catch (error3) {
          result.warnings.push({
            type: 'python_not_found',
            message: 'Python interpreter not found in PATH',
            path: 'python'
          });
        }
      }

      // Check requirements files
      const reqFiles = ['requirements.txt', 'requirements-dev.txt', 'pyproject.toml', 'setup.py'];
      const hasReqFile = await Promise.all(reqFiles.map(f => this.fileExists(f)));

      if (!hasReqFile.some(Boolean)) {
        result.warnings.push({
          type: 'no_requirements_file',
          message: 'No requirements file found (requirements.txt, pyproject.toml, or setup.py)',
          path: 'requirements'
        });
      }

      // Check virtual environment
      const venvPaths = ['venv', '.venv', 'env', '.env'];
      const hasVenv = await Promise.all(venvPaths.map(p => this.fileExists(p)));

      if (!hasVenv.some(Boolean)) {
        result.warnings.push({
          type: 'no_virtual_environment',
          message: 'No virtual environment found - consider using venv',
          path: 'venv'
        });
      }
    } catch (error) {
      result.valid = false;
      result.errors.push({
        type: 'python_validation_error',
        message: `Python project validation failed: ${error.message}`,
        path: 'python'
      });
    }

    return result;
  }

  async validateGoProject () {
    const result = { valid: true, errors: [], warnings: [] };

    try {
      // Check Go version
      try {
        const goVersion = await this.executeCommand('go', ['version']);
        this.options.logger.debug('Go version', { version: goVersion.stdout.trim() });
      } catch (error) {
        result.warnings.push({
          type: 'go_not_found',
          message: 'Go compiler not found in PATH',
          path: 'go'
        });
      }

      // Validate go.mod
      const goMod = await fs.readFile(path.join(this.options.workingDir, 'go.mod'), 'utf8');

      if (!goMod.includes('module ')) {
        result.errors.push({
          type: 'invalid_go_mod',
          message: 'go.mod file is missing module declaration',
          path: 'go.mod'
        });
        result.valid = false;
      }

      // Test go mod tidy
      try {
        await this.executeCommand('go', ['mod', 'tidy'], { timeout: 30000 });
      } catch (error) {
        result.warnings.push({
          type: 'go_mod_issues',
          message: 'go mod tidy failed - there may be dependency issues',
          path: 'go.mod'
        });
      }
    } catch (error) {
      result.valid = false;
      result.errors.push({
        type: 'go_validation_error',
        message: `Go project validation failed: ${error.message}`,
        path: 'go'
      });
    }

    return result;
  }

  async validateRustProject () {
    const result = { valid: true, errors: [], warnings: [] };

    try {
      // Check Rust version
      try {
        const rustVersion = await this.executeCommand('rustc', ['--version']);
        this.options.logger.debug('Rust version', { version: rustVersion.stdout.trim() });
      } catch (error) {
        result.warnings.push({
          type: 'rust_not_found',
          message: 'Rust compiler not found in PATH',
          path: 'rust'
        });
      }

      // Validate Cargo.toml
      const cargoToml = await fs.readFile(path.join(this.options.workingDir, 'Cargo.toml'), 'utf8');

      if (!cargoToml.includes('[package]')) {
        result.errors.push({
          type: 'invalid_cargo_toml',
          message: 'Cargo.toml is missing [package] section',
          path: 'Cargo.toml'
        });
        result.valid = false;
      }

      // Test cargo check
      try {
        await this.executeCommand('cargo', ['check'], { timeout: 60000 });
      } catch (error) {
        result.warnings.push({
          type: 'cargo_check_failed',
          message: 'cargo check failed - there may be compilation issues',
          path: 'cargo'
        });
      }
    } catch (error) {
      result.valid = false;
      result.errors.push({
        type: 'rust_validation_error',
        message: `Rust project validation failed: ${error.message}`,
        path: 'rust'
      });
    }

    return result;
  }

  async validateGenericProject () {
    const result = { valid: true, errors: [], warnings: [] };

    // Basic checks for any project
    const commonFiles = ['README.md', 'README.txt', 'LICENSE', 'LICENSE.txt'];
    const hasReadme = await Promise.all(commonFiles.map(f => this.fileExists(f)));

    if (!hasReadme.some(Boolean)) {
      result.warnings.push({
        type: 'no_readme',
        message: 'No README file found',
        path: 'readme'
      });
    }

    return result;
  }

  async validateEnvironment () {
    this.options.logger.debug('Validating environment');

    const result = {
      valid: true,
      errors: [],
      warnings: []
    };

    try {
      // Check Claude Code CLI
      try {
        const claudeVersion = await this.executeCommand('claude', ['--version']);
        this.options.logger.debug('Claude Code version', { version: claudeVersion.stdout.trim() });
      } catch (error) {
        result.valid = false;
        result.errors.push({
          type: 'claude_code_not_found',
          message: 'claude CLI not found in PATH',
          path: 'claude'
        });
      }

      // Check Git
      try {
        const gitVersion = await this.executeCommand('git', ['--version']);
        this.options.logger.debug('Git version', { version: gitVersion.stdout.trim() });
      } catch (error) {
        result.valid = false;
        result.errors.push({
          type: 'git_not_found',
          message: 'git not found in PATH',
          path: 'git'
        });
      }

      // Check GitHub CLI (optional but recommended)
      try {
        const ghVersion = await this.executeCommand('gh', ['--version']);
        this.options.logger.debug('GitHub CLI version', { version: ghVersion.stdout.trim() });
      } catch (error) {
        result.warnings.push({
          type: 'gh_cli_not_found',
          message: 'GitHub CLI (gh) not found - PR creation will be disabled',
          path: 'gh'
        });
      }

      // Check system resources
      try {
        const memInfo = await this.getSystemMemory();
        if (memInfo.available < 2000000000) { // Less than 2GB
          result.warnings.push({
            type: 'low_memory',
            message: `Low available memory: ${Math.round(memInfo.available / 1000000000)}GB`,
            path: 'system.memory'
          });
        }
      } catch (error) {
        this.options.logger.debug('Could not check system memory', { error: error.message });
      }

      // Check network connectivity
      try {
        await this.executeCommand('ping', ['-c', '1', 'github.com'], { timeout: 5000 });
      } catch (error) {
        result.warnings.push({
          type: 'network_connectivity',
          message: 'Network connectivity test failed - remote operations may not work',
          path: 'network'
        });
      }
    } catch (error) {
      result.valid = false;
      result.errors.push({
        type: 'environment_validation_error',
        message: `Environment validation failed: ${error.message}`,
        path: 'environment'
      });
    }

    return result;
  }

  async attemptFix (errors) {
    this.options.logger.info('Attempting to fix validation errors', { errorCount: errors.length });

    const fixResult = {
      fixed: 0,
      remaining: 0,
      details: []
    };

    for (const error of errors) {
      try {
        const fixed = await this.fixError(error);
        if (fixed) {
          fixResult.fixed++;
          fixResult.details.push(`Fixed: ${error.message}`);
        } else {
          fixResult.remaining++;
        }
      } catch (fixError) {
        fixResult.remaining++;
        this.options.logger.warn('Failed to fix error', {
          error: error.message,
          fixError: fixError.message
        });
      }
    }

    this.options.logger.info('Fix attempt completed', fixResult);
    return fixResult;
  }

  async fixError (error) {
    switch (error.type) {
      case 'no_lock_file':
        if (await this.fileExists('package.json')) {
          await this.executeCommand('npm', ['install']);
          return true;
        }
        break;

      case 'no_requirements_file':
        // Create basic requirements.txt
        await fs.writeFile(
          path.join(this.options.workingDir, 'requirements.txt'),
          '# Add your Python dependencies here\\n'
        );
        return true;

      case 'no_readme':
        // Create basic README
        const projectName = path.basename(this.options.workingDir);
        const readme = `# ${projectName}

## Description
Add project description here.

## Setup
Add setup instructions here.

## Usage
Add usage instructions here.
`;
        await fs.writeFile(path.join(this.options.workingDir, 'README.md'), readme);
        return true;

      default:
        return false;
    }

    return false;
  }

  // Utility methods

  async loadConfig () {
    const configPath = path.resolve(this.options.workingDir, this.options.configPath);

    if (!await fs.pathExists(configPath)) {
      throw new Error(`Configuration file not found: ${configPath}`);
    }

    const content = await fs.readFile(configPath, 'utf8');

    if (configPath.endsWith('.yaml') || configPath.endsWith('.yml')) {
      return YAML.parse(content);
    } else {
      return JSON.parse(content);
    }
  }

  async loadJsonFile (filename) {
    const filePath = path.join(this.options.workingDir, filename);
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  }

  async fileExists (filename) {
    return await fs.pathExists(path.join(this.options.workingDir, filename));
  }

  isValidFilePattern (pattern) {
    // Basic validation for file patterns
    const invalidChars = /[<>:"|?*]/;
    if (invalidChars.test(pattern)) {
      return false;
    }

    // Check for dangerous patterns
    const dangerousPatterns = [
      /\.\.\//, // Directory traversal
      /^\//, // Absolute paths
      /~/ // Home directory
    ];

    return !dangerousPatterns.some(p => p.test(pattern));
  }

  async validateCommand (command) {
    try {
      const parts = command.split(' ');
      const cmd = parts[0];

      // Check if command exists
      return await this.commandExists(cmd);
    } catch (error) {
      return false;
    }
  }

  async commandExists (command) {
    try {
      await this.executeCommand('which', [command]);
      return true;
    } catch (error) {
      try {
        await this.executeCommand('where', [command]); // Windows
        return true;
      } catch (error2) {
        return false;
      }
    }
  }

  async findLargeFiles (sizeThreshold = 100 * 1024 * 1024) { // 100MB default
    const largeFiles = [];

    const searchDir = async (dir) => {
      try {
        const items = await fs.readdir(dir, { withFileTypes: true });

        for (const item of items) {
          const fullPath = path.join(dir, item.name);

          if (item.isDirectory() && !item.name.startsWith('.')) {
            await searchDir(fullPath);
          } else if (item.isFile()) {
            const stats = await fs.stat(fullPath);
            if (stats.size > sizeThreshold) {
              largeFiles.push({
                path: path.relative(this.options.workingDir, fullPath),
                size: stats.size
              });
            }
          }
        }
      } catch (error) {
        // Skip directories we can't read
      }
    };

    await searchDir(this.options.workingDir);
    return largeFiles;
  }

  async getAvailableDiskSpace () {
    try {
      const result = await this.executeCommand('df', ['-B1', this.options.workingDir]);
      const lines = result.stdout.trim().split('\\n');
      const spaceLine = lines[1] || lines[0];
      const available = parseInt(spaceLine.split(/\\s+/)[3] || '0');
      return available;
    } catch (error) {
      // Try Windows version
      try {
        const result = await this.executeCommand('fsutil', ['volume', 'diskfree', this.options.workingDir]);
        const match = result.stdout.match(/Total free bytes\\s*:\\s*(\\d+)/);
        return match ? parseInt(match[1]) : Number.MAX_SAFE_INTEGER;
      } catch (error2) {
        return Number.MAX_SAFE_INTEGER; // Assume unlimited if check fails
      }
    }
  }

  async getSystemMemory () {
    try {
      const result = await this.executeCommand('free', ['-b']);
      const lines = result.stdout.trim().split('\\n');
      const memLine = lines[1];
      const parts = memLine.split(/\\s+/);

      return {
        total: parseInt(parts[1]),
        available: parseInt(parts[6] || parts[3])
      };
    } catch (error) {
      // Try macOS version
      try {
        const result = await this.executeCommand('vm_stat');
        // Parse vm_stat output would go here
        return { total: 8000000000, available: 4000000000 }; // Default assumption
      } catch (error2) {
        return { total: 8000000000, available: 4000000000 }; // Default assumption
      }
    }
  }

  async executeCommand (command, args = [], options = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd || this.options.workingDir,
        stdio: 'pipe'
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Command timed out: ${command} ${args.join(' ')}`));
      }, options.timeout || 30000);

      child.on('close', (code) => {
        clearTimeout(timeout);

        if (code === 0 || options.allowNonZeroExit) {
          resolve({ stdout, stderr, code });
        } else {
          reject(new Error(`Command failed with code ${code}: ${stderr || stdout}`));
        }
      });

      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }
}

module.exports = { Validator };
