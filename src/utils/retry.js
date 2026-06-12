// Utility functions for retry mechanisms with exponential backoff and circuit breaker patterns

/**
 * Retry a function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @param {number} options.maxAttempts - Maximum number of attempts (default: 3)
 * @param {number} options.baseDelay - Base delay in ms (default: 100)
 * @param {number} options.maxDelay - Maximum delay in ms (default: 5000)
 * @param {number} options.jitter - Jitter factor (default: 0.1)
 * @param {Array} options.retryConditions - Array of error conditions to retry on
 * @returns {Promise<any>} Result of the function
 */
async function retryWithBackoff(fn, options = {}) {
  const {
    maxAttempts = 3,
    baseDelay = 100,
    maxDelay = 5000,
    jitter = 0.1,
    retryConditions = []
  } = options;

  let lastError;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // If this is the last attempt, don't retry
      if (attempt === maxAttempts - 1) {
        break;
      }

      // Check if we should retry based on conditions
      if (retryConditions.length > 0) {
        const shouldRetry = retryConditions.some(condition =>
          condition instanceof RegExp ? condition.test(error.message) :
          typeof condition === 'function' ? condition(error) :
          error.message.includes(condition)
        );

        if (!shouldRetry) {
          break;
        }
      }

      // Calculate delay with exponential backoff and jitter
      const delay = Math.min(
        baseDelay * Math.pow(2, attempt) + Math.random() * jitter * baseDelay * Math.pow(2, attempt),
        maxDelay
      );

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Simple circuit breaker implementation
 */
class CircuitBreaker {
  /**
   * @param {Object} options - Circuit breaker options
   * @param {number} options.failureThreshold - Number of failures before opening (default: 5)
   * @param {number} options.timeout - Time in ms before attempting to close (default: 60000)
   * @param {number} options.resetTimeout - Time in ms before trying half-open state (default: 30000)
   */
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.timeout = options.timeout || 60000;
    this.resetTimeout = options.resetTimeout || 30000;

    this.failureCount = 0;
    this.lastFailureTime = null;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
  }

  /**
   * Execute a function through the circuit breaker
   * @param {Function} fn - Async function to execute
   * @returns {Promise<any>} Result of the function
   */
  async execute(fn) {
    const now = Date.now();

    // Check if we should transition from OPEN to HALF_OPEN
    if (this.state === 'OPEN' && now - this.lastFailureTime > this.timeout) {
      this.state = 'HALF_OPEN';
    }

    // Reject if circuit is OPEN
    if (this.state === 'OPEN') {
      throw new Error('Circuit breaker is OPEN');
    }

    try {
      const result = await fn();

      // Reset on success
      if (this.state === 'HALF_OPEN') {
        this.state = 'CLOSED';
        this.failureCount = 0;
      }

      return result;
    } catch (error) {
      this.failureCount++;
      this.lastFailureTime = now;

      // Open circuit if failure threshold reached
      if (this.failureCount >= this.failureThreshold) {
        this.state = 'OPEN';
      }

      throw error;
    }
  }

  /**
   * Get current state of the circuit breaker
   * @returns {Object} Current state information
   */
  getState() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime
    };
  }

  /**
   * Reset the circuit breaker to initial state
   */
  reset() {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.lastFailureTime = null;
  }
}

module.exports = {
  retryWithBackoff,
  CircuitBreaker
};