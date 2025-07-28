module.exports = {
  env: {
    browser: false,
    commonjs: true,
    es6: true,
    node: true,
    jest: true
  },
  extends: ['standard'],
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module'
  },
  rules: {
    // Adjust rules for our specific use case
    'no-console': 'off', // We need console for CLI output
    'no-process-exit': 'off', // CLI tools need to exit with codes
    'prefer-const': 'error',
    'no-var': 'error',
    'object-shorthand': 'error',
    'prefer-arrow-callback': 'error',
    'prefer-template': 'error',
    'template-curly-spacing': ['error', 'never'],
    'arrow-spacing': 'error',
    'generator-star-spacing': ['error', 'after'],
    'yield-star-spacing': ['error', 'after'],
    'no-trailing-spaces': 'error',
    'eol-last': 'error',
    'comma-dangle': ['error', 'never'],
    semi: ['error', 'always'],
    quotes: ['error', 'single', { avoidEscape: true }],
    indent: ['error', 2, { SwitchCase: 1 }],
    'max-len': ['warn', { code: 120, ignoreComments: true, ignoreUrls: true }],
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    camelcase: ['error', { properties: 'never', ignoreDestructuring: true }]
  },
  overrides: [
    {
      files: ['test/**/*.js', '**/*.test.js', '**/*.spec.js'],
      env: {
        jest: true
      },
      rules: {
        // More lenient rules for tests
        'max-len': 'off',
        'no-unused-expressions': 'off'
      }
    },
    {
      files: ['bin/**/*'],
      rules: {
        // CLI scripts may need different rules
        'no-console': 'off',
        'no-process-exit': 'off'
      }
    }
  ]
};
