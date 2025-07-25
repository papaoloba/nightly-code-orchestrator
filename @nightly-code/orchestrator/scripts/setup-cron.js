#!/usr/bin/env node

const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { spawn } = require('cross-spawn');
const inquirer = require('inquirer');

class CronSetup {
  constructor() {
    this.platform = os.platform();
    this.isWindows = this.platform === 'win32';
    this.isMacOS = this.platform === 'darwin';
    this.isLinux = this.platform === 'linux';
  }
  
  async configure(options = {}) {
    console.log('🔧 Setting up automated scheduling...');
    console.log(`Platform detected: ${this.platform}`);
    
    if (options.dryRun) {
      return this.performDryRun(options);
    }
    
    try {
      // Validate environment
      await this.validateEnvironment();
      
      // Get configuration
      const config = await this.getScheduleConfiguration(options);
      
      // Set up scheduling based on platform
      if (this.isWindows) {
        await this.setupWindowsTaskScheduler(config);
      } else {
        await this.setupUnixCron(config);
      }
      
      console.log('✅ Scheduling setup completed successfully!');
      
    } catch (error) {
      console.error('❌ Scheduling setup failed:', error.message);
      throw error;
    }
  }
  
  async performDryRun(options) {
    console.log('\n📋 Dry Run - Scheduling Configuration:');
    console.log('─'.repeat(50));
    
    const config = await this.getScheduleConfiguration(options);
    
    console.log(`Cron Expression: ${config.cron}`);
    console.log(`Timezone: ${config.timezone}`);
    console.log(`Command: ${config.command}`);
    console.log(`Working Directory: ${config.workingDir}`);
    console.log(`Log File: ${config.logFile}`);
    
    if (this.isWindows) {
      console.log('\\nWindows Task Scheduler Command:');
      console.log(this.generateWindowsCommand(config));
    } else {
      console.log('\\nCron Entry:');
      console.log(this.generateCronEntry(config));
    }
    
    console.log('\\n✨ Dry run completed - no changes made');
  }
  
  async validateEnvironment() {
    // Check if nightly-code command is available
    try {
      await this.executeCommand('nightly-code', ['--version']);
    } catch (error) {
      throw new Error('nightly-code command not found. Please ensure the package is installed globally or locally.');
    }
    
    // Check if we're in a valid project directory
    const configExists = await fs.pathExists('nightly-code.yaml') || await fs.pathExists('nightly-code.json');
    if (!configExists) {
      console.warn('⚠️  No nightly-code configuration found in current directory.');
      console.warn('   Run "nightly-code init" first to create configuration files.');
    }
    
    // Platform-specific validations
    if (this.isWindows) {
      await this.validateWindowsEnvironment();
    } else {
      await this.validateUnixEnvironment();
    }
  }
  
  async validateWindowsEnvironment() {
    try {
      await this.executeCommand('schtasks', ['/query', '/tn', 'NonExistentTask'], { allowNonZeroExit: true });
    } catch (error) {
      throw new Error('Windows Task Scheduler (schtasks) not available. Please ensure you have administrative privileges.');
    }
  }
  
  async validateUnixEnvironment() {
    try {
      await this.executeCommand('crontab', ['-l'], { allowNonZeroExit: true });
    } catch (error) {
      throw new Error('Crontab not available. Please ensure cron is installed on your system.');
    }
  }
  
  async getScheduleConfiguration(options) {
    const config = {
      cron: options.cron || '0 22 * * *', // Default: 10 PM every day
      timezone: options.timezone || 'UTC',
      workingDir: process.cwd(),
      command: this.generateNightlyCommand(),
      logFile: path.join(process.cwd(), '.nightly-code', 'logs', 'scheduler.log')
    };
    
    // Interactive configuration if not provided
    if (!options.cron || !options.timezone) {
      const answers = await this.promptForConfiguration(config);
      Object.assign(config, answers);
    }
    
    // Ensure log directory exists
    await fs.ensureDir(path.dirname(config.logFile));
    
    return config;
  }
  
  async promptForConfiguration(defaultConfig) {
    console.log('\\n🔧 Interactive Schedule Configuration');
    
    const questions = [
      {
        type: 'input',
        name: 'cron',
        message: 'Enter cron expression (or time in HH:MM format):',
        default: defaultConfig.cron,
        validate: (input) => {
          if (input.match(/^\\d{1,2}:\\d{2}$/)) {
            return true; // Simple time format
          }
          if (input.match(/^[\\d\\s\\*\\/,-]{9,}$/)) {
            return true; // Cron format
          }
          return 'Please enter a valid cron expression or time in HH:MM format';
        },
        filter: (input) => {
          // Convert simple time format to cron
          const timeMatch = input.match(/^(\\d{1,2}):(\\d{2})$/);
          if (timeMatch) {
            const hours = timeMatch[1];
            const minutes = timeMatch[2];
            return `${minutes} ${hours} * * *`;
          }
          return input;
        }
      },
      {
        type: 'list',
        name: 'timezone',
        message: 'Select timezone:',
        choices: [
          { name: 'UTC', value: 'UTC' },
          { name: 'America/New_York (EST/EDT)', value: 'America/New_York' },
          { name: 'America/Chicago (CST/CDT)', value: 'America/Chicago' },
          { name: 'America/Denver (MST/MDT)', value: 'America/Denver' },
          { name: 'America/Los_Angeles (PST/PDT)', value: 'America/Los_Angeles' },
          { name: 'Europe/London (GMT/BST)', value: 'Europe/London' },
          { name: 'Europe/Paris (CET/CEST)', value: 'Europe/Paris' },
          { name: 'Asia/Tokyo (JST)', value: 'Asia/Tokyo' },
          { name: 'Custom...', value: 'custom' }
        ],
        default: defaultConfig.timezone
      },
      {
        type: 'input',
        name: 'customTimezone',
        message: 'Enter custom timezone (e.g., America/New_York):',
        when: (answers) => answers.timezone === 'custom',
        validate: (input) => {
          try {
            Intl.DateTimeFormat(undefined, { timeZone: input });
            return true;
          } catch (error) {
            return 'Please enter a valid timezone identifier';
          }
        }
      }
    ];
    
    const answers = await inquirer.prompt(questions);
    
    if (answers.customTimezone) {
      answers.timezone = answers.customTimezone;
      delete answers.customTimezone;
    }
    
    return answers;
  }
  
