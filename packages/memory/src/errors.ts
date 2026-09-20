/**
 * Architecture-memory discipline errors.
 *
 * MemoryError extends SemanticSpineError so callers can catch all SOS
 * discipline violations through the shared spine root while distinguishing
 * memory-specific failures by name. Invalid memory ALWAYS fails loudly:
 * memory never forgets (failures and liabilities are retained), updates
 * always carry provenance, and learned rules are always evidence-backed —
 * anything questionable is rejected rather than silently recorded.
 */

import { SemanticSpineError } from '@sos-2/semantic-spine';

export class MemoryError extends SemanticSpineError {
  constructor(message: string) {
    super(message);
    this.name = 'MemoryError';
  }
}
