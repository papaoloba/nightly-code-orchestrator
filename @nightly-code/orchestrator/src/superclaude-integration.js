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
      const commandSource = this.useGlobalCommands ? 'global commands' : `local commands from ${this.options.commandsPath}`;
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

    // Analyze task to determine appropriate SuperClaude command
    const command = this.selectCommandForTask(task);

    if (!command) {
      this.options.logger.debug(`No suitable SuperClaude command found for task: ${task.id}`);
      return null;
    }

    this.options.logger.info(`📋 Selected SuperClaude command: /${command.name}`);

    // Generate SuperClaude-enhanced prompt
    const plan = await this.generateTaskPlan(task, command);

    return plan;
  }

  selectCommandForTask (task) {
    const taskType = task.type?.toLowerCase();
    const taskTags = task.tags || [];
    const taskTitle = task.title?.toLowerCase() || '';
    const taskRequirements = task.requirements?.toLowerCase() || '';

    // Command selection logic based on task characteristics
    const commandScores = new Map();

    for (const [commandName, command] of this.commands) {
      let score = 0;

      // Direct type matches
      if (commandName === taskType) score += 10;

      // Keyword matching in title and requirements
      const keywords = this.extractKeywords(command);
      for (const keyword of keywords) {
        if (taskTitle.includes(keyword)) score += 3;
        if (taskRequirements.includes(keyword)) score += 2;
        if (taskTags.includes(keyword)) score += 4;
      }

      // Special scoring for common patterns
      if (commandName === 'implement' && (taskType === 'feature' || taskTitle.includes('implement'))) {
        score += 8;
      }

      if (commandName === 'analyze' && (taskType === 'bugfix' || taskTitle.includes('debug') || taskTitle.includes('investigate'))) {
        score += 8;
      }

      if (commandName === 'improve' && (taskType === 'refactor' || taskTitle.includes('refactor') || taskTitle.includes('optimize'))) {
        score += 8;
      }

      if (commandName === 'test' && (taskType === 'test' || taskTags.includes('testing'))) {
        score += 8;
      }

      if (commandName === 'document' && (taskType === 'docs' || taskTags.includes('documentation'))) {
        score += 8;
      }

      if (score > 0) {
        commandScores.set(commandName, score);
      }
    }

    // Return command with highest score
    if (commandScores.size === 0) return null;

    const bestCommand = [...commandScores.entries()]
      .sort(([, a], [, b]) => b - a)[0][0];

    this.options.logger.debug(`Command selection scores: ${JSON.stringify([...commandScores.entries()])}`);
    this.options.logger.debug(`Selected best command: ${bestCommand} (score: ${commandScores.get(bestCommand)})`);

    return this.commands.get(bestCommand);
  }

  extractKeywords (command) {
    const keywords = [];

    // Extract keywords from description and sections
    const text = `${command.description} ${Object.values(command.sections).join(' ')}`.toLowerCase();

    // Common keywords that indicate command purpose
    const patterns = [
      /\b(implement|build|create|develop|code|generate)\b/g,
      /\b(analyze|investigation|debug|troubleshoot|examine)\b/g,
      /\b(improve|optimize|refactor|enhance|cleanup)\b/g,
      /\b(test|testing|validation|quality)\b/g,
      /\b(document|documentation|guide|readme)\b/g,
      /\b(api|component|feature|service|system)\b/g,
      /\b(security|performance|architecture|design)\b/g
    ];

    for (const pattern of patterns) {
      const matches = text.match(pattern);
      if (matches) {
        keywords.push(...matches.map(match => match.trim()));
      }
    }

    return [...new Set(keywords)]; // Remove duplicates
  }

  async generateTaskPlan (task, command) {
    const plan = {
      superclaudeCommand: command.name,
      commandDescription: command.description,
      enhancedPrompt: await this.generateEnhancedPrompt(task, command),
      tools: command.allowedTools,
      executionStrategy: this.determineExecutionStrategy(task, command),
      qualityGates: this.defineQualityGates(task, command)
    };

    this.options.logger.debug(`Generated SuperClaude plan for task ${task.id}:`, {
      command: plan.superclaudeCommand,
      strategy: plan.executionStrategy,
      tools: plan.tools.length
    });

    return plan;
  }

  async generateEnhancedPrompt (task, command) {
    const basePrompt = `# SuperClaude ${command.name} Command
    
## Command: /${command.name}
${command.description}

## Task Integration
**Task ID:** ${task.id}
**Task Type:** ${task.type}
**Task Title:** ${task.title}
**Priority:** ${task.priority}

## Requirements
${task.requirements}

## Acceptance Criteria
${task.acceptance_criteria?.map(criteria => `- ${criteria}`).join('\n') || 'None specified'}

## SuperClaude Integration
**Allowed Tools:** ${command.allowedTools.join(', ')}
**Estimated Duration:** ${task.estimated_duration || 60} minutes
**Files to Modify:** ${task.files_to_modify?.join(', ') || 'Any relevant files'}

## Command-Specific Instructions
${command.sections.execution || command.sections.instructions || 'Follow standard SuperClaude framework patterns'}

## Quality and Validation
${command.sections.quality_standards || 'Apply standard quality gates and validation'}

Execute this task using SuperClaude framework patterns with intelligent tool orchestration and expert persona activation.`;

    return basePrompt;
  }

  determineExecutionStrategy (task, command) {
    const strategy = {
      mode: 'assisted', // assisted, autonomous, guided
      complexity: this.assessTaskComplexity(task),
      personaActivation: this.determinePersonas(task, command),
      toolOrchestration: this.planToolUsage(command),
      qualityLevel: this.determineQualityLevel(task)
    };

    // Adjust strategy based on task characteristics
    if (strategy.complexity > 0.7) {
      strategy.mode = 'guided';
    } else if (strategy.complexity < 0.3) {
      strategy.mode = 'autonomous';
    }

    return strategy;
  }

  assessTaskComplexity (task) {
    let complexity = 0.3; // Base complexity

    // Duration-based complexity
    const duration = task.estimated_duration || 60;
    if (duration > 180) complexity += 0.3;
    else if (duration > 90) complexity += 0.2;
    else if (duration > 45) complexity += 0.1;

    // File count complexity
    const fileCount = task.files_to_modify?.length || 1;
    if (fileCount > 10) complexity += 0.2;
    else if (fileCount > 5) complexity += 0.1;

    // Dependency complexity
    const depCount = task.dependencies?.length || 0;
    complexity += depCount * 0.05;

    // Criteria complexity
    const criteriaCount = task.acceptance_criteria?.length || 0;
    complexity += Math.min(criteriaCount * 0.02, 0.1);

    // Tag-based complexity
    const complexTags = ['security', 'performance', 'architecture', 'integration'];
    const hasComplexTags = task.tags?.some(tag => complexTags.includes(tag));
    if (hasComplexTags) complexity += 0.1;

    return Math.min(complexity, 1.0);
  }

  determinePersonas (task, command) {
    const personas = [];
    const taskType = task.type?.toLowerCase();
    const tags = task.tags || [];

    // Primary persona based on task type
    if (taskType === 'feature') personas.push('architect', 'frontend', 'backend');
    if (taskType === 'bugfix') personas.push('analyzer');
    if (taskType === 'refactor') personas.push('refactorer', 'architect');
    if (taskType === 'test') personas.push('qa');
    if (taskType === 'docs') personas.push('scribe');

    // Secondary personas based on tags
    if (tags.includes('security')) personas.push('security');
    if (tags.includes('performance')) personas.push('performance');
    if (tags.includes('frontend') || tags.includes('ui')) personas.push('frontend');
    if (tags.includes('backend') || tags.includes('api')) personas.push('backend');
    if (tags.includes('architecture')) personas.push('architect');

    return [...new Set(personas)]; // Remove duplicates
  }

  planToolUsage (command) {
    const tools = command.allowedTools || [];
    const plan = {
      primary: [],
      secondary: [],
      sequence: 'parallel' // parallel, sequential, adaptive
    };

    // Categorize tools by usage pattern
    const analysisTools = ['Read', 'Grep', 'Glob'];
    const modificationTools = ['Write', 'Edit', 'MultiEdit'];
    const executionTools = ['Bash'];
    const coordinationTools = ['Task', 'TodoWrite'];

    plan.primary = tools.filter(tool =>
      modificationTools.includes(tool) || analysisTools.includes(tool)
    );
    plan.secondary = tools.filter(tool =>
      executionTools.includes(tool) || coordinationTools.includes(tool)
    );

    // Determine sequence based on tool mix
    if (tools.includes('TodoWrite') || tools.includes('Task')) {
      plan.sequence = 'sequential';
    } else if (analysisTools.some(tool => tools.includes(tool)) &&
               modificationTools.some(tool => tools.includes(tool))) {
      plan.sequence = 'adaptive';
    }

    return plan;
  }

  determineQualityLevel (task) {
    const priority = task.priority || 5;
    const type = task.type?.toLowerCase();

    if (priority >= 9 || type === 'security') return 'critical';
    if (priority >= 7 || type === 'bugfix') return 'high';
    if (priority >= 5) return 'standard';
    return 'basic';
  }

  defineQualityGates (task, command) {
    const gates = {
      preExecution: [],
      postExecution: [],
      validation: []
    };

    // Standard quality gates
    gates.preExecution.push('task_analysis', 'tool_availability');
    gates.postExecution.push('file_validation', 'syntax_check');
    gates.validation.push('acceptance_criteria_check');

    // Command-specific gates
    if (command.name === 'implement') {
      gates.postExecution.push('integration_test', 'security_scan');
    }

    if (command.name === 'test') {
      gates.validation.push('test_coverage_check', 'test_execution');
    }

    if (command.name === 'document') {
      gates.validation.push('documentation_completeness', 'accessibility_check');
    }

    // Task-specific gates based on type and priority
    if (task.type === 'security' || task.priority >= 8) {
      gates.validation.push('security_audit', 'vulnerability_scan');
    }

    if (task.custom_validation?.script) {
      gates.validation.push('custom_validation');
    }

    return gates;
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
