/**
 * The canonical snapshot of a pipeline result — the spine's canonical
 * serialization (sorted keys, deterministic) of the FULL result including
 * the trace graph. Byte-identical across runs for identical input; this is
 * what the committed golden fixture (fixtures/golden-run.json) pins.
 */

import { canonicalSerialize } from '@sos-2/semantic-spine';
import type { GreenfieldPipelineResult } from '@sos-2/greenfield';

/** The canonical snapshot text of a result (with trailing newline). */
export function canonicalSnapshot(result: GreenfieldPipelineResult): string {
  return `${canonicalSerialize(result)}\n`;
}
