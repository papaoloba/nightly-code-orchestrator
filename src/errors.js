/**
 * Custom error classes for nightly-claude-code
 * Provides standardized error handling across the application
 *
 * @fileoverview Comprehensive error hierarchy for structured error handling
 * @author nightly-claude-code
 */

/**
 * Base error class for all nightly-claude-code errors
 * Extends native Error with additional context and structured data
 *
 * @class NightlyCodeError
 * @extends Error
 *
 * @example
 * throw new NightlyCodeError('Operation failed', 'CUSTOM_ERROR', { operation: 'test' });
 */
class NightlyCodeError extends Error {
  /**
   * Create a new NightlyCodeError
   *
   * @param {string} message - Error message describing what went wrong
   * @param {string} [code='NIGHTLY_CODE_ERROR'] - Machine-readable error code
   * @param {Object} [context={}] - Additional context data for debugging
   */
  constructor (message, code = 'NIGHTLY_CODE_ERROR', context = {}) {
    super(message);
    this.name = 'NightlyCodeError';
    this.code = code;
    this.context = context;
    this.timestamp = new Date().toISOString();

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, NightlyCodeError);
    }
  }

  /**
   * Convert error to JSON-serializable object
   * Useful for logging and API responses
   *
   * @returns {Object} JSON representation of the error
   */
  toJSON () {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context,
      timestamp: this.timestamp,
      stack: this.stack
    };
  }
}

/**
 * Configuration and data validation errors
 * Used when input data doesn't meet expected format or constraints
 *
 * @class ValidationError
 * @extends NightlyCodeError
 *
 * @example
 * throw new ValidationError('Invalid email format', 'email', 'invalid@')
 */
class ValidationError extends NightlyCodeError {
  /**
   * Create a new ValidationError
   *
   * @param {string} message - Validation error message
   * @param {string|null} [field=null] - Field name that failed validation
   * @param {*} [value=null] - Value that failed validation
   */
  constructor (message, field = null, value = null) {
    super(message, 'VALIDATION_ERROR', { field, value });
    this.name = 'ValidationError';
    this.field = field;
    this.value = value;
  }
}

/**
 * Task execution related errors
 * Thrown during task setup, execution, validation, or cleanup phases
 *
 * @class TaskExecutionError
 * @extends NightlyCodeError
 *
 * @example
 * throw new TaskExecutionError('Task failed', 'task-123', 'execution')
 */
class TaskExecutionError extends NightlyCodeError {
  /**
   * Create a new TaskExecutionError
   *
   * @param {string} message - Error message
   * @param {string|null} [taskId=null] - ID of the failing task
   * @param {string|null} [phase=null] - Execution phase: 'setup', 'execution', 'validation', 'cleanup'
   */
  constructor (message, taskId = null, phase = null) {
    super(message, 'TASK_EXECUTION_ERROR', { taskId, phase });
    this.name = 'TaskExecutionError';
    this.taskId = taskId;
    this.phase = phase; // 'setup', 'execution', 'validation', 'cleanup'
  }
}

/**
 * Git operation errors
 */
class GitOperationError extends NightlyCodeError {
  constructor (message, operation = null, repository = null) {
    super(message, 'GIT_OPERATION_ERROR', { operation, repository });
    this.name = 'GitOperationError';
    this.operation = operation; // 'clone', 'commit', 'push', 'pull', etc.
    this.repository = repository;
  }
}

/**
 * File system operation errors
 */
class FileSystemError extends NightlyCodeError {
  constructor (message, path = null, operation = null) {
    super(message, 'FILE_SYSTEM_ERROR', { path, operation });
    this.name = 'FileSystemError';
    this.path = path;
    this.operation = operation; // 'read', 'write', 'delete', 'create', etc.
  }
}

/**
 * Network/API operation errors
 */
