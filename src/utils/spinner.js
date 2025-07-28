const ora = require('ora');
const chalk = require('chalk');

/**
 * Simple spinner utility using ora with cli-spinners
 * Designed to work alongside existing pretty logger system
 */
const spinner = {
  current: null,
  isQuietMode: false,

  setQuietMode (quiet = true) {
    this.isQuietMode = quiet;
    return this;
  },

  start (text, spinnerType = 'dots12') {
    // Skip spinner if in quiet mode (when pretty logger is active)
    if (this.isQuietMode) {
      console.log(chalk.cyan(`⏳ ${text}`));
      return this;
    }

    if (this.current) {
      this.current.stop();
    }
    this.current = ora({
      text: chalk.cyan(text),
      spinner: spinnerType
    }).start();
    return this;
  },

  update (text) {
    if (this.isQuietMode) {
      console.log(chalk.cyan(`⏳ ${text}`));
      return this;
    }
    if (this.current) {
      this.current.text = chalk.cyan(text);
    }
    return this;
  },

  succeed (text) {
    if (this.isQuietMode) {
      console.log(chalk.green(`✔ ${text}`));
      return this;
    }
    if (this.current) {
      this.current.succeed(chalk.green(text));
      this.current = null;
    }
    return this;
  },

  fail (text) {
    if (this.isQuietMode) {
      console.log(chalk.red(`✖ ${text}`));
      return this;
    }
    if (this.current) {
      this.current.fail(chalk.red(text));
      this.current = null;
    }
    return this;
  },

  stop () {
    if (this.isQuietMode) {
      return this;
    }
    if (this.current) {
      this.current.stop();
      this.current = null;
    }
    return this;
  },

  async execute (text, operation, options = {}) {
    const { successText, failText, spinner: spinnerType } = options;

    this.start(text, spinnerType);

    try {
      const result = await operation;

      if (successText) {
        this.succeed(successText);
      } else {
        this.stop();
      }

      return result;
    } catch (error) {
      if (failText) {
        this.fail(failText);
      } else {
        this.fail(`Failed: ${error.message}`);
      }
      throw error;
    }
  },

  createProgress (steps) {
    let currentStep = 0;
    const totalSteps = steps.length;

    return {
      next: (customText) => {
        currentStep++;
        const stepText = customText || steps[currentStep - 1];
        const progressText = `[${currentStep}/${totalSteps}] ${stepText}`;

        if (currentStep === 1) {
          spinner.start(progressText);
        } else {
          spinner.update(progressText);
        }

        return spinner;
      },
      complete: (successText = 'All steps completed') => {
        spinner.succeed(successText);
        return spinner;
      },
      fail: (failText = 'Operation failed') => {
        spinner.fail(failText);
        return spinner;
      }
    };
  }
};

module.exports = spinner;
