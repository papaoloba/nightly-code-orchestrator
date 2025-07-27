module.exports = {
  // Test environment
  testEnvironment: 'node',
  
  // Test file patterns
  testMatch: [
    '**/test/**/*.test.js',
    '**/__tests__/**/*.js',
    '**/*.test.js'
  ],
  
  // Coverage configuration
  collectCoverage: false,
  
  // Setup files
  setupFilesAfterEnv: ['<rootDir>/test/setup.js'],
  
  // Module paths
  moduleDirectories: ['node_modules', 'src'],
  
  // Test timeout
  testTimeout: 30000,
  
  // Clear mocks between tests
  clearMocks: true,
  restoreMocks: true,
  
  // Verbose output
  verbose: true,
  
  // Transform configuration (if needed for ES modules)
  transform: {},
  
  // Mock configuration
  modulePathIgnorePatterns: [
    '<rootDir>/test/fixtures/'
  ],
  
  // Test results processor
  reporters: ['default']
};