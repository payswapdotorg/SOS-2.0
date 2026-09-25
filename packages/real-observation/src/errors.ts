/**
 * The P17-C real-observation error type. Typed, honest, dependency-free:
 * a real-observation adapter NEVER fabricates an outcome — a failed
 * provider interaction is a typed failure carrying the real reason (the
 * message never includes secret VALUES; transcripts go through the
 * redaction corpus).
 */

export class RealObservationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RealObservationError';
  }
}
