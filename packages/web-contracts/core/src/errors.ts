/**
 * @sos-2/web-contracts error type. A single, small error class for the whole
 * package (the @sos-2/ui-contracts / @sos-2/authority precedent of one error
 * class per package).
 */

export class WebContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebContractError';
  }
}
