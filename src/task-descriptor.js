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
   * Parse natural language description into structured task
   * @param {string} description - Natural language task description
   * @returns {Object} Structured task object
   */
  parseDescription (description) {
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
      id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
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
   * Convert multiple descriptions to optimized nightly-tasks.yaml
   * @param {Array<string>} descriptions - Array of task descriptions
   * @returns {string} YAML content
   */
  generateTasksYaml (descriptions) {
    const tasks = descriptions.map(desc => this.parseDescription(desc));

    // Sort by priority
    tasks.sort((a, b) => b.priority - a.priority);

    const yamlContent = {
      version: '1.0',
      created_at: new Date().toISOString(),
      tasks
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
      id: task.id || `task-${Date.now()}`,
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
