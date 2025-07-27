describe('Basic Package Tests', () => {
  it('should load the main module without errors', () => {
    expect(() => {
      require('../src/index.js');
    }).not.toThrow();
  });

  it('should export expected classes', () => {
    const pkg = require('../src/index.js');

    expect(pkg.Orchestrator).toBeDefined();
    expect(pkg.TaskManager).toBeDefined();
    expect(pkg.GitManager).toBeDefined();
    expect(pkg.Validator).toBeDefined();
    expect(pkg.Reporter).toBeDefined();
  });

  it('should have valid package.json', () => {
    const packageJson = require('../package.json');

    expect(packageJson.name).toBe('@nightly-code/orchestrator');
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(packageJson.main).toBe('src/index.js');
    expect(packageJson.bin['nightly-code']).toBe('./bin/nightly-code');
  });

  it('should be able to create class instances', () => {
    const { TaskManager, GitManager, Validator, Reporter } = require('../src/index.js');

    expect(() => new TaskManager()).not.toThrow();
    expect(() => new GitManager()).not.toThrow();
    expect(() => new Validator()).not.toThrow();
    expect(() => new Reporter()).not.toThrow();
  });
});
