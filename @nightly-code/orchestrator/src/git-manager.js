const fs = require('fs-extra');
const path = require('path');
const simpleGit = require('simple-git');
const { spawn } = require('cross-spawn');

class GitManager {
  constructor(options = {}) {
    this.options = {
      workingDir: options.workingDir || process.cwd(),
      branchPrefix: options.branchPrefix || 'nightly-',
      autoPush: options.autoPush !== false,
      createPR: options.createPR !== false,
      prTemplate: options.prTemplate || null,
      logger: options.logger || console
    };
    
    this.git = simpleGit(this.options.workingDir);
    this.originalBranch = null;
    this.sessionBranches = [];
  }
  
  async ensureRepository() {
    this.options.logger.info('🔍 Ensuring git repository exists...');
    
    try {
      // Check if we're in a git repository
      const isRepo = await this.git.checkIsRepo();
      
      if (!isRepo) {
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
      
      // Ensure we're on a clean state
      await this.ensureCleanState();
      
    } catch (error) {
      this.options.logger.error('❌ Failed to ensure git repository', { error: error.message });
      throw new Error(`Git repository setup failed: ${error.message}`);
    }
  }
  
  async createInitialCommit() {
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
  
  async ensureCleanState() {
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
  
  async createTaskBranch(task) {
    const branchName = this.generateBranchName(task);
    
    this.options.logger.info(`🌿 Creating task branch for: ${task.title}`);
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
      
      // Create and checkout new branch from the updated main
      await this.git.checkoutLocalBranch(branchName);
      
      this.sessionBranches.push({
        branchName,
        taskId: task.id,
        createdAt: Date.now(),
        baseBranch: this.originalBranch
      });
      
      this.options.logger.info(`✅ Task branch created successfully from updated ${this.originalBranch}`);
      
      return branchName;
      
    } catch (error) {
      this.options.logger.error(`❌ Failed to create task branch: ${error.message}`);
      throw new Error(`Failed to create branch for task ${task.id}: ${error.message}`);
    }
  }
  
  generateBranchName(task) {
    const date = new Date().toISOString().split('T')[0];
    const sanitizedTitle = task.title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 30);
    
    return `${this.options.branchPrefix}${date}-${task.id}-${sanitizedTitle}`;
  }
  
  async pullLatestChanges() {
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
  
  async commitTask(task, result) {
    const fileCount = result.filesChanged?.length || 0;
    this.options.logger.info(`💾 Committing task changes (${fileCount} files modified)`);
    
    try {
      // Add all changes
      this.options.logger.info('📝 Staging changes...');
      await this.git.add('.');
      
      // Generate commit message
      const commitMessage = this.generateCommitMessage(task, result);
      
      // Create commit
      this.options.logger.info('✨ Creating commit...');
      await this.git.commit(commitMessage);
      
      // Push to remote if configured
      if (this.options.autoPush) {
        await this.pushBranch(task);
      }
      
      // Create pull request if configured
      if (this.options.createPR) {
        await this.createPullRequest(task, result);
      }
      
      // Merge back to main immediately after successful commit
      await this.mergeTaskToMain(task);
      
      this.options.logger.info('🎉 Task completed and merged to main successfully!');
      
    } catch (error) {
      this.options.logger.error(`❌ Failed to commit task: ${error.message}`);
      throw new Error(`Failed to commit task ${task.id}: ${error.message}`);
    }
  }
  
  generateCommitMessage(task, result) {
    const type = this.getCommitType(task.type);
    const scope = this.extractScope(task);
    const description = task.title.slice(0, 50);
    
    let message = `${type}${scope}: ${description}`;
    
    // Add body with more details
    const body = [];
    
    if (task.requirements) {
      body.push('Requirements:');
      body.push(task.requirements.slice(0, 200) + (task.requirements.length > 200 ? '...' : ''));
      body.push('');
    }
    
    if (task.acceptance_criteria && task.acceptance_criteria.length > 0) {
      body.push('Acceptance Criteria:');
      task.acceptance_criteria.forEach(criteria => {
        body.push(`- ${criteria}`);
      });
      body.push('');
    }
    
    if (result.filesChanged && result.filesChanged.length > 0) {
      body.push(`Files changed: ${result.filesChanged.slice(0, 5).join(', ')}${result.filesChanged.length > 5 ? '...' : ''}`);
    }
    
    body.push('🤖 Generated with Nightly Code Orchestrator');
    body.push('');
    body.push(`Task ID: ${task.id}`);
    body.push(`Duration: ${Math.round((result.duration || 0) / 1000)}s`);
    body.push(`Session: ${new Date().toISOString()}`);
    
    if (body.length > 0) {
      message += '\\n\\n' + body.join('\\n');
    }
    
    return message;
  }
  
  getCommitType(taskType) {
    const typeMap = {
      feature: 'feat',
      bugfix: 'fix',
      refactor: 'refactor',
      test: 'test',
      docs: 'docs'
    };
    
    return typeMap[taskType] || 'chore';
  }
  
  extractScope(task) {
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
  
  async pushBranch(task) {
    try {
      const currentBranch = await this.getCurrentBranch();
      
      // Check if remote exists
      const remotes = await this.git.getRemotes(true);
      if (remotes.length === 0) {
        this.options.logger.debug('📡 No remote repository configured, skipping push');
        return;
      }
      
      this.options.logger.info('📤 Pushing branch to remote...');
      // Push branch to remote
      await this.git.push('origin', currentBranch, ['--set-upstream']);
      
      this.options.logger.info(`✅ Branch ${currentBranch} pushed to remote`);
      
    } catch (error) {
      this.options.logger.warn(`⚠️  Failed to push branch: ${error.message}`);
      // Don't throw error, as this is not critical for local development
    }
  }
  
  async createPullRequest(task, result) {
    try {
      // Check if GitHub CLI is available
      const hasGhCli = await this.checkGitHubCLI();
      if (!hasGhCli) {
        this.options.logger.warn('⚠️  GitHub CLI not available, skipping PR creation');
        return;
      }
      
      const currentBranch = await this.getCurrentBranch();
      const prTitle = `${this.getCommitType(task.type)}: ${task.title}`;
      const prBody = await this.generatePRBody(task, result);
      
      this.options.logger.info('🔄 Creating pull request...');
      
      // Create PR using GitHub CLI
      const result2 = await this.executeCommand('gh', [
        'pr', 'create',
        '--title', prTitle,
        '--body', prBody,
        '--base', this.originalBranch,
        '--head', currentBranch
      ]);
      
      if (result2.code === 0) {
        const prUrl = result2.stdout.trim();
        this.options.logger.info(`✅ Pull request created: ${prUrl}`);
        
        return prUrl;
      } else {
        throw new Error(result2.stderr);
      }
      
    } catch (error) {
      this.options.logger.warn(`⚠️  Failed to create pull request: ${error.message}`);
      // Don't throw error, as this is not critical
    }
  }
  
  async mergeTaskToMain(task) {
    this.options.logger.info(`🔀 Merging task to ${this.originalBranch}...`);
    
    try {
      const currentBranch = await this.getCurrentBranch();
      
      // Switch to main branch
      this.options.logger.info(`🌟 Switching to ${this.originalBranch} branch...`);
      await this.git.checkout(this.originalBranch);
      
      // Pull latest changes to ensure main is up to date
      await this.pullLatestChanges();
      
      // Merge the task branch into main
      this.options.logger.info(`🔗 Merging ${currentBranch} into ${this.originalBranch}...`);
      await this.git.merge([currentBranch, '--no-ff']);
      
      // Push updated main to remote if configured
      if (this.options.autoPush) {
        try {
          const remotes = await this.git.getRemotes(true);
          if (remotes.length > 0) {
            this.options.logger.info(`📤 Pushing updated ${this.originalBranch} to remote...`);
            await this.git.push('origin', this.originalBranch);
            this.options.logger.info(`✅ Updated ${this.originalBranch} pushed to remote`);
          }
        } catch (pushError) {
          this.options.logger.warn(`⚠️  Failed to push updated ${this.originalBranch}: ${pushError.message}`);
        }
      }
      
      // Clean up the task branch locally
      this.options.logger.info(`🧹 Cleaning up task branch: ${currentBranch}`);
      await this.git.deleteLocalBranch(currentBranch);
      
      // Remove from session branches tracking
      this.sessionBranches = this.sessionBranches.filter(
        branch => branch.branchName !== currentBranch
      );
      
      this.options.logger.info(`✨ Task successfully merged and branch cleaned up`);
      
    } catch (error) {
      this.options.logger.error(`❌ Failed to merge task to main: ${error.message}`);
      throw new Error(`Failed to merge task ${task.id} to main: ${error.message}`);
    }
  }
  
  async generatePRBody(task, result) {
    let body = [];
    
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
  
  async checkGitHubCLI() {
    try {
      const result = await this.executeCommand('gh', ['--version']);
      return result.code === 0;
    } catch (error) {
      return false;
    }
  }
  
  async revertTaskChanges(task) {
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
  
  async getChangedFiles() {
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
  
  async getCurrentBranch() {
    try {
      const status = await this.git.status();
      return status.current;
    } catch (error) {
      this.options.logger.warn('Failed to get current branch', { error: error.message });
      return 'unknown';
    }
  }
  
  async getCommitHistory(since = null) {
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
  
  async createSessionSummaryCommit(sessionResults) {
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
  
  async cleanupSessionBranches(keepSuccessful = true) {
    const branchCount = this.sessionBranches.length;
    
    if (branchCount === 0) {
      this.options.logger.info('🧹 No remaining branches to clean up');
      return;
    }
    
    this.options.logger.info(`🧹 Cleaning up ${branchCount} remaining session branches...`);
    
    let cleaned = 0;
    
    // Since successful branches are automatically merged and cleaned up,
    // this method now primarily handles cleanup of failed task branches
    for (const branchInfo of this.sessionBranches) {
      try {
        // Switch to original branch first
        await this.git.checkout(this.originalBranch);
        
        // Check if branch still exists
        const branches = await this.git.branchLocal();
        if (!branches.all.includes(branchInfo.branchName)) {
          continue;
        }
        
        // Delete remaining branches (typically failed tasks)
        this.options.logger.info(`🗑️  Deleting branch: ${branchInfo.branchName}`);
        await this.git.deleteLocalBranch(branchInfo.branchName, true);
        cleaned++;
        
      } catch (error) {
        this.options.logger.warn(`⚠️  Failed to cleanup branch ${branchInfo.branchName}: ${error.message}`);
      }
    }
    
    // Clear the session branches list
    this.sessionBranches = [];
    
    this.options.logger.info(`✅ Branch cleanup completed (${cleaned} branches removed)`);
  }
  
  async executeCommand(command, args = [], options = {}) {
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
  
  async getRepositoryInfo() {
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