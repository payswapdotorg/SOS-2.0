/**
 * @sos-2/search — errors (one error type per package, repo convention).
 */

export class SearchError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SearchError';
  }
}
