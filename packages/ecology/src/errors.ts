/**
 * @sos-2/ecology — errors (one error type per package, repo convention).
 */

export class EcologyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EcologyError';
  }
}
