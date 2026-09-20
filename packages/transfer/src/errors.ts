/**
 * @sos-2/transfer — errors (one error type per package, repo convention).
 */

export class TransferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransferError';
  }
}
