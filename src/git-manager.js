const fs = require('fs-extra');
const path = require('path');
const simpleGit = require('simple-git');
const { spawn } = require('cross-spawn');

class GitManager {
  constructor (options = {}) {
    this.options = {
      workingDir: options.workingDir || process.cwd(),
      branchPrefix: options.branchPrefix || 'nightly-',
      autoPush: options.autoPush !== false,
      createPR: options.createPR !== false,
      prTemplate: options.prTemplate || null,
      logger: options.logger || console,
      dryRun: options.dryRun || false
    };

    this.git = simpleGit(this.options.workingDir);
    this.originalBranch = null;
    this.sessionBranch = null;
    this.sessionBranches = []; // Keep for backward compatibility
    this.operationTimers = new Map();
  }

  // Helper methods for timing git operations
  startGitOperation (operationName) {
    this.operationTimers.set(operationName, Date.now());
  }

  endGitOperation (operationName) {
    if (!this.operationTimers.has(operationName)) {
      return '';
    }
    const startTime = this.operationTimers.get(operationName);
    const duration = Date.now() - startTime;
    this.operationTimers.delete(operationName);

    const seconds = Math.round(duration / 1000);
    const timeStr = seconds >= 60
      ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
      : `${seconds}s`;

    return ` \x1b[35m[${timeStr}]\x1b[0m`; // Magenta color for git operation timing
  }

  logGitWithTiming (level, message, operationName = null) {
    const timing = operationName ? this.endGitOperation(operationName) : '';
    this.options.logger[level](`${message}${timing}`);
  }

  async ensureRepository () {
    this.options.logger.info('🔍 Ensuring git repository exists...');

    try {
      // Check if we're in a git repository
      const isRepo = await this.git.checkIsRepo();

      if (!isRepo) {
        if (this.options.dryRun) {
          this.options.logger.info('🔄 Dry run mode - would initialize new git repository');
          // Set a fake original branch for dry run
          this.originalBranch = 'main';
          return;
        }

        this.options.logger.info('🆕 Initializing new git repository...');
        await this.git.init();

        // Create initial commit if no commits exist
        const log = await this.git.log().catch(() => null);
        if (!log || log.total === 0) {
          await this.createInitialCommit();
        }
      }

      // Store the original branch
      const status = await this.git.status();
      this.originalBranch = status.current;

      this.options.logger.info(`✅ Git repository ready on branch: ${this.originalBranch}`);

      // Ensure we're on a clean state (skip in dry-run mode)
      if (!this.options.dryRun) {
        await this.ensureCleanState();
      } else {
        this.options.logger.info('🔄 Dry run mode - skipping clean state check');
      }
    } catch (error) {
      this.options.logger.error('❌ Failed to ensure git repository', { error: error.message });
      throw new Error(`Git repository setup failed: ${error.message}`);
    }
  }

  async createInitialCommit () {
    if (this.options.dryRun) {
      this.options.logger.info('🔄 Dry run mode - would create initial commit');
      return;
    }

    this.options.logger.info('📝 Creating initial commit...');

    // Create a minimal .gitignore if it doesn't exist
    const gitignorePath = path.join(this.options.workingDir, '.gitignore');
    if (!await fs.pathExists(gitignorePath)) {
      const defaultGitignore = `# Nightly Code
.nightly-code/
*.log
node_modules/
.env
.DS_Store
`;
      await fs.writeFile(gitignorePath, defaultGitignore);
      this.options.logger.info('📄 Created .gitignore file');
    }

    await this.git.add('.gitignore');
    await this.git.commit('Initial commit', ['--allow-empty']);
    this.options.logger.info('✨ Initial commit created');
  }

  async ensureCleanState () {
    const status = await this.git.status();

    if (status.files.length > 0) {
      const changeCount = status.modified.length + status.created.length + status.deleted.length + status.staged.length;
      this.options.logger.warn(`⚠️  Found ${changeCount} uncommitted changes in working directory`);

      // Stash changes to preserve them
      await this.git.stash(['push', '-m', `Nightly Code auto-stash ${new Date().toISOString()}`]);
      this.options.logger.info('💾 Uncommitted changes safely stashed');
    } else {
      this.options.logger.info('✨ Working directory is clean');
    }
  }

