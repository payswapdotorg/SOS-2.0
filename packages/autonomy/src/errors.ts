/**
 * @sos-2/autonomy error type. All invalid autonomy operations fail loudly
 * (the same discipline as @sos-2/authority's AuthorityError and
 * @sos-2/promotion's PromotionError).
 */

export class AutonomyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AutonomyError';
  }
}
