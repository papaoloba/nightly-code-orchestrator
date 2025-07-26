// Jest setup file for global test configuration

// Increase timeout for integration tests
jest.setTimeout(30000);

// Mock console methods to reduce noise during tests
const originalConsole = global.console;

beforeEach(() => {
  // Reset console mocks before each test
  global.console = {
    ...originalConsole,
    log: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };
});

afterEach(() => {
  // Restore original console after each test
  global.console = originalConsole;
});

// Global test utilities
global.testUtils = {
  // Create a mock logger for testing
  createMockLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }),

  // Create temporary directory for tests
  createTempDir: () => {
    const os = require('os');
    const path = require('path');
    const fs = require('fs-extra');

    const tempDir = path.join(os.tmpdir(), `nightly-code-test-${Date.now()}`);
    fs.ensureDirSync(tempDir);
    return tempDir;
  },

  // Clean up temporary directory
  cleanupTempDir: (tempDir) => {
    const fs = require('fs-extra');
    if (fs.pathExistsSync(tempDir)) {
      fs.removeSync(tempDir);
    }
  },

  // Wait for a promise to resolve
  wait: (ms) => new Promise(resolve => setTimeout(resolve, ms)),

  // Create mock task object
  createMockTask: (overrides = {}) => ({
    id: 'test-task',
    type: 'feature',
    priority: 5,
    title: 'Test Task',
    requirements: 'Test requirements',
    acceptance_criteria: ['Test criteria'],
    estimated_duration: 60,
    dependencies: [],
    tags: ['test'],
    files_to_modify: ['src/'],
    enabled: true,
    ...overrides
  }),

  // Create mock session state
  createMockSessionState: (overrides = {}) => ({
    startTime: Date.now() - 3600000, // 1 hour ago
    endTime: Date.now(),
    sessionId: `test-session-${Date.now()}`,
    completedTasks: [],
    failedTasks: [],
    checkpoints: [],
    resourceUsage: [],
    sessionBranches: [],
    ...overrides
  })
};

// Setup environment variables for tests
process.env.NODE_ENV = 'test';
process.env.NIGHTLY_CODE_LOG_LEVEL = 'error'; // Reduce log noise in tests

// Suppress specific warnings during tests
const originalEmit = process.emit;
process.emit = function (name, data, ...args) {
  // Suppress ExperimentalWarning messages
  if (
    name === 'warning' &&
    typeof data === 'object' &&
    data.name === 'ExperimentalWarning'
  ) {
    return false;
  }

  return originalEmit.apply(process, arguments);
};
