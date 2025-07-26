#!/usr/bin/env node

const fs = require('fs-extra');
const path = require('path');
const os = require('os');

class InstallHooks {
  constructor() {
    this.packageRoot = path.resolve(__dirname, '..');
    this.isGlobalInstall = this.packageRoot.includes(`${path.sep}node_modules${path.sep}`);
    this.userConfigDir = path.join(os.homedir(), '.nightly-code');
  }
  
  async install() {
    try {
      console.log('🔧 Installing Nightly Code hooks and configuration...');
      
      // Create user configuration directory
      await this.createUserConfigDirectory();
      
      // Install global configuration
      await this.installGlobalConfiguration();
      
      // Set up shell integration
      await this.setupShellIntegration();
      
      // Create example files if this is a first-time install
      await this.createExampleFiles();
      
      // Set up logging
      await this.setupLogging();
      
      console.log('✅ Installation completed successfully!');
      console.log('');
      console.log('Next steps:');
      console.log('  1. Run "nightly-code init" in your project directory');
      console.log('  2. Edit the generated configuration files');
      console.log('  3. Run "nightly-code schedule" to set up automated scheduling');
      console.log('  4. Test with "nightly-code run --dry-run"');
      
    } catch (error) {
      console.error('❌ Installation failed:', error.message);
      throw error;
    }
  }
  
  async createUserConfigDirectory() {
    await fs.ensureDir(this.userConfigDir);
    await fs.ensureDir(path.join(this.userConfigDir, 'logs'));
    await fs.ensureDir(path.join(this.userConfigDir, 'templates'));
    await fs.ensureDir(path.join(this.userConfigDir, 'cache'));
    
    console.log(`📁 Created user configuration directory: ${this.userConfigDir}`);
  }
  
  async installGlobalConfiguration() {
    const globalConfigPath = path.join(this.userConfigDir, 'global-config.json');
    
    // Don't overwrite existing global configuration
    if (await fs.pathExists(globalConfigPath)) {
      console.log('📋 Global configuration already exists, skipping...');
      return;
    }
    
    const globalConfig = {
      version: "1.0.0",
      created_at: new Date().toISOString(),
      settings: {
        default_timezone: "UTC",
        max_concurrent_sessions: 1,
        auto_update_check: true,
        telemetry_enabled: false,
        log_level: "info"
      },
      editor: {
        preferred_editor: "code",
        editor_args: ["--wait"]
      },
      notifications: {
        desktop_notifications: true,
        sound_enabled: false
      },
      security: {
        require_confirmation_for_destructive_operations: true,
        sandbox_mode_default: false,
        allowed_domains: [
          "github.com",
          "api.github.com",
          "api.anthropic.com"
        ]
      },
      templates: {
        custom_template_directory: path.join(this.userConfigDir, 'templates')
      }
    };
    
    await fs.writeJson(globalConfigPath, globalConfig, { spaces: 2 });
    console.log('📋 Created global configuration');
  }
  
  async setupShellIntegration() {
    if (os.platform() === 'win32') {
      await this.setupWindowsShellIntegration();
    } else {
      await this.setupUnixShellIntegration();
    }
  }
  