  async createSessionBranch (sessionId) {
    if (this.options.dryRun) {
      const branchName = this.generateSessionBranchName(sessionId);
      this.options.logger.info(`🔄 Dry run mode - would create session branch: ${branchName}`);
      this.sessionBranch = {
        branchName,
        sessionId,
        createdAt: Date.now(),
        baseBranch: this.originalBranch
      };
      return branchName;
    }

    const branchName = this.generateSessionBranchName(sessionId);
    this.startGitOperation('create-session-branch');

    this.options.logger.info('🌿 Creating session branch for coding session');
    this.options.logger.info(`   └─ Branch: ${branchName}`);
    this.options.logger.info(`   └─ Base: ${this.originalBranch}`);

    try {
      // Ensure we're on the original branch and it's up to date
      await this.git.checkout(this.originalBranch);

      // Pull latest changes if remote exists to ensure we have the most recent main
      await this.pullLatestChanges();

      // Verify we're still on main after pull (in case of conflicts)
      const currentBranch = await this.getCurrentBranch();
      if (currentBranch !== this.originalBranch) {
        throw new Error(`Expected to be on ${this.originalBranch} but on ${currentBranch}`);
      }

      // Create and checkout new session branch from the updated main
      await this.git.checkoutLocalBranch(branchName);

      this.sessionBranch = {
        branchName,
        sessionId,
        createdAt: Date.now(),
        baseBranch: this.originalBranch
      };

      this.logGitWithTiming('info', `✅ Session branch created successfully from updated ${this.originalBranch}`, 'create-session-branch');

      return branchName;
    } catch (error) {
      this.options.logger.error(`❌ Failed to create session branch: ${error.message}`);
      throw new Error(`Failed to create session branch for ${sessionId}: ${error.message}`);
    }
  }

  async createTaskBranch (task) {
    // Deprecated: Use session branch instead
    if (!this.sessionBranch) {
      throw new Error('No session branch created. Use createSessionBranch() first.');
    }

    this.options.logger.info(`📌 Using session branch for task: ${task.title}`);
    return this.sessionBranch.branchName;
  }

  generateSessionBranchName (sessionId) {
    const date = new Date().toISOString().split('T')[0];
    const time = new Date().toISOString().split('T')[1].split('.')[0].replace(/:/g, '');

    return `${this.options.branchPrefix}session-${date}-${time}`;
  }

  generateBranchName (task) {
    // Deprecated: Use generateSessionBranchName instead
    const date = new Date().toISOString().split('T')[0];
    const sanitizedTitle = task.title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 30);

