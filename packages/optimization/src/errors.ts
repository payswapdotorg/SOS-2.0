/**
 * @sos-2/optimization — errors (one error type per package, repo convention).
 */

export class OptimizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OptimizationError';
  }
}
