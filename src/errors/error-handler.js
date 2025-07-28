/**
 * Standardized error handling utilities for nightly-claude-code
 * Provides consistent error handling, logging, and recovery mechanisms
 */

const { TIME, RETRY } = require('../utils/constants');
const { ErrorClassifier } = require('./errors');

/**
 * Standardized error handler with retry logic and recovery mechanisms
 */
class ErrorHandler {
  constructor (logger = console, options = {}) {
    this.logger = logger;
    this.options = {
      enableRetry: options.enableRetry !== false,
      maxRetries: options.maxRetries || RETRY.DEFAULT_RETRIES,
      enableRecovery: options.enableRecovery !== false,
      logLevel: options.logLevel || 'error',
      contextName: options.contextName || 'Unknown',
      ...options
    };
  }

  /**
   * Execute an operation with standardized error handling and retry logic
   * @param {Function} operation - Async function to execute
   * @param {Object} options - Execution options
   * @returns {Promise<any>} Operation result
   */
  async executeWithRetry (operation, options = {}) {
    const config = {
      maxRetries: options.maxRetries || this.options.maxRetries,
      enableRetry: options.enableRetry !== false && this.options.enableRetry,
      fallback: options.fallback || null,
      operationName: options.operationName || 'Unknown Operation',
      critical: options.critical || false,
      ...options
    };

    let lastError = null;
    const startTime = Date.now();

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        this.logAttempt(config.operationName, attempt, config.maxRetries);
        const result = await operation();

        if (attempt > 0) {
          this.logRetrySuccess(config.operationName, attempt, Date.now() - startTime);
        }

        return result;
      } catch (error) {
        lastError = error;
        const classification = ErrorClassifier.classify(error);

        // Log the error with context
        this.logError(error, {
          operation: config.operationName,
          attempt: attempt + 1,
          maxRetries: config.maxRetries + 1,
          classification
        });

        // Check if we should halt execution
        if (classification.severity === 'high' && !classification.recoverable) {
          this.logFatalError(error, config.operationName);
          throw error;
        }

        // Check if we've exhausted retries
        if (attempt >= config.maxRetries) {
          if (config.fallback) {
            this.logFallbackAttempt(config.operationName);
            try {
              return await config.fallback(error);
            } catch (fallbackError) {
              this.logFallbackFailure(config.operationName, fallbackError);
              throw fallbackError;
            }
          }

          this.logMaxRetriesExhausted(config.operationName, attempt + 1);
          throw error;
        }

        // Check if error is retryable
        if (!config.enableRetry || !classification.retryable) {
          this.logNonRetryableError(error, config.operationName);
          throw error;
        }

        // Calculate and apply retry delay
        const delay = ErrorClassifier.getRetryDelay(error, attempt);
        if (delay > 0) {
          this.logRetryDelay(config.operationName, delay, attempt + 1, config.maxRetries + 1);
          await this.sleep(delay);
        }
      }
    }

    // This should never be reached, but included for completeness
    throw lastError;
  }

  /**
   * Execute an operation with graceful degradation
   * @param {Function} operation - Primary operation to execute
   * @param {Function|any} fallback - Fallback operation or default value
   * @param {Object} options - Execution options
   * @returns {Promise<any>} Operation result or fallback
   */
  async executeWithFallback (operation, fallback, options = {}) {
    const config = {
      operationName: options.operationName || 'Unknown Operation',
      logFallback: options.logFallback !== false,
      ...options
    };

    try {
      return await operation();
    } catch (error) {
      if (config.logFallback) {
        this.logFallbackUsed(config.operationName, error);
      }

      if (typeof fallback === 'function') {
        return await fallback(error);
      }

      return fallback;
    }
  }

  /**
   * Wrap a function with standardized error handling
   * @param {Function} fn - Function to wrap
   * @param {Object} options - Wrapping options
   * @returns {Function} Wrapped function
   */
  wrapWithErrorHandling (fn, options = {}) {
    const config = {
      operationName: options.operationName || fn.name || 'Anonymous Function',
      ...options
    };

    return async (...args) => {
      return this.executeWithRetry(() => fn(...args), config);
    };
  }

  /**
   * Log an error with standardized format and context
   * @param {Error} error - Error to log
   * @param {Object} context - Additional context
   */
  logError (error, context = {}) {
    const logData = this.formatErrorLog(error, context);

    if (this.logger && typeof this.logger.error === 'function') {
      this.logger.error(logData.message, logData.metadata);
    } else {
      console.error(JSON.stringify(logData, null, 2));
    }
  }

  // File-scoped logging convenience methods
  log (level, message) {
    if (this.logger && typeof this.logger[level] === 'function') {
      this.logger[level](`[${this.options.contextName}] ${message}`);
    } else {
      console[level](`[${this.options.contextName}] ${message}`);
    }
  }

  logInfo (message) {
    this.log('info', message);
  }

  logWarn (message) {
    this.log('warn', message);
  }

  logDebug (message) {
    this.log('debug', message);
  }

  /**
   * Format error for consistent logging
   * @param {Error} error - Error to format
   * @param {Object} context - Additional context
   * @returns {Object} Formatted log data
   */
  formatErrorLog (error, context = {}) {
    const classification = ErrorClassifier.classify(error);

    return {
      message: `[${this.options.contextName}] ${context.operation || 'Operation'} failed: ${error.message}`,
      metadata: {
        error: {
          name: error.name,
          message: error.message,
          code: error.code || 'UNKNOWN',
          stack: error.stack,
          context: error.context || {}
        },
        classification,
        context: {
          module: this.options.contextName,
          timestamp: new Date().toISOString(),
          ...context
        }
      }
    };
  }

  /**
   * Create a recovery function that attempts multiple strategies
   * @param {Array} strategies - Array of recovery functions
   * @param {Object} options - Recovery options
   * @returns {Function} Recovery function
   */
  createRecoveryChain (strategies, options = {}) {
    const config = {
      operationName: options.operationName || 'Recovery Chain',
      stopOnFirstSuccess: options.stopOnFirstSuccess !== false,
      ...options
    };

    return async (originalError) => {
      let lastRecoveryError = originalError;
      const results = [];

      for (let i = 0; i < strategies.length; i++) {
        const strategy = strategies[i];
        const strategyName = strategy.name || `Strategy ${i + 1}`;

        try {
          this.logRecoveryAttempt(config.operationName, strategyName);
          const result = await strategy(originalError);
          results.push({ strategy: strategyName, success: true, result });

          if (config.stopOnFirstSuccess) {
            this.logRecoverySuccess(config.operationName, strategyName);
            return result;
          }
        } catch (recoveryError) {
          lastRecoveryError = recoveryError;
          results.push({ strategy: strategyName, success: false, error: recoveryError });
          this.logRecoveryFailure(config.operationName, strategyName, recoveryError);
        }
      }

      if (config.stopOnFirstSuccess) {
        this.logAllRecoveryStrategiesFailed(config.operationName);
        throw lastRecoveryError;
      }

      return results;
    };
  }

  // Utility methods for sleeping
  sleep (ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Logging methods for different scenarios
  logAttempt (operationName, attempt, maxRetries) {
    if (attempt > 0) {
      this.logInfo(`Retrying ${operationName} (attempt ${attempt + 1}/${maxRetries + 1})`);
    }
  }

  logRetrySuccess (operationName, attempts, duration) {
    this.logInfo(`${operationName} succeeded after ${attempts} retries (${Math.round(duration / TIME.MS.ONE_SECOND)}s)`);
  }

  logFatalError (error, operationName) {
    this.log('error', `💥 Fatal error in ${operationName}: ${error.message}`);
  }

  logMaxRetriesExhausted (operationName, totalAttempts) {
    this.log('error', `❌ ${operationName} failed after ${totalAttempts} attempts`);
  }

  logNonRetryableError (error, operationName) {
    this.logWarn(`⚠️  ${operationName} failed with non-retryable error: ${error.message}`);
  }

  logRetryDelay (operationName, delay, attempt, maxAttempts) {
    const delaySeconds = Math.round(delay / TIME.MS.ONE_SECOND);
    this.logInfo(`🔄 Waiting ${delaySeconds}s before retry (${attempt}/${maxAttempts})`);
  }

  logFallbackAttempt (operationName) {
    this.logInfo(`🔄 Attempting fallback for ${operationName}`);
  }

  logFallbackFailure (operationName, error) {
    this.log('error', `❌ Fallback failed for ${operationName}: ${error.message}`);
  }

  logFallbackUsed (operationName, originalError) {
    this.logWarn(`⚠️  Using fallback for ${operationName} due to: ${originalError.message}`);
  }

  logRecoveryAttempt (operationName, strategyName) {
    this.logInfo(`🔧 Attempting recovery for ${operationName} using ${strategyName}`);
  }

  logRecoverySuccess (operationName, strategyName) {
    this.logInfo(`✅ Recovery successful for ${operationName} using ${strategyName}`);
  }

  logRecoveryFailure (operationName, strategyName, error) {
    this.logWarn(`⚠️  Recovery strategy ${strategyName} failed for ${operationName}: ${error.message}`);
  }

  logAllRecoveryStrategiesFailed (operationName) {
    this.log('error', `❌ All recovery strategies failed for ${operationName}`);
  }
}

/**
 * Create a standardized error handler for a specific module
 * @param {string} moduleName - Name of the module
 * @param {Object} logger - Logger instance
 * @param {Object} options - Handler options
 * @returns {ErrorHandler} Configured error handler
 */
function createErrorHandler (moduleName, logger, options = {}) {
  return new ErrorHandler(logger, {
    contextName: moduleName,
    ...options
  });
}

module.exports = {
  ErrorHandler,
  createErrorHandler
};