  async setupWindowsShellIntegration() {
    // For Windows, we'll create a PowerShell profile enhancement
    const psProfilePath = path.join(os.homedir(), 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1');
    
    if (await fs.pathExists(psProfilePath)) {
      const existingProfile = await fs.readFile(psProfilePath, 'utf8');
      
      if (!existingProfile.includes('nightly-code completion')) {
        const completionScript = `
# Nightly Code completion
if (Get-Command nightly-code -ErrorAction SilentlyContinue) {
    # Add any PowerShell completion logic here
    Write-Host "Nightly Code available" -ForegroundColor Green
}
`;
        
        await fs.appendFile(psProfilePath, completionScript);
        console.log('🐚 Added PowerShell integration');
      }
    }
  }
  
  async setupUnixShellIntegration() {
    const shells = [
      { name: 'bash', rcFile: '.bashrc', profileFile: '.bash_profile' },
      { name: 'zsh', rcFile: '.zshrc', profileFile: '.zprofile' },
      { name: 'fish', rcFile: '.config/fish/config.fish', profileFile: null }
    ];
    
    for (const shell of shells) {
      await this.setupShellCompletion(shell);
    }
  }
  
  async setupShellCompletion(shell) {
    const rcPath = path.join(os.homedir(), shell.rcFile);
    
    if (!await fs.pathExists(rcPath)) {
      return; // Shell not installed or used
    }
    
    const existingRc = await fs.readFile(rcPath, 'utf8');
    
    // Check for existing completion setup more robustly
    if (shell.name === 'bash' && existingRc.includes('complete -W "init run schedule status config validate report" nightly-code')) {
      return; // Bash completion already set up
    }
    if (shell.name === 'zsh' && existingRc.includes('_nightly_code()')) {
      return; // Zsh completion already set up
    }
    if (shell.name === 'fish' && existingRc.includes('complete -c nightly-code')) {
      return; // Fish completion already set up
    }
    
    let completionScript = '';
    
    switch (shell.name) {
      case 'bash':
        completionScript = `
# Nightly Code completion
if command -v nightly-code >/dev/null 2>&1; then
  # Basic completion - expand this for more sophisticated completion
  complete -W "init run schedule status config validate report" nightly-code
fi
`;
        break;
        
      case 'zsh':
        completionScript = `
# Nightly Code completion
if command -v nightly-code >/dev/null 2>&1; then
  autoload -U compinit
  compinit
  
  # Basic completion - expand this for more sophisticated completion
  _nightly_code() {
    local commands=(
      "init:Initialize configuration in current repository"
      "run:Execute a single coding session manually"
      "schedule:Set up automated scheduling"
      "status:Check last session results"
      "config:Manage configuration interactively"
      "validate:Validate current configuration"
      "report:View session reports"
    )
    
    _describe 'commands' commands
  }
  
  compdef _nightly_code nightly-code
fi
`;
        break;
        
      case 'fish':
        completionScript = `
# Nightly Code completion
if command -v nightly-code >/dev/null 2>&1
    complete -c nightly-code -n '__fish_use_subcommand' -a 'init' -d 'Initialize configuration'
    complete -c nightly-code -n '__fish_use_subcommand' -a 'run' -d 'Execute coding session'
    complete -c nightly-code -n '__fish_use_subcommand' -a 'schedule' -d 'Set up scheduling'
    complete -c nightly-code -n '__fish_use_subcommand' -a 'status' -d 'Check session status'
    complete -c nightly-code -n '__fish_use_subcommand' -a 'config' -d 'Manage configuration'
    complete -c nightly-code -n '__fish_use_subcommand' -a 'validate' -d 'Validate configuration'
    complete -c nightly-code -n '__fish_use_subcommand' -a 'report' -d 'View reports'
end
`;
        break;
    }
    
    if (completionScript) {
      await fs.appendFile(rcPath, completionScript);
      console.log(`🐚 Added ${shell.name} completion`);
    }
  }
  
  async createExampleFiles() {
    const examplesDir = path.join(this.userConfigDir, 'examples');
    await fs.ensureDir(examplesDir);
    
    // Create example configuration
    const exampleConfig = {
      session: {
        max_duration: 14400, // 4 hours for example
        time_zone: "America/New_York",
        max_concurrent_tasks: 1,
        checkpoint_interval: 300
      },
      project: {
        root_directory: "./",
        package_manager: "npm",
        test_command: "npm test",
        lint_command: "npm run lint",
        build_command: "npm run build",
        setup_commands: ["npm ci"]
      },
      git: {
        branch_prefix: "nightly-",
        auto_push: true,
        create_pr: true,
        pr_template: ".github/pull_request_template.md",
        cleanup_branches: false
      },
      validation: {
        skip_tests: false,
        skip_lint: false,
        skip_build: false,
        custom_validators: [
          {
            name: "Security Audit",
            command: "npm audit --audit-level high",
            timeout: 120,
            required: false
          }
        ]
      },
      notifications: {
        email: {
          enabled: false
        },
        slack: {
          enabled: false
        },
        webhook: {
          enabled: false
        }
      }
    };
    
    await fs.writeJson(
      path.join(examplesDir, 'example-config.json'),
      exampleConfig,
      { spaces: 2 }
    );
    
    // Create example tasks
    const exampleTasks = {
      version: "1.0",
      created_at: new Date().toISOString(),
      tasks: [
        {
          id: "example-feature",
          type: "feature",
          priority: 5,
          title: "Example Feature Implementation",
          requirements: "This is an example task showing how to structure requirements for the Nightly Code Orchestrator.\\n\\nInclude detailed requirements, technical specifications, and any constraints here.",
          acceptance_criteria: [
            "Feature is implemented according to specifications",
            "All tests pass",
            "Code follows project conventions",
            "Documentation is updated"
          ],
          estimated_duration: 120,
          dependencies: [],
          tags: ["example", "feature"],
          files_to_modify: ["src/", "test/"],
          enabled: false
        }
      ]
    };
    
    await fs.writeJson(
      path.join(examplesDir, 'example-tasks.json'),
      exampleTasks,
      { spaces: 2 }
    );
    
    console.log(`📚 Created example files in ${examplesDir}`);
  }
  
  async setupLogging() {
    const logConfig = {
      version: "1.0",
      loggers: {
        default: {
          level: "info",
          format: "json",
          transports: [
            {
              type: "file",
              filename: path.join(this.userConfigDir, 'logs', 'nightly-code.log'),
              maxSize: "10MB",
              maxFiles: 5
            },
            {
              type: "console",
              level: "info",
              format: "simple"
            }
          ]
        },
        session: {
          level: "debug",
          format: "json",
          transports: [
            {
              type: "file",
              filename: path.join(this.userConfigDir, 'logs', 'sessions.log'),
              maxSize: "50MB",
              maxFiles: 10
            }
          ]
        }
      }
    };
    
    await fs.writeJson(
      path.join(this.userConfigDir, 'logging.json'),
      logConfig,
      { spaces: 2 }
    );
    
    console.log('📝 Set up logging configuration');
  }
  
  async createProjectIntegrationFiles() {
    // Create a helper script for project integration
    const integrationScript = `#!/bin/bash
# Nightly Code Project Integration Script
# This script helps integrate Nightly Code into existing projects

set -e

echo "🚀 Setting up Nightly Code for this project..."

# Check if we're in a git repository
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "❌ Not in a git repository. Please run 'git init' first."
  exit 1
fi

# Initialize nightly code configuration
if [ ! -f "nightly-code.yaml" ]; then
  echo "📝 Creating nightly-code configuration..."
  nightly-code init
else
  echo "📝 Nightly code configuration already exists"
fi

# Create .gitignore entries if needed
if [ -f ".gitignore" ]; then
  if ! grep -q ".nightly-code" .gitignore; then
    echo "# Nightly Code" >> .gitignore
    echo ".nightly-code/" >> .gitignore
    echo "Added .nightly-code/ to .gitignore"
  fi
fi

# Create GitHub workflow if .github directory exists
if [ -d ".github/workflows" ]; then
  if [ ! -f ".github/workflows/nightly-code.yml" ]; then
    echo "📋 Creating GitHub Actions workflow..."
    cat > .github/workflows/nightly-code.yml << 'EOF'
name: Nightly Code Session

on:
  schedule:
    - cron: '0 2 * * *'  # Run at 2 AM UTC daily
  workflow_dispatch:

jobs:
  nightly-code:
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    
    steps:
      - uses: actions/checkout@v4
        with:
          token: \${{ secrets.GITHUB_TOKEN }}
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Install Nightly Code
        run: npm install -g @nightly-code/orchestrator
      
      - name: Run Nightly Code Session
        run: nightly-code run --max-duration 240
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
EOF
    echo "Created GitHub Actions workflow"
  fi
fi

echo "✅ Project integration completed!"
echo "Next steps:"
echo "  1. Edit nightly-code.yaml and nightly-tasks.yaml"
echo "  2. Test with: nightly-code run --dry-run"
echo "  3. Schedule: nightly-code schedule"
`;

    const integrationPath = path.join(this.userConfigDir, 'scripts', 'integrate-project.sh');
    await fs.ensureDir(path.dirname(integrationPath));
    await fs.writeFile(integrationPath, integrationScript);
    await fs.chmod(integrationPath, '755');
    
    console.log('📜 Created project integration script');
  }
  
  async setupSystemService() {
    if (os.platform() === 'linux') {
      await this.setupSystemdService();
    } else if (os.platform() === 'darwin') {
      await this.setupLaunchdService();
    }
  }
  
  async setupSystemdService() {
    const serviceContent = `[Unit]
Description=Nightly Code Orchestrator
After=network.target

[Service]
Type=oneshot
User=%i
WorkingDirectory=/home/%i
ExecStart=/usr/bin/env nightly-code run
Environment=PATH=/usr/local/bin:/usr/bin:/bin
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
`;

    const servicePath = path.join(this.userConfigDir, 'systemd', 'nightly-code@.service');
    await fs.ensureDir(path.dirname(servicePath));
    await fs.writeFile(servicePath, serviceContent);
    
    console.log('📋 Created systemd service template');
    console.log('   To install: sudo cp ~/.nightly-code/systemd/nightly-code@.service /etc/systemd/system/');
    console.log('   To enable: sudo systemctl enable nightly-code@$(whoami).service');
  }
  
  async setupLaunchdService() {
    const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.nightly-code.orchestrator</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/env</string>
        <string>nightly-code</string>
        <string>run</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>22</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>WorkingDirectory</key>
    <string>/Users/$(whoami)</string>
    <key>StandardOutPath</key>
    <string>/Users/$(whoami)/.nightly-code/logs/launchd.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/$(whoami)/.nightly-code/logs/launchd-error.log</string>
</dict>
</plist>`;

    const plistPath = path.join(this.userConfigDir, 'launchd', 'com.nightly-code.orchestrator.plist');
    await fs.ensureDir(path.dirname(plistPath));
    await fs.writeFile(plistPath, plistContent);
    
    console.log('📋 Created launchd plist template');
    console.log('   To install: cp ~/.nightly-code/launchd/com.nightly-code.orchestrator.plist ~/Library/LaunchAgents/');
    console.log('   To load: launchctl load ~/Library/LaunchAgents/com.nightly-code.orchestrator.plist');
  }
}

// Run installation when executed directly
if (require.main === module) {
  const installer = new InstallHooks();
  installer.install()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}

module.exports = { InstallHooks };