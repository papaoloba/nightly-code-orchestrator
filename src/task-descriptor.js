const yaml = require('yaml');

class TaskDescriptor {
  constructor () {
    this.taskTypes = {
      feature: { priority: 6, duration: 120 },
      bugfix: { priority: 8, duration: 90 },
      refactor: { priority: 5, duration: 150 },
      test: { priority: 6, duration: 120 },
      docs: { priority: 3, duration: 60 },
      performance: { priority: 7, duration: 120 },
      security: { priority: 9, duration: 120 }
    };

    // Thresholds for automatic task splitting
    this.splitThresholds = {
      maxLength: 500, // characters
      maxComplexity: 8, // complexity score
      maxDuration: 300 // minutes
    };

    this.priorityKeywords = {
      critical: 9,
      urgent: 9,
      high: 8,
      medium: 5,
      low: 3,
      optional: 2
    };

    this.tags = {
      backend: ['api', 'server', 'database', 'endpoint', 'service', 'auth', 'authentication'],
      frontend: ['ui', 'component', 'react', 'vue', 'interface', 'display', 'form', 'button'],
      security: ['auth', 'authentication', 'encrypt', 'security', 'vulnerability', 'permission'],
      performance: ['optimize', 'performance', 'speed', 'memory', 'cache', 'bottleneck'],
      testing: ['test', 'testing', 'unit', 'integration', 'e2e', 'coverage'],
      documentation: ['doc', 'documentation', 'readme', 'guide', 'api docs', 'comment'],
      refactor: ['refactor', 'cleanup', 'reorganize', 'improve', 'maintainability'],
      bugfix: ['fix', 'bug', 'issue', 'error', 'crash', 'problem'],
      feature: ['implement', 'add', 'create', 'feature', 'functionality', 'capability']
    };
  }

  /**
   * Parse natural language description into structured task(s) with automatic splitting
   * @param {string} description - Natural language task description
   * @returns {Array|Object} Array of tasks if split, single task object otherwise
   */
  parseDescription (description) {
    // Check if description should be split into multiple tasks
    const shouldSplit = this.shouldSplitTask(description);

    if (shouldSplit) {
      return this.splitTaskDescription(description);
    }

    return this.parseSingleDescription(description);
  }

  /**
   * Parse a single task description
   * @param {string} description - Natural language task description
   * @returns {Object} Structured task object
   */
  parseSingleDescription (description) {
    const lowerDesc = description.toLowerCase();

    // Detect task type
    const taskType = this.detectTaskType(lowerDesc);

    // Extract priority
    const priority = this.extractPriority(lowerDesc);

    // Extract tags
    const tags = this.extractTags(lowerDesc);

    // Generate title
    const title = this.generateTitle(description, taskType);

    // Extract requirements and acceptance criteria
    const { requirements, acceptanceCriteria } = this.parseRequirements(description);

    // Estimate duration
    const estimatedDuration = this.estimateDuration(description, taskType);

    // Extract file patterns
    const filesToModify = this.extractFilePaths(description);

    return {
      id: this.generateMeaningfulTaskId(title, taskType),
      type: taskType,
      priority,
      title,
      requirements,
      acceptance_criteria: acceptanceCriteria,
      estimated_duration: estimatedDuration,
      dependencies: [],
      tags,
      files_to_modify: filesToModify,
      enabled: true
    };
  }

  detectTaskType (description) {
    for (const [type, keywords] of Object.entries(this.tags)) {
      if (keywords.some(keyword => description.includes(keyword))) {
        // Map tag types to task types
        const typeMap = {
          bugfix: 'bugfix',
          feature: 'feature',
          refactor: 'refactor',
          testing: 'test',
          documentation: 'docs',
          performance: 'refactor',
          security: 'feature'
        };
        return typeMap[type] || 'feature';
      }
    }
    return 'feature'; // Default
  }

  extractPriority (description) {
    for (const [keyword, value] of Object.entries(this.priorityKeywords)) {
      if (description.includes(keyword)) {
        return value;
      }
    }

    // Check for specific indicators
    if (description.includes('asap') || description.includes('immediately')) {
      return 9;
    }

    return 5; // Default medium priority
  }

  extractTags (description) {
    const foundTags = [];

    for (const [tag, keywords] of Object.entries(this.tags)) {
      if (keywords.some(keyword => description.includes(keyword))) {
        foundTags.push(tag);
      }
    }

    return [...new Set(foundTags)]; // Remove duplicates
  }