  generateNightlyCommand() {
    const packagePath = path.resolve(__dirname, '..');
    const isGlobalInstall = packagePath.includes('node_modules');
    
    if (isGlobalInstall) {
      return 'nightly-code run';
    } else {
      // For local development
      return `node "${path.join(packagePath, 'bin', 'nightly-code')}" run`;
    }
  }
  
  async setupWindowsTaskScheduler(config) {
    console.log('Setting up Windows Task Scheduler...');
    
    const taskName = 'NightlyCodeOrchestrator';
    const xmlConfig = this.generateWindowsTaskXml(config);
    
    // Create temporary XML file
    const tempXmlFile = path.join(os.tmpdir(), 'nightly-code-task.xml');
    await fs.writeFile(tempXmlFile, xmlConfig);
    
    try {
      // Delete existing task if it exists
      await this.executeCommand('schtasks', ['/delete', '/tn', taskName, '/f'], { allowNonZeroExit: true });
      
      // Create new task
      await this.executeCommand('schtasks', ['/create', '/xml', tempXmlFile, '/tn', taskName]);
      
      console.log(`✅ Windows Task "${taskName}" created successfully`);
      console.log(`   Next run time can be viewed with: schtasks /query /tn "${taskName}"`);
      
    } finally {
      // Clean up temp file
      await fs.remove(tempXmlFile);
    }
  }
  
  generateWindowsTaskXml(config) {
    const cronParts = config.cron.split(' ');
    const minute = cronParts[0] === '*' ? '0' : cronParts[0];
    const hour = cronParts[1] === '*' ? '0' : cronParts[1];
    
    return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Date>${new Date().toISOString()}</Date>
    <Author>Nightly Code Orchestrator</Author>
    <Description>Automated coding sessions using Claude Code</Description>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>${new Date().toISOString().split('T')[0]}T${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:00</StartBoundary>
      <ScheduleByDay>
        <DaysInterval>1</DaysInterval>
      </ScheduleByDay>
    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>true</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT8H</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>cmd</Command>
      <Arguments>/c "cd /d \\"${config.workingDir}\\" && ${config.command} >> \\"${config.logFile}\\" 2>&1"</Arguments>
      <WorkingDirectory>${config.workingDir}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>`;
  }
  
  async setupUnixCron(config) {
    console.log('Setting up cron job...');
    
    // Get existing crontab
    let existingCrontab = '';
    try {
      const result = await this.executeCommand('crontab', ['-l'], { allowNonZeroExit: true });
      existingCrontab = result.stdout;
    } catch (error) {
      // No existing crontab, which is fine
    }
    
    // Generate new cron entry
    const cronEntry = this.generateCronEntry(config);
    const cronMarker = '# Nightly Code Orchestrator';
    
    // Remove existing nightly-code entries
    const lines = existingCrontab.split('\\n').filter(line => 
      !line.includes('nightly-code') && !line.includes(cronMarker)
    );
    
    // Add new entry
    lines.push('');
    lines.push(cronMarker);
    lines.push(cronEntry);
    lines.push('');
    
    const newCrontab = lines.join('\\n').trim() + '\\n';
    
    // Write new crontab
    const tempCronFile = path.join(os.tmpdir(), 'nightly-code-cron');
    await fs.writeFile(tempCronFile, newCrontab);
    
    try {
      await this.executeCommand('crontab', [tempCronFile]);
      console.log('✅ Cron job created successfully');
      console.log(`   View with: crontab -l`);
      console.log(`   Edit with: crontab -e`);
    } finally {
      await fs.remove(tempCronFile);
    }
  }
  
  generateCronEntry(config) {
    const envVars = [
      `PATH=${process.env.PATH}`,
      `NODE_PATH=${process.env.NODE_PATH || ''}`,
      `HOME=${process.env.HOME}`
    ].filter(v => v.split('=')[1]).join(' ');
    
    return `${config.cron} cd "${config.workingDir}" && ${envVars} ${config.command} >> "${config.logFile}" 2>&1`;
  }
  
  generateWindowsCommand(config) {
    return `schtasks /create /tn "NightlyCodeOrchestrator" /tr "cmd /c \\"cd /d \\"${config.workingDir}\\" && ${config.command}\\""`;
  }
  
  async executeCommand(command, args = [], options = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: 'pipe',
        ...options
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
        if (code === 0 || options.allowNonZeroExit) {
          resolve({ stdout, stderr, code });
        } else {
          reject(new Error(`Command failed with code ${code}: ${stderr || stdout}`));
        }
      });
      
      child.on('error', (error) => {
        reject(error);
      });
    });
  }
}

// CLI interface when run directly
if (require.main === module) {
  const { program } = require('commander');
  
  program
    .option('-c, --cron <expression>', 'Cron expression for scheduling', '0 22 * * *')
    .option('-t, --timezone <tz>', 'Timezone for scheduling', 'UTC')
    .option('--dry-run', 'Show what would be scheduled without creating it')
    .parse();
  
  const setup = new CronSetup();
  setup.configure(program.opts())
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}

module.exports = { CronSetup };