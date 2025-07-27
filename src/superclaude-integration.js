const fs = require('fs-extra');
const path = require('path');
const YAML = require('yaml');

class SuperClaudeIntegration {
  constructor (options = {}) {
    this.options = {
      commandsPath: options.commandsPath, // Can be undefined
      workingDir: options.workingDir || process.cwd(),
      logger: options.logger || console,
      enabled: options.enabled || false
    };

    this.commands = new Map();
    this.loadedCommands = false;
    this.useGlobalCommands = !this.options.commandsPath; // Use global commands if no path specified
  }

  async initialize () {
    if (!this.options.enabled) {
      this.options.logger.debug('SuperClaude integration disabled');
      return;
    }

    this.options.logger.info('🧠 Initializing SuperClaude Framework integration...');

    try {
      await this.loadCommands();
      const commandSource = this.useGlobalCommands
        ? 'global commands'
        : `local commands from ${this.options.commandsPath}`;
      this.options.logger.info(`✅ SuperClaude integration initialized with ${this.commands.size} ${commandSource}`);
    } catch (error) {
      this.options.logger.warn(`⚠️  SuperClaude initialization failed: ${error.message}`);
      this.options.enabled = false;
    }
  }

  async loadCommands () {
    if (this.useGlobalCommands) {
      // When no commands_path is specified, assume SuperClaude slash commands are globally available
      this.options.logger.debug('Using globally installed SuperClaude commands (no commands_path specified)');
      this.loadGlobalCommands();
      this.loadedCommands = true;
      return;
    }

    const commandsDir = path.resolve(this.options.workingDir, this.options.commandsPath);

    if (!(await fs.pathExists(commandsDir))) {
      throw new Error(`SuperClaude commands directory not found: ${commandsDir}`);
    }

    const commandFiles = await fs.readdir(commandsDir);
    const mdFiles = commandFiles.filter(file => file.endsWith('.md'));

    this.options.logger.debug(`Loading ${mdFiles.length} SuperClaude command files...`);

    for (const file of mdFiles) {
      try {
        const commandPath = path.join(commandsDir, file);
        const content = await fs.readFile(commandPath, 'utf8');
        const command = this.parseCommandFile(content, file);

        if (command) {
          this.commands.set(command.name, command);
          this.options.logger.debug(`Loaded SuperClaude command: ${command.name}`);
        }
      } catch (error) {
        this.options.logger.warn(`Failed to load command file ${file}: ${error.message}`);
      }
    }

    this.loadedCommands = true;
  }

  loadGlobalCommands () {
    // Define standard SuperClaude commands when no local commands directory is provided
    const globalCommands = [
      {
        name: 'analyze',
        description: 'Multi-dimensional code and system analysis',
        allowedTools: ['Read', 'Grep', 'Glob', 'Bash', 'TodoWrite'],
        metadata: { category: 'analysis', 'wave-enabled': true }
      },
      {
        name: 'build',
        description: 'Project builder with framework detection',
        allowedTools: ['Read', 'Grep', 'Glob', 'Bash', 'TodoWrite', 'Edit', 'MultiEdit'],
        metadata: { category: 'development', 'wave-enabled': true }
      },
      {
        name: 'implement',
        description: 'Feature and code implementation with intelligent persona activation',
        allowedTools: ['Read', 'Write', 'Edit', 'MultiEdit', 'Bash', 'Glob', 'TodoWrite', 'Task'],
        metadata: { category: 'development', 'wave-enabled': true }
      },
      {
        name: 'improve',
        description: 'Evidence-based code enhancement',
        allowedTools: ['Read', 'Grep', 'Glob', 'Edit', 'MultiEdit', 'Bash'],
        metadata: { category: 'quality', 'wave-enabled': true }
      },
      {
        name: 'design',
        description: 'Design orchestration',
        allowedTools: ['Read', 'Write', 'Edit', 'TodoWrite'],
        metadata: { category: 'planning', 'wave-enabled': true }
      },
      {
        name: 'test',
        description: 'Testing workflows',
        allowedTools: ['Read', 'Bash', 'TodoWrite'],
        metadata: { category: 'quality' }
      },
      {
        name: 'document',
        description: 'Documentation generation',
        allowedTools: ['Read', 'Write', 'Edit', 'Grep'],
        metadata: { category: 'documentation' }
      },
      {
        name: 'troubleshoot',
        description: 'Problem investigation',
        allowedTools: ['Read', 'Grep', 'Glob', 'Bash'],
        metadata: { category: 'analysis' }
      },
      {
        name: 'cleanup',
        description: 'Project cleanup and technical debt reduction',
        allowedTools: ['Read', 'Edit', 'MultiEdit', 'Bash'],
        metadata: { category: 'quality' }
      },
      {
        name: 'git',
        description: 'Git workflow assistant',
        allowedTools: ['Bash', 'Read', 'Write'],
        metadata: { category: 'version-control' }
      }
    ];

    for (const command of globalCommands) {
      this.commands.set(command.name, {
        ...command,
        sections: {
          description: command.description,
          execution: 'Follow SuperClaude framework patterns with intelligent tool orchestration.',
          quality_standards: 'Apply comprehensive quality gates and validation.'
        }
      });
      this.options.logger.debug(`Loaded global SuperClaude command: ${command.name}`);
    }
  }

  parseCommandFile (content, filename) {
    const commandName = path.basename(filename, '.md');

    // Parse YAML frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    let metadata = {};

    if (frontmatterMatch) {
      try {
        metadata = YAML.parse(frontmatterMatch[1]);
      } catch (error) {
        this.options.logger.warn(`Invalid YAML frontmatter in ${filename}: ${error.message}`);
      }
    }

    // Extract command content
    const contentWithoutFrontmatter = frontmatterMatch
      ? content.substring(frontmatterMatch[0].length)
      : content;

    // Parse key sections
    const sections = this.parseMarkdownSections(contentWithoutFrontmatter);

    return {
      name: commandName,
      metadata,
      sections,
      allowedTools: metadata['allowed-tools'] || [],
      description: metadata.description || '',
      argumentHint: metadata['argument-hint'] || '',
      content: contentWithoutFrontmatter.trim()
    };
  }

  parseMarkdownSections (content) {
    const sections = {};
    const lines = content.split('\n');
    let currentSection = null;
    let currentContent = [];

    for (const line of lines) {
      const headerMatch = line.match(/^#+\s+(.+)/);

      if (headerMatch) {
        // Save previous section
        if (currentSection) {
          sections[currentSection] = currentContent.join('\n').trim();
        }

        // Start new section
        currentSection = headerMatch[1].toLowerCase().replace(/[^a-z0-9]/g, '_');
        currentContent = [];
      } else if (currentSection) {
        currentContent.push(line);
      }
    }

    // Save last section
    if (currentSection) {
      sections[currentSection] = currentContent.join('\n').trim();
    }

    return sections;
  }

  async planTask (task) {
    if (!this.options.enabled || !this.loadedCommands) {
      return null;
    }

    this.options.logger.info(`🧠 Planning task with SuperClaude Framework: ${task.title}`);

    // With optimizePromptWithSuperClaude, command selection is handled automatically
    // Simply return the task for optimization by the orchestrator
    return {
      taskId: task.id,
      title: task.title,
      type: task.type,
      requirements: task.requirements || '',
      tags: task.tags || [],
      ready: true
    };
  }

  isEnabled () {
    return this.options.enabled && this.loadedCommands;
  }

  getAvailableCommands () {
    return Array.from(this.commands.keys());
  }

  getCommand (name) {
    return this.commands.get(name);
  }
}

module.exports = { SuperClaudeIntegration };