  generateTitle (description, taskType) {
    // Extract first sentence or up to 80 characters
    const firstSentence = description.split(/[.!?]/)[0].trim();
    const title = firstSentence.length > 80
      ? `${firstSentence.substring(0, 77)}...`
      : firstSentence;

    // Capitalize first letter
    return title.charAt(0).toUpperCase() + title.slice(1);
  }

  parseRequirements (description) {
    const lines = description.split('\n').map(line => line.trim()).filter(line => line);

    let requirements = [];
    let acceptanceCriteria = [];
    let currentSection = 'requirements';

    for (const line of lines) {
      // Check for section markers
      if (line.toLowerCase().includes('acceptance') ||
          line.toLowerCase().includes('criteria') ||
          line.toLowerCase().includes('should') ||
          line.toLowerCase().includes('must')) {
        currentSection = 'criteria';
      }

      // Extract bullet points or numbered items
      if (line.match(/^[-*•]\s/) || line.match(/^\d+[.)]\s/)) {
        const item = line.replace(/^[-*•]\s/, '').replace(/^\d+[.)]\s/, '').trim();

        if (currentSection === 'criteria') {
          acceptanceCriteria.push(item);
        } else {
          requirements.push(item);
        }
      }
    }

    // If no structured items found, use the full description as requirements
    if (requirements.length === 0) {
      requirements = description;
    } else {
      requirements = requirements.join('\n');
    }

    // Generate acceptance criteria if none found
    if (acceptanceCriteria.length === 0) {
      acceptanceCriteria = this.generateAcceptanceCriteria(description);
    }

    return { requirements, acceptanceCriteria };
  }

  generateAcceptanceCriteria (description) {
    const criteria = [];

    // Extract action items
    const actionWords = ['implement', 'add', 'create', 'fix', 'update', 'refactor', 'test'];

    for (const word of actionWords) {
      const regex = new RegExp(`${word}\\s+([^,.]+)`, 'gi');
      const matches = description.matchAll(regex);

      for (const match of matches) {
        criteria.push(`${word.charAt(0).toUpperCase() + word.slice(1)} ${match[1].trim()} is completed`);
      }
    }

    // Add standard criteria based on task type
    if (description.includes('test')) {
      criteria.push('All tests pass successfully');
      criteria.push('Test coverage meets requirements');
    }

    if (description.includes('api') || description.includes('endpoint')) {
      criteria.push('API endpoints return proper HTTP status codes');
      criteria.push('API documentation is updated');
    }

    if (description.includes('ui') || description.includes('component')) {
      criteria.push('UI components render correctly');
      criteria.push('User interactions work as expected');
    }

    // Always add these
    criteria.push('Code follows project conventions');
    criteria.push('No regression issues introduced');

    return criteria;
  }

  estimateDuration (description, taskType) {
    const baseDuration = this.taskTypes[taskType]?.duration || 120;

    // Adjust based on complexity indicators
    let multiplier = 1;

    if (description.includes('complex') || description.includes('comprehensive')) {
      multiplier *= 1.5;
    }

    if (description.includes('simple') || description.includes('minor')) {
      multiplier *= 0.7;
    }

    // Count number of features/items
    const itemCount = (description.match(/[-*]\s/g) || []).length;
    if (itemCount > 5) {
      multiplier *= 1.3;
    }

    return Math.round(baseDuration * multiplier);
  }

  extractFilePaths (description) {
    const filePaths = [];

    // Look for file path patterns
    const pathRegex = /(?:src\/|test\/|lib\/|components\/|pages\/|api\/|routes\/)[^\s,]+/g;
    const matches = description.matchAll(pathRegex);

    for (const match of matches) {
      filePaths.push(match[0]);
    }

    // Add common paths based on keywords
    if (description.includes('api') || description.includes('endpoint')) {
      filePaths.push('src/api/', 'src/routes/');
    }

    if (description.includes('component') || description.includes('ui')) {
      filePaths.push('src/components/');
    }

    if (description.includes('test')) {
      filePaths.push('test/', 'src/__tests__/');
    }

    return [...new Set(filePaths)]; // Remove duplicates
  }

  /**
   * Generate meaningful task ID based on title and type
   * @param {string} title - Task title
   * @param {string} type - Task type
   * @returns {string} Meaningful task ID
   */
  generateMeaningfulTaskId (title, type) {
    // Extract key words from title
    const titleWords = title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '') // Remove special chars
      .split(/\s+/)
      .filter(word => word.length > 2) // Filter short words
      .slice(0, 3); // Take first 3 meaningful words

    const titlePart = titleWords.join('-') || 'task';
    const timestamp = Date.now().toString().slice(-6); // Last 6 digits

    return `${type}-${titlePart}-${timestamp}`;
  }

  /**
   * Check if a task description should be split into multiple tasks
   * @param {string} description - Task description
   * @returns {boolean} Whether to split the task
   */
  shouldSplitTask (description) {
    // Check length threshold
    if (description.length > this.splitThresholds.maxLength) {
      return true;
    }

    // Check for multiple distinct tasks (bullet points, numbered lists)
    const bulletPoints = (description.match(/^\s*[-*•]\s/gm) || []).length;
    const numberedItems = (description.match(/^\s*\d+[.)]/gm) || []).length;
    const distinctTasks = Math.max(bulletPoints, numberedItems);

    if (distinctTasks > 3) {
      return true;
    }

    // Check for multiple domains/areas
    const domainCount = Object.keys(this.tags).filter(domain =>
      this.tags[domain].some(keyword => description.toLowerCase().includes(keyword))
    ).length;

    if (domainCount > 2) {
      return true;
    }

    // Check complexity indicators
    const complexityScore = this.calculateComplexityScore(description);
    if (complexityScore > this.splitThresholds.maxComplexity) {
      return true;
    }

    return false;
  }

  /**
   * Calculate complexity score for a task description
   * @param {string} description - Task description
   * @returns {number} Complexity score (0-10)
   */
  calculateComplexityScore (description) {
    let score = 0;
    const lowerDesc = description.toLowerCase();

    // Length factor
    score += Math.min(description.length / 100, 3);

    // Complexity keywords
    const complexityKeywords = [
      'complex', 'comprehensive', 'integrate', 'refactor', 'migrate',
      'architecture', 'system', 'multiple', 'advanced', 'sophisticated'
    ];
    score += complexityKeywords.filter(keyword => lowerDesc.includes(keyword)).length;

    // Technology count
    const technologies = [
      'react', 'vue', 'angular', 'node', 'express', 'database', 'api',
      'authentication', 'testing', 'deployment', 'docker', 'kubernetes'
    ];
    score += technologies.filter(tech => lowerDesc.includes(tech)).length * 0.5;

    // Action verbs count
    const actionVerbs = [
      'implement', 'create', 'build', 'develop', 'design', 'integrate',
      'optimize', 'refactor', 'test', 'deploy', 'configure', 'setup'
    ];
    score += actionVerbs.filter(verb => lowerDesc.includes(verb)).length * 0.3;

    return Math.min(score, 10);
  }

  /**
   * Split a complex task description into multiple tasks
   * @param {string} description - Complex task description
   * @returns {Array} Array of task objects
   */
  splitTaskDescription (description) {

    // Strategy 1: Split by bullet points or numbered lists
    const bulletTasks = this.splitByBulletPoints(description);
    if (bulletTasks.length > 1) {
      return bulletTasks;
    }

    // Strategy 2: Split by sentences with action verbs
    const sentenceTasks = this.splitBySentences(description);
    if (sentenceTasks.length > 1) {
      return sentenceTasks;
    }

    // Strategy 3: Split by domain/technology areas
    const domainTasks = this.splitByDomains(description);
    if (domainTasks.length > 1) {
      return domainTasks;
    }

    // Fallback: Create phases for large tasks
    return this.createPhases(description);
  }

  /**
   * Split description by bullet points or numbered lists
   * @param {string} description - Task description
   * @returns {Array} Array of task objects
   */
  splitByBulletPoints (description) {
    const lines = description.split('\n');
    const tasks = [];
    let currentTask = '';
    let mainDescription = '';

    for (const line of lines) {
      const trimmedLine = line.trim();

      // Check if line is a bullet point or numbered item
      if (trimmedLine.match(/^[-*•]\s/) || trimmedLine.match(/^\d+[.)]\s/)) {
        // Save previous task if exists
        if (currentTask.trim()) {
          tasks.push(this.parseSingleDescription(`${mainDescription}\n${currentTask}`));
        }

        // Start new task
        currentTask = trimmedLine.replace(/^[-*•]\s/, '').replace(/^\d+[.)]\s/, '');
      } else if (currentTask) {
        // Continue current task
        currentTask += `\n${trimmedLine}`;
      } else {
        // Part of main description
        mainDescription += `\n${trimmedLine}`;
      }
    }

    // Add last task
    if (currentTask.trim()) {
      tasks.push(this.parseSingleDescription(`${mainDescription}\n${currentTask}`));
    }

    return tasks.length > 1 ? tasks : [];
  }

  /**
   * Split description by sentences with action verbs
   * @param {string} description - Task description
   * @returns {Array} Array of task objects
   */
  splitBySentences (description) {
    const sentences = description.split(/[.!?]/).map(s => s.trim()).filter(s => s);
    const actionVerbs = [
      'implement', 'create', 'build', 'develop', 'design', 'add',
      'update', 'fix', 'refactor', 'test', 'deploy', 'configure'
    ];

    const actionSentences = sentences.filter(sentence =>
      actionVerbs.some(verb => sentence.toLowerCase().includes(verb))
    );

    if (actionSentences.length > 2) {
      return actionSentences.map(sentence => this.parseSingleDescription(sentence));
    }

    return [];
  }

  /**
   * Split description by different technology domains
   * @param {string} description - Task description
   * @returns {Array} Array of task objects
   */
  splitByDomains (description) {
    const domainSections = {};
    const lowerDesc = description.toLowerCase();

    // Group content by domains
    for (const [domain, keywords] of Object.entries(this.tags)) {
      const matchingKeywords = keywords.filter(keyword => lowerDesc.includes(keyword));
      if (matchingKeywords.length > 0) {
        domainSections[domain] = {
          keywords: matchingKeywords,
          content: description // For now, use full description
        };
      }
    }

    // If multiple domains found, create separate tasks
    const domains = Object.keys(domainSections);
    if (domains.length > 2) {
      return domains.map(domain => {
        const domainContent = `${domain.charAt(0).toUpperCase() + domain.slice(1)} work: ${description}`;
        return this.parseSingleDescription(domainContent);
      });
    }

    return [];
  }

  /**
   * Create phases for large tasks
   * @param {string} description - Task description
   * @returns {Array} Array of task objects representing phases
   */
  createPhases (description) {
    const phases = [
      'Planning and Analysis',
      'Implementation',
      'Testing and Validation',
      'Documentation and Cleanup'
    ];

    return phases.map((phase, index) => {
      const phaseDescription = `${phase}: ${description}`;
      const task = this.parseSingleDescription(phaseDescription);
      task.title = `${phase} - ${task.title}`;
      task.dependencies = index > 0 ? [phases[index - 1].toLowerCase().replace(/\s+/g, '-')] : [];
      return task;
    });
  }

  /**
   * Convert multiple descriptions to optimized nightly-tasks.yaml
   * @param {Array<string>} descriptions - Array of task descriptions
   * @returns {string} YAML content
   */
  generateTasksYaml (descriptions) {
    let allTasks = [];

    // Process each description, handling potential task splitting
    for (const desc of descriptions) {
      const result = this.parseDescription(desc);
      if (Array.isArray(result)) {
        allTasks = allTasks.concat(result);
      } else {
        allTasks.push(result);
      }
    }

    // Sort by priority, then by dependencies
    allTasks.sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      // Tasks with no dependencies come first
      return a.dependencies.length - b.dependencies.length;
    });

    const yamlContent = {
      version: '1.0',
      created_at: new Date().toISOString(),
      tasks: allTasks,
      metadata: {
        total_tasks: allTasks.length,
        estimated_total_duration: allTasks.reduce((sum, task) => sum + task.estimated_duration, 0),
        auto_split_applied: allTasks.some(task => task.title.includes(' - ') || task.dependencies.length > 0)
      }
    };

    return yaml.stringify(yamlContent, {
      indent: 2,
      lineWidth: 0
    });
  }

  /**
   * Optimize and validate task configuration
   * @param {Object} task - Task object
   * @returns {Object} Optimized task
   */
  optimizeTask (task) {
    // Ensure all required fields
    const optimized = {
      id: task.id || this.generateMeaningfulTaskId(task.title || 'Untitled', task.type || 'feature'),
      type: task.type || 'feature',
      priority: Math.min(Math.max(task.priority || 5, 1), 10),
      title: task.title || 'Untitled Task',
      requirements: task.requirements || '',
      acceptance_criteria: Array.isArray(task.acceptance_criteria)
        ? task.acceptance_criteria
        : [task.acceptance_criteria || 'Task completed successfully'].flat(),
      estimated_duration: task.estimated_duration || 60,
      dependencies: task.dependencies || [],
      tags: task.tags || [],
      files_to_modify: task.files_to_modify || [],
      enabled: task.enabled !== false
    };

    // Add custom validation if complex task
    if (optimized.priority >= 8 || optimized.estimated_duration > 180) {
      optimized.custom_validation = {
        script: './scripts/validate-task.js',
        timeout: 300
      };
    }

    return optimized;
  }
}

module.exports = { TaskDescriptor };