    return `${this.options.branchPrefix}${date}-${task.id}-${sanitizedTitle}`;
  }

  async pullLatestChanges () {
    try {
      // Check if remote exists
      const remotes = await this.git.getRemotes(true);
      if (remotes.length === 0) {
        this.options.logger.debug('📡 No remote repository configured, skipping pull');
        return;
      }

      this.options.logger.info('📥 Pulling latest changes from remote...');
      // Pull latest changes from origin
      await this.git.pull('origin', this.originalBranch);
      this.options.logger.info('✅ Successfully pulled latest changes');
    } catch (error) {
      // Don't fail if pull fails (might be offline or no remote)
      this.options.logger.warn(`⚠️  Failed to pull latest changes: ${error.message}`);
    }
  }

  async commitTaskChanges (task, result, commitChunks = []) {
    if (this.options.dryRun) {
      const fileCount = result.filesChanged?.length || 0;
      this.options.logger.info(`🔄 Dry run mode - would commit task changes (${fileCount} files modified)`);
      return ['dry-run-commit'];
    }

    const fileCount = result.filesChanged?.length || 0;
    this.options.logger.info(`💾 Committing task changes (${fileCount} files modified)`);

    try {
      // If no commit chunks provided, create a single commit
      if (commitChunks.length === 0) {
        commitChunks = [{
          message: this.generateCommitMessage(task, result),
          files: result.filesChanged || []
        }];
      }

      const commits = [];
      const totalCommits = commitChunks.length;

      for (let i = 0; i < commitChunks.length; i++) {
        const chunk = commitChunks[i];
        const isProgressCommit = i < totalCommits - 1;
        const commitNumber = i + 1;

        // Generate appropriate commit message
        let commitMessage;
        if (chunk.message) {
          // Use provided message if it already follows convention
          commitMessage = chunk.message;
        } else {
          // Generate message following new convention
          commitMessage = this.generateCommitMessage(
            task,
            { ...result, summary: chunk.summary },
            isProgressCommit,
            commitNumber,
            totalCommits
          );
        }

        // Add specific files for this chunk or all changes if none specified
        if (chunk.files && chunk.files.length > 0) {
          this.options.logger.info(`📝 Staging files for commit: ${chunk.files.join(', ')}`);
          for (const file of chunk.files) {
            await this.git.add(file);
          }
        } else {
          this.options.logger.info('📝 Staging all changes...');
          await this.git.add('.');
        }

        // Create commit
        this.options.logger.info(`✨ Creating commit: ${commitMessage.split('\n')[0]}`);
        const commitResult = await this.git.commit(commitMessage);
        commits.push(commitResult.commit);
      }

      // Task completion tracked via commit message convention
      this.options.logger.info('📝 Task completion tracked via commit message convention');

      // Push to remote if configured
      if (this.options.autoPush) {
        await this.pushSessionBranch();
      }

      this.options.logger.info(`🎉 Task completed with ${commits.length} commit(s)!`);

      return commits;
    } catch (error) {
      this.options.logger.error(`❌ Failed to commit task: ${error.message}`);
      throw new Error(`Failed to commit task ${task.id}: ${error.message}`);
    }
  }

  async commitTask (task, result) {
    // Backward compatibility wrapper
    return this.commitTaskChanges(task, result);
  }

  generateCommitMessage (task, result, isProgressCommit = false, commitNumber = null, totalCommits = null) {
    const type = this.getCommitType(task.type);
    const scope = this.extractScope(task);
    const description = task.title.slice(0, 50);

    // Add task ID to subject line
    let subject = `${type}${scope}: ${description} [task:${task.id}]`;

    // Add progress indicator for multi-commit tasks
    if (isProgressCommit && commitNumber && totalCommits) {
      subject += ` [${commitNumber}/${totalCommits}]`;
    }

    // For progress commits, keep the message shorter
    if (isProgressCommit) {
      return `${subject}\\n\\n${result.summary || 'Work in progress on task implementation.'}`;
    }

    // Full message for task completion
    let message = subject;

    // Add body with more details
    const body = [];

    if (task.requirements) {
      body.push(task.requirements.slice(0, 200) + (task.requirements.length > 200 ? '...' : ''));
      body.push('');
    }

    if (task.acceptance_criteria && task.acceptance_criteria.length > 0) {
      task.acceptance_criteria.forEach(criteria => {
        body.push(`- ${criteria}`);
      });
      body.push('');
    }

    if (result.filesChanged && result.filesChanged.length > 0) {
      body.push(`Files changed: ${result.filesChanged.slice(0, 5).join(', ')}${result.filesChanged.length > 5 ? '...' : ''}`);
      body.push('');
    }

    // Add structured footer with task metadata
    const footer = [];
    footer.push(`Task-ID: ${task.id}`);
    footer.push(`Task-Title: ${task.title}`);
    footer.push(`Task-Type: ${task.type || 'feature'}`);
    footer.push('Task-Status: completed');
    footer.push(`Task-Duration: ${Math.round((result.duration || 0) / 1000)}`);
    footer.push(`Task-Session: ${this.sessionBranch?.sessionId || 'unknown'}`);
    footer.push(`Task-Date: ${new Date().toISOString()}`);

    if (body.length > 0) {
      message += `\\n\\n${body.join('\\n')}`;
    }

    message += `\\n\\n${footer.join('\\n')}`;

    return message;
  }

  getCommitType (taskType) {
    const typeMap = {
      feature: 'feat',
      bugfix: 'fix',
      refactor: 'refactor',
      test: 'test',
      docs: 'docs'
    };

    return typeMap[taskType] || 'chore';
  }

  extractScope (task) {
    // Try to extract scope from tags or files to modify
    if (task.tags && task.tags.length > 0) {
      const commonScopes = ['api', 'ui', 'auth', 'db', 'config', 'build', 'test'];
      const matchingScope = task.tags.find(tag => commonScopes.includes(tag.toLowerCase()));
      if (matchingScope) {
        return `(${matchingScope})`;
      }
    }

    // Try to extract from files to modify
    if (task.files_to_modify && task.files_to_modify.length > 0) {
      const firstFile = task.files_to_modify[0];
      const parts = firstFile.split('/');
      if (parts.length > 1 && parts[0] !== '.') {
        return `(${parts[0]})`;
      }
    }

    return '';
  }

  async pushSessionBranch () {
    try {
      if (!this.sessionBranch) {
        this.options.logger.warn('⚠️  No session branch to push');
        return;
      }

      // Check if remote exists
      const remotes = await this.git.getRemotes(true);
      if (remotes.length === 0) {
        this.options.logger.debug('📡 No remote repository configured, skipping push');
        return;
      }

      this.options.logger.info('📤 Pushing session branch to remote...');

      // Push session branch to remote
      await this.git.push('origin', this.sessionBranch.branchName, ['--set-upstream']);

      this.options.logger.info('✅ Session branch pushed to remote');
    } catch (error) {
      this.options.logger.warn(`⚠️  Failed to push session branch: ${error.message}`);
      // Don't throw error, as this is not critical for local development
    }
  }

  async createSessionPR (sessionResults) {
    if (this.options.dryRun) {
      this.options.logger.info('🔄 Dry run mode - would create session pull request');
      this.options.logger.info(`   └─ Title: Coding Session: ${sessionResults.completedTasks} tasks completed`);
      return 'https://github.com/example/repo/pull/dry-run';
    }

    try {
      // Check if GitHub CLI is available
      const hasGhCli = await this.checkGitHubCLI();
      if (!hasGhCli) {
        this.options.logger.warn('⚠️  GitHub CLI not available, skipping PR creation');
        return;
      }

      if (!this.sessionBranch) {
        this.options.logger.warn('⚠️  No session branch to create PR from');
        return;
      }

      const prTitle = `Coding Session: ${sessionResults.completedTasks} tasks completed`;
      const prBody = await this.generateSessionPRBody(sessionResults);

      this.options.logger.info('🔄 Creating session pull request...');

      // Create PR using GitHub CLI
      const result = await this.executeCommand('gh', [
        'pr', 'create',
        '--title', prTitle,
        '--body', prBody,
        '--base', this.originalBranch,
        '--head', this.sessionBranch.branchName
      ]);

      if (result.code === 0) {
        const prUrl = result.stdout.trim();
        this.options.logger.info(`✅ Session pull request created: ${prUrl}`);

        return prUrl;
      } else {
        throw new Error(result.stderr);
      }
    } catch (error) {
      this.options.logger.warn(`⚠️  Failed to create session pull request: ${error.message}`);
      // Don't throw error, as this is not critical
    }
  }

  async generateSessionPRBody (sessionResults) {
    const body = [];

    body.push('## Session Summary');
    body.push(`Completed ${sessionResults.completedTasks} out of ${sessionResults.totalTasks} tasks in this coding session.`);
    body.push('');

    if (sessionResults.tasks && sessionResults.tasks.length > 0) {
      body.push('## Tasks Completed');
      sessionResults.tasks.forEach((task, index) => {
        if (task.status === 'completed') {
          body.push(`### ${index + 1}. ${task.title}`);
          if (task.result && task.result.filesChanged) {
            body.push(`**Files changed:** ${task.result.filesChanged.join(', ')}`);
          }

          // Show task ID from commit convention
          body.push(`**Task ID:** \`${task.id}\` (tracked via commit convention)`);
          body.push(`**Commits:** Look for \`[task:${task.id}]\` in commit messages`);

          body.push('');
        }
      });
    }

    if (sessionResults.failedTasks && sessionResults.failedTasks.length > 0) {
      body.push('## Failed Tasks');
      sessionResults.failedTasks.forEach(task => {
        body.push(`- ${task.title} (${task.error || 'Unknown error'})`);
      });
      body.push('');
    }

    body.push('## Task Tracking');
    body.push('Tasks are tracked using commit message convention.');
    body.push('');
    body.push('To find commits for a specific task, use:');
    body.push('```bash');
    body.push('git log --grep="\\[task:" --oneline');
    body.push('```');
    body.push('');

    body.push('## Test Plan');
    body.push('- [ ] Manual testing completed');
    body.push('- [ ] All task commits verified with proper convention');
    body.push('- [ ] Session branch review completed');
    body.push('');

    body.push('---');
    body.push('🤖 This PR was automatically generated by Nightly Code Orchestrator');
    body.push(`**Session ID:** ${sessionResults.sessionId}`);
    body.push(`**Duration:** ${Math.round(sessionResults.duration / 60000)} minutes`);
    body.push(`**Generated:** ${new Date().toISOString()}`);

    return body.join('\\n');
  }

  async generatePRBody (task, result) {
    // Deprecated: Use generateSessionPRBody instead
    const body = [];

    body.push('## Summary');
    body.push(task.title);
    body.push('');

    if (task.requirements) {
      body.push('## Requirements');
      body.push(task.requirements);
      body.push('');
    }

    if (task.acceptance_criteria && task.acceptance_criteria.length > 0) {
      body.push('## Acceptance Criteria');
      task.acceptance_criteria.forEach(criteria => {
        body.push(`- [x] ${criteria}`);
      });
      body.push('');
    }

    if (result.filesChanged && result.filesChanged.length > 0) {
      body.push('## Files Changed');
      result.filesChanged.forEach(file => {
        body.push(`- \`${file}\``);
      });
      body.push('');
    }

    body.push('## Test Plan');
    body.push('- [ ] Manual testing completed');
    if (task.type !== 'docs') {
      body.push('- [ ] Unit tests pass');
      body.push('- [ ] Integration tests pass');
    }
    body.push('- [ ] Code review completed');
    body.push('');

    body.push('---');
    body.push('🤖 This PR was automatically generated by Nightly Code Orchestrator');
    body.push(`**Task ID:** ${task.id}`);
    body.push(`**Duration:** ${Math.round((result.duration || 0) / 1000)}s`);
    body.push(`**Generated:** ${new Date().toISOString()}`);

    return body.join('\\n');
  }

  async checkGitHubCLI () {
    try {
      const result = await this.executeCommand('gh', ['--version']);
      return result.code === 0;
    } catch (error) {
      return false;
    }
  }

  async revertTaskChanges (task) {
    if (this.options.dryRun) {
      this.options.logger.info(`🔄 Dry run mode - would revert task changes for: ${task.title}`);
      return;
    }

    this.options.logger.info(`🔄 Reverting task changes for: ${task.title}`);

    try {
      // Get current branch
      const currentBranch = await this.getCurrentBranch();

      // Ensure we're on the main branch and it's up to date
      this.options.logger.info(`🌟 Switching back to ${this.originalBranch}...`);
      await this.git.checkout(this.originalBranch);
      await this.pullLatestChanges();

      // Delete the task branch if it exists
      try {
        const branches = await this.git.branchLocal();
        if (branches.all.includes(currentBranch) && currentBranch !== this.originalBranch) {
          this.options.logger.info(`🗑️  Deleting failed task branch: ${currentBranch}`);
          await this.git.deleteLocalBranch(currentBranch, true);
          this.options.logger.info('✅ Task branch deleted successfully');
        }
      } catch (branchError) {
        this.options.logger.warn(`⚠️  Failed to delete task branch: ${branchError.message}`);
      }

      // Remove from session branches
      this.sessionBranches = this.sessionBranches.filter(
        branch => branch.taskId !== task.id
      );

      this.options.logger.info(`✨ Task changes reverted, back on ${this.originalBranch}`);
    } catch (error) {
      this.options.logger.error(`❌ Failed to revert task changes: ${error.message}`);
      // Don't throw error, as we want to continue with other tasks
    }
  }

  async getChangedFiles () {
    try {
      const status = await this.git.status();

      const changedFiles = [
        ...status.modified,
        ...status.created,
        ...status.deleted,
        ...status.renamed.map(r => r.to),
        ...status.staged
      ];

      return [...new Set(changedFiles)]; // Remove duplicates
    } catch (error) {
      this.options.logger.warn('Failed to get changed files', { error: error.message });
      return [];
    }
  }

  async getCurrentBranch () {
    try {
      const status = await this.git.status();
      return status.current;
    } catch (error) {
      this.options.logger.warn('Failed to get current branch', { error: error.message });
      return 'unknown';
    }
  }

  async getCommitHistory (since = null) {
    try {
      const options = {
        maxCount: 50
      };

      if (since) {
        options.since = since;
      }

      const log = await this.git.log(options);

      return log.all.map(commit => ({
        hash: commit.hash,
        message: commit.message,
        author: commit.author_name,
        date: commit.date,
        files: commit.diff?.files || []
      }));
    } catch (error) {
      this.options.logger.warn('Failed to get commit history', { error: error.message });
      return [];
    }
  }

  async createSessionSummaryCommit (sessionResults) {
    if (this.options.dryRun) {
      this.options.logger.info('🔄 Dry run mode - would create session summary commit');
      this.options.logger.info(`   └─ Session: ${sessionResults.sessionId}`);
      this.options.logger.info(`   └─ Completed: ${sessionResults.completedTasks}/${sessionResults.totalTasks} tasks`);
      return;
    }

    this.options.logger.info('📊 Creating session summary commit...');

    try {
      // Ensure we're on the main branch and it's up to date
      await this.git.checkout(this.originalBranch);
      await this.pullLatestChanges();

      // Create session summary file
      const summaryPath = path.join(this.options.workingDir, '.nightly-code', 'session-summaries');
      await fs.ensureDir(summaryPath);

      const summaryFile = path.join(summaryPath, `${sessionResults.sessionId}.json`);
      await fs.writeJson(summaryFile, sessionResults, { spaces: 2 });

      this.options.logger.info('📝 Adding session summary to commit...');
      // Add and commit summary
      await this.git.add(summaryFile);

      const commitMessage = `📊 Nightly Code Session Summary

Session: ${sessionResults.sessionId}
Completed: ${sessionResults.completedTasks}/${sessionResults.totalTasks} tasks
Duration: ${Math.round(sessionResults.duration / 60000)} minutes
All successful tasks merged to main

🤖 Generated with Nightly Code Orchestrator`;

      await this.git.commit(commitMessage);

      // Push the summary commit if configured
      if (this.options.autoPush) {
        try {
          const remotes = await this.git.getRemotes(true);
          if (remotes.length > 0) {
            this.options.logger.info('📤 Pushing session summary to remote...');
            await this.git.push('origin', this.originalBranch);
            this.options.logger.info('✅ Session summary pushed to remote');
          }
        } catch (pushError) {
          this.options.logger.warn(`⚠️  Failed to push session summary: ${pushError.message}`);
        }
      }

      this.options.logger.info('✅ Session summary committed to main');
    } catch (error) {
      this.options.logger.warn(`⚠️  Failed to create session summary commit: ${error.message}`);
    }
  }

  async cleanupSessionBranches () {
    if (this.options.dryRun) {
      this.options.logger.info('🔄 Dry run mode - would clean up session branches');
      return;
    }

    // In the new workflow, we only clean up the session branch after PR creation
    if (!this.sessionBranch) {
      this.options.logger.info('🧹 No session branch to clean up');
      return;
    }

    this.options.logger.info(`🧹 Cleaning up session branch: ${this.sessionBranch.branchName}`);

    try {
      // Switch to original branch first
      await this.git.checkout(this.originalBranch);

      // Check if session branch still exists
      const branches = await this.git.branchLocal();
      if (branches.all.includes(this.sessionBranch.branchName)) {
        // Delete session branch (it should now be in a PR)
        this.options.logger.info(`🗑️  Deleting session branch: ${this.sessionBranch.branchName}`);
        await this.git.deleteLocalBranch(this.sessionBranch.branchName, true);
        this.options.logger.info('✅ Session branch deleted successfully');
      }

      // Clear session branch tracking
      this.sessionBranch = null;

      // Handle legacy session branches if any exist
      if (this.sessionBranches.length > 0) {
        this.options.logger.info(`🧹 Cleaning up ${this.sessionBranches.length} legacy task branches...`);

        for (const branchInfo of this.sessionBranches) {
          try {
            if (branches.all.includes(branchInfo.branchName)) {
              this.options.logger.info(`🗑️  Deleting legacy branch: ${branchInfo.branchName}`);
              await this.git.deleteLocalBranch(branchInfo.branchName, true);
            }
          } catch (error) {
            this.options.logger.warn(`⚠️  Failed to cleanup branch ${branchInfo.branchName}: ${error.message}`);
          }
        }

        this.sessionBranches = [];
      }
    } catch (error) {
      this.options.logger.warn(`⚠️  Failed to cleanup session branch: ${error.message}`);
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

      child.on('close', (code) => {
        resolve({ stdout, stderr, code });
      });

      child.on('error', (error) => {
        reject(error);
      });
    });
  }

  async getRepositoryInfo () {
    try {
      const remotes = await this.git.getRemotes(true);
      const status = await this.git.status();
      const log = await this.git.log({ maxCount: 1 });

      return {
        currentBranch: status.current,
        hasRemote: remotes.length > 0,
        remoteUrl: remotes[0]?.refs?.fetch || null,
        lastCommit: log.latest?.hash || null,
        uncommittedChanges: status.files.length > 0,
        ahead: status.ahead || 0,
        behind: status.behind || 0
      };
    } catch (error) {
      this.options.logger.warn('Failed to get repository info', { error: error.message });
      return null;
    }
  }
}

module.exports = { GitManager };
