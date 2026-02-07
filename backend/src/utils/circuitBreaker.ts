/**
 * Circuit Breaker Pattern
 *
 * Protects the application from cascading failures when external services
 * (IPFS, Bendystraw, RPC endpoints) are unavailable.
 *
 * States:
 * - CLOSED: Normal operation, requests flow through
 * - OPEN: Service is down, requests fail immediately
 * - HALF_OPEN: Testing if service has recovered
 */

import { CircuitBreakerError } from '../errors/AppError.ts';

type CircuitState = 'closed' | 'open' | 'half-open';

interface CircuitBreakerOptions {
  /** Number of failures before opening the circuit (default: 5) */
  failureThreshold?: number;
  /** Time to wait before attempting recovery in ms (default: 30000) */
  resetTimeout?: number;
  /** Number of successful calls in half-open to close circuit (default: 2) */
  successThreshold?: number;
  /** Optional callback when state changes */
  onStateChange?: (from: CircuitState, to: CircuitState, service: string) => void;
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures = 0;
  private successes = 0;
  private lastFailure = 0;

  private readonly failureThreshold: number;
  private readonly resetTimeout: number;
  private readonly successThreshold: number;
  private readonly onStateChange?: CircuitBreakerOptions['onStateChange'];

  constructor(
    private readonly serviceName: string,
    options: CircuitBreakerOptions = {}
  ) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeout = options.resetTimeout ?? 30000;
    this.successThreshold = options.successThreshold ?? 2;
    this.onStateChange = options.onStateChange;
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit should transition from open to half-open
    if (this.state === 'open') {
      if (Date.now() - this.lastFailure >= this.resetTimeout) {
        this.transition('half-open');
      } else {
        throw new CircuitBreakerError(this.serviceName);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Record a successful call
   */
  private onSuccess(): void {
    if (this.state === 'half-open') {
      this.successes++;
      if (this.successes >= this.successThreshold) {
        this.transition('closed');
      }
    }
    // In closed state, reset failure count on success
    if (this.state === 'closed') {
      this.failures = 0;
    }
  }

  /**
   * Record a failed call
   */
  private onFailure(): void {
    this.failures++;
    this.lastFailure = Date.now();

    if (this.state === 'half-open') {
      // Any failure in half-open immediately opens the circuit
      this.transition('open');
    } else if (this.state === 'closed' && this.failures >= this.failureThreshold) {
      this.transition('open');
    }
  }

  /**
   * Transition to a new state
   */
  private transition(newState: CircuitState): void {
    if (this.state === newState) return;

    const oldState = this.state;
    this.state = newState;

    // Reset counters on state change
    if (newState === 'closed') {
      this.failures = 0;
      this.successes = 0;
    } else if (newState === 'half-open') {
      this.successes = 0;
    }

    // Notify listener
    if (this.onStateChange) {
      this.onStateChange(oldState, newState, this.serviceName);
    }

    console.log(`[CircuitBreaker] ${this.serviceName}: ${oldState} -> ${newState}`);
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get circuit statistics
   */
  getStats(): {
    state: CircuitState;
    failures: number;
    successes: number;
    lastFailure: Date | null;
  } {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailure: this.lastFailure ? new Date(this.lastFailure) : null,
    };
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    this.transition('closed');
  }

  /**
   * Manually open the circuit (for maintenance, etc.)
   */
  open(): void {
    this.transition('open');
  }
}

// ============================================================================
// Pre-configured Circuit Breakers for External Services
// ============================================================================

const defaultOnStateChange = (from: CircuitState, to: CircuitState, service: string) => {
  if (to === 'open') {
    console.warn(`[CircuitBreaker] ${service} circuit OPENED after failures`);
  } else if (to === 'closed') {
    console.info(`[CircuitBreaker] ${service} circuit CLOSED, service recovered`);
  }
};

/**
 * Circuit breaker for Bendystraw GraphQL API
 */
export const bendystrawCircuit = new CircuitBreaker('bendystraw', {
  failureThreshold: 5,
  resetTimeout: 30000,
  successThreshold: 2,
  onStateChange: defaultOnStateChange,
});

/**
 * Circuit breaker for IPFS/Pinata API
 */
export const ipfsCircuit = new CircuitBreaker('ipfs', {
  failureThreshold: 3,
  resetTimeout: 60000, // IPFS can be slow, wait longer
  successThreshold: 2,
  onStateChange: defaultOnStateChange,
});

/**
 * Circuit breaker for Juicerkle API (merkle proofs)
 */
export const juicerkleCircuit = new CircuitBreaker('juicerkle', {
  failureThreshold: 5,
  resetTimeout: 30000,
  successThreshold: 2,
  onStateChange: defaultOnStateChange,
});

/**
 * Circuit breaker for MCP Documentation API
 */
export const mcpDocsCircuit = new CircuitBreaker('mcp-docs', {
  failureThreshold: 5,
  resetTimeout: 30000,
  successThreshold: 2,
  onStateChange: defaultOnStateChange,
});

/**
 * Get all circuit breaker stats for monitoring
 */
export function getAllCircuitStats(): Record<string, ReturnType<CircuitBreaker['getStats']>> {
  return {
    bendystraw: bendystrawCircuit.getStats(),
    ipfs: ipfsCircuit.getStats(),
    juicerkle: juicerkleCircuit.getStats(),
    mcpDocs: mcpDocsCircuit.getStats(),
  };
}
