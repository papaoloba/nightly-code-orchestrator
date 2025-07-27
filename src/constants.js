/**
 * Time-related constants for nightly-claude-code application
 * All values are in their respective units as documented
 * @namespace TIME
 */
module.exports.TIME = {
  // Durations in seconds
  SECONDS: {
    MAX_SESSION_DURATION: 28800, // 8 hours in seconds
    MIN_SESSION_DURATION: 300, // 5 minutes in seconds
    DEFAULT_CHECKPOINT_INTERVAL: 300, // 5 minutes in seconds
    MIN_CHECKPOINT_INTERVAL: 60, // 1 minute in seconds
    MAX_CHECKPOINT_INTERVAL: 3600, // 1 hour in seconds
    DEFAULT_TASK_TIMEOUT: 300, // 5 minutes in seconds
    MAX_TASK_TIMEOUT: 3600, // 1 hour in seconds
    DEFAULT_TASK_DURATION_MINUTES: 60 // 1 hour default task duration
  },

  // Durations in milliseconds
  MS: {
    ONE_SECOND: 1000,
    FIVE_SECONDS: 5000,
    ONE_MINUTE: 60000,
    FIVE_MINUTES: 300000,
    ONE_HOUR: 3600000,
    RATE_LIMIT_BASE_DELAY: 60000, // 1 minute base delay for rate limiting
    MIN_RATE_LIMIT_DELAY: 60000, // 1 minute minimum
    MAX_RATE_LIMIT_DELAY: 18000000, // 5 hours maximum
    DEFAULT_COMMAND_TIMEOUT: 60000, // 1 minute default command timeout
    CARGO_CHECK_TIMEOUT: 60000 // 1 minute for cargo check
  }
};

/**
 * Storage and disk space related constants
 * @namespace STORAGE
 */
module.exports.STORAGE = {
  BYTES_IN_GB: 1000000000,
  MIN_DISK_SPACE_GB: 1, // Minimum 1GB disk space required
  MIN_DISK_SPACE_BYTES: 1000000000 // 1GB in bytes
};

/**
 * Retry logic and rate limiting configuration constants
 * @namespace RETRY
 */
module.exports.RETRY = {
  DEFAULT_RETRIES: 5,
  MAX_RETRIES: 10,
  GENERAL_ERROR_DELAY: 5000 // 5 seconds for general errors
};

/**
 * System limits and validation thresholds
 * @namespace LIMITS
 */
module.exports.LIMITS = {
  MAX_CONCURRENT_TASKS: 5,
  MIN_CONCURRENT_TASKS: 1,
  DEFAULT_CONCURRENT_TASKS: 1,
  MAX_VALIDATOR_TIMEOUT: 3600, // 1 hour in seconds
  MIN_VALIDATOR_TIMEOUT: 1, // 1 second minimum
  LOG_LINE_REPEAT_COUNT: 50 // Number of dashes in log separators
};

/**
 * Memory usage constants and thresholds
 * @namespace MEMORY
 */
module.exports.MEMORY = {
  BYTES_IN_GB: 1000000000,
  LOW_MEMORY_THRESHOLD_GB: 1 // Warning if less than 1GB available
};
