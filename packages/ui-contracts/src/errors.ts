/**
 * @sos-2/ui-contracts error type. A single, small error class for the whole
 * package (the @sos-2/authority precedent of one error class per package).
 */

export class UIContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UIContractError';
  }
}