class NetworkError extends NightlyCodeError {
  constructor (message, url = null, statusCode = null, retryable = false) {
    super(message, 'NETWORK_ERROR', { url, statusCode, retryable });
    this.name = 'NetworkError';
    this.url = url;
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

/**
 * Rate limiting errors
 */
class RateLimitError extends NightlyCodeError {
  constructor (message, retryAfter = null, limit = null) {
    super(message, 'RATE_LIMIT_ERROR', { retryAfter, limit });
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter; // seconds to wait before retry
    this.limit = limit;
  }
}

/**
 * Resource exhaustion errors (memory, disk, etc.)
 */
class ResourceError extends NightlyCodeError {
  constructor (message, resource = null, available = null, required = null) {
    super(message, 'RESOURCE_ERROR', { resource, available, required });
    this.name = 'ResourceError';
    this.resource = resource; // 'memory', 'disk', 'cpu', etc.
    this.available = available;
    this.required = required;
  }
}

/**
 * Timeout errors
 */
class TimeoutError extends NightlyCodeError {
  constructor (message, operation = null, timeout = null) {
    super(message, 'TIMEOUT_ERROR', { operation, timeout });
    this.name = 'TimeoutError';
    this.operation = operation;
    this.timeout = timeout; // timeout value in milliseconds
  }
}

/**
 * Configuration errors
 */
class ConfigurationError extends NightlyCodeError {
  constructor (message, configPath = null, setting = null) {
    super(message, 'CONFIGURATION_ERROR', { configPath, setting });
    this.name = 'ConfigurationError';
    this.configPath = configPath;
    this.setting = setting;
  }
}

/**
 * Dependency errors (missing tools, packages, etc.)
 */
class DependencyError extends NightlyCodeError {
  constructor (message, dependency = null, version = null) {
    super(message, 'DEPENDENCY_ERROR', { dependency, version });
    this.name = 'DependencyError';
    this.dependency = dependency;
    this.version = version;
  }
}

/**
 * Error classification utility for intelligent error handling
 * Provides methods to analyze errors and determine appropriate response strategies
 *
 * @class ErrorClassifier
 * @static
 */
class ErrorClassifier {
  /**
   * Classify an error based on its type and properties
   * @param {Error} error - The error to classify
   * @returns {Object} Classification result
   */
  static classify (error) {
    const classification = {
      severity: 'medium',
      category: 'unknown',
      retryable: false,
      recoverable: true,
      code: error.code || 'UNKNOWN_ERROR'
    };

    // Classify by error type
    if (error instanceof ValidationError) {
      classification.severity = 'high';
      classification.category = 'validation';
      classification.retryable = false;
      classification.recoverable = false;
    } else if (error instanceof TaskExecutionError) {
      classification.severity = 'high';
      classification.category = 'execution';
      classification.retryable = error.phase !== 'validation';
      classification.recoverable = true;
    } else if (error instanceof GitOperationError) {
      classification.severity = 'medium';
      classification.category = 'git';
      classification.retryable = ['push', 'pull', 'fetch'].includes(error.operation);
      classification.recoverable = true;
    } else if (error instanceof RateLimitError) {
      classification.severity = 'low';
      classification.category = 'rate_limit';
      classification.retryable = true;
      classification.recoverable = true;
    } else if (error instanceof NetworkError) {
      classification.severity = 'medium';
      classification.category = 'network';
      classification.retryable = error.retryable || [429, 500, 502, 503, 504].includes(error.statusCode);
      classification.recoverable = true;
    } else if (error instanceof ResourceError) {
      classification.severity = 'high';
      classification.category = 'resource';
      classification.retryable = false;
      classification.recoverable = error.resource !== 'disk';
    } else if (error instanceof TimeoutError) {
      classification.severity = 'medium';
      classification.category = 'timeout';
      classification.retryable = true;
      classification.recoverable = true;
    } else if (error instanceof DependencyError) {
      classification.severity = 'high';
      classification.category = 'dependency';
      classification.retryable = false;
      classification.recoverable = false;
    } else if (error instanceof ConfigurationError) {
      classification.severity = 'high';
      classification.category = 'configuration';
      classification.retryable = false;
      classification.recoverable = false;
    }

    return classification;
  }

  /**
   * Determine if an error should halt execution
   * @param {Error} error - The error to evaluate
   * @returns {boolean} True if execution should halt
   */
  static shouldHaltExecution (error) {
    const classification = this.classify(error);
    return classification.severity === 'high' && !classification.recoverable;
  }

  /**
   * Get recommended retry delay for an error
   * @param {Error} error - The error to evaluate
   * @param {number} attempt - Current attempt number (0-based)
   * @returns {number} Delay in milliseconds, or 0 if not retryable
   */
  static getRetryDelay (error, attempt = 0) {
    const classification = this.classify(error);

    if (!classification.retryable) {
      return 0;
    }

    if (error instanceof RateLimitError && error.retryAfter) {
      return error.retryAfter * 1000; // Convert seconds to milliseconds
    }

    // Exponential backoff with jitter
    const baseDelay = 1000; // 1 second
    const maxDelay = 60000; // 1 minute
    const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
    const jitter = Math.random() * 0.1 * delay; // 10% jitter

    return Math.floor(delay + jitter);
  }
}

module.exports = {
  NightlyCodeError,
  ValidationError,
  TaskExecutionError,
  GitOperationError,
  FileSystemError,
  NetworkError,
  RateLimitError,
  ResourceError,
  TimeoutError,
  ConfigurationError,
  DependencyError,
  ErrorClassifier
};
