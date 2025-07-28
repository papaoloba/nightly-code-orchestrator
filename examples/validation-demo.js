#!/usr/bin/env node

/**
 * Demo of improved YAML validation with pretty logging
 * 
 * This demonstrates:
 * 1. Custom validation script existence checking (now fails validation instead of warning)
 * 2. Pretty formatted validation output using PrettyLogger
 * 3. More robust validation with detailed error reporting
 */

const { Validator } = require('../src/utils/validator');
const { TaskManager } = require('../src/core/task-manager');
const fs = require('fs-extra');
const path = require('path');
const YAML = require('yaml');

async function createDemoFiles() {
  // Create a config file
  const config = {
    session: {
      max_duration: 14400,
      time_zone: 'UTC'
    },
    project: {
      root_directory: './',
      package_manager: 'npm'
    },
    validation: {
      custom_validators: [
        {
          name: 'security-check',
          command: 'npm audit',
          timeout: 60,
          required: true
        }
      ]
    }
  };
  
  await fs.writeFile('demo-config.yaml', YAML.stringify(config));
  
  // Create tasks with various validation scenarios
  const tasks = {
    tasks: [
      {
        id: 'task-001',
        title: 'Valid task without custom validation',
        requirements: 'Basic feature implementation',
        type: 'feature',
        estimated_duration: 60
      },
      {
        id: 'task-002',
        title: 'Task with existing custom validation script',
        requirements: 'Feature with custom validation',
        type: 'feature',
        estimated_duration: 90,
        custom_validation: {
          script: './package.json', // Using existing file for demo
          timeout: 300
        }
      },
      {
        id: 'task-003',
        title: 'Task with non-existent custom validation script',
        requirements: 'This should fail validation',
        type: 'bugfix',
        estimated_duration: 45,
        custom_validation: {
          script: './scripts/missing-validator.js',
          timeout: 300
        }
      },
      {
        id: 'task-004',
        title: 'Task with dangerous file pattern',
        requirements: 'Test file pattern validation',
        type: 'refactor',
        estimated_duration: 30,
        files_to_modify: ['src/**/*.js', '../../../etc/passwd', '~/sensitive']
      }
    ]
  };
  
  await fs.writeFile('demo-tasks.yaml', YAML.stringify(tasks));
}

async function runValidationDemo() {
  console.log('\n🎯 Nightly Code - Enhanced Validation Demo\n');
  console.log('This demo shows the improved YAML validation with:');
  console.log('  • Custom validation script existence checking');
  console.log('  • Pretty formatted output using PrettyLogger');
  console.log('  • More robust error handling\n');
  
  await createDemoFiles();
  
  try {
    // Initialize validator with demo files
    const validator = new Validator({
      configPath: 'demo-config.yaml',
      tasksPath: 'demo-tasks.yaml'
    });
    
    // Run comprehensive validation
    console.log('Starting validation...\n');
    const results = await validator.validateAll();
    
    console.log('\n📈 Summary:');
    console.log(`   Valid: ${results.valid ? '✅ Yes' : '❌ No'}`);
    console.log(`   Errors: ${results.errors.length}`);
    console.log(`   Warnings: ${results.warnings.length}\n`);
    
    // Demonstrate TaskManager validation as well
    console.log('Testing TaskManager validation for custom scripts...\n');
    const taskManager = new TaskManager();
    
    try {
      await taskManager.loadTasks('demo-tasks.yaml');
    } catch (error) {
      console.log('❌ TaskManager validation error (as expected):');
      console.log(`   ${error.message}\n`);
    }
    
  } finally {
    // Clean up demo files
    await fs.remove('demo-config.yaml');
    await fs.remove('demo-tasks.yaml');
  }
}

// Run the demo
runValidationDemo().catch(console.error);