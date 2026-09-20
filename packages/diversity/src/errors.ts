/**
 * @sos-2/diversity — errors (one error type per package, repo convention).
 */

export class DiversityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiversityError';
  }
}
