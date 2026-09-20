/**
 * @sos-2/retrieval — errors (one error type per package, repo convention).
 */

export class RetrievalFacadeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RetrievalFacadeError';
  }
}
