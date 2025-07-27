#!/usr/bin/env node

/**
 * Demo script for the describe command
 * Shows various ways to use natural language to describe tasks
 */

const chalk = require('chalk');

console.log(chalk.blue('🎯 Nightly Code - Describe Command Examples'));
console.log(chalk.gray('═'.repeat(60)));

console.log(chalk.yellow('\n1. Simple task description:'));
console.log(chalk.gray('   nightly-code describe "Fix the memory leak in the data processing module"'));

console.log(chalk.yellow('\n2. Complex feature with details:'));
console.log(chalk.gray(`   nightly-code describe "Implement user authentication system with:
   - Email and password registration
   - JWT token generation
   - Password reset functionality
   - Email verification
   - Protected routes middleware"`));

console.log(chalk.yellow('\n3. Interactive mode for multiple tasks:'));
console.log(chalk.gray('   nightly-code describe --interactive'));

console.log(chalk.yellow('\n4. Load tasks from a file:'));
console.log(chalk.gray('   nightly-code describe --file tasks.txt'));

console.log(chalk.yellow('\n5. Append to existing tasks:'));
console.log(chalk.gray('   nightly-code describe "Add unit tests for the new API endpoints" --append'));

console.log(chalk.yellow('\n6. Output to custom file:'));
console.log(chalk.gray('   nightly-code describe "Refactor the entire API layer for better performance" --output custom-tasks.yaml'));

console.log(chalk.blue('\n📝 Natural Language Examples:'));
console.log(chalk.gray('═'.repeat(60)));

const examples = [
  {
    description: "Fix critical bug in payment processing that causes transactions to fail",
    result: "Type: bugfix, Priority: 9, Tags: [bugfix, backend]"
  },
  {
    description: "Add comprehensive unit tests for the authentication module",
    result: "Type: test, Priority: 6, Tags: [testing, backend, security]"
  },
  {
    description: "Create a responsive dashboard component with charts and real-time updates",
    result: "Type: feature, Priority: 6, Tags: [frontend, feature]"
  },
  {
    description: "Update API documentation to include new endpoints and examples",
    result: "Type: docs, Priority: 3, Tags: [documentation, backend]"
  },
  {
    description: "Optimize database queries to improve performance by 50%",
    result: "Type: refactor, Priority: 7, Tags: [performance, backend, refactor]"
  }
];

examples.forEach((example, index) => {
  console.log(chalk.cyan(`\n${index + 1}. "${example.description}"`));
  console.log(chalk.green(`   → ${example.result}`));
});

console.log(chalk.blue('\n💡 Tips:'));
console.log(chalk.gray('═'.repeat(60)));
console.log(chalk.gray('• Use keywords like "critical", "urgent", "high priority" to set task priority'));
console.log(chalk.gray('• Include technical details for better task generation'));
console.log(chalk.gray('• Use bullet points or numbered lists for acceptance criteria'));
console.log(chalk.gray('• Mention specific files or directories to be modified'));
console.log(chalk.gray('• The AI will automatically detect task type, tags, and duration'));

console.log(chalk.blue('\n🔄 Output Options:'));
console.log(chalk.gray('═'.repeat(60)));
console.log(chalk.gray('The describe command offers flexible output options:'));
console.log(chalk.gray('• Custom output file with --output filename.yaml'));
console.log(chalk.gray('• Append to existing tasks with --append'));
console.log(chalk.gray('• Interactive mode for multiple task entry'));
console.log(chalk.gray('• File input for batch processing'));

console.log();