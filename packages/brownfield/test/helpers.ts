/**
 * Shared fixtures for @sos-2/brownfield tests: the golden scenario, both
 * variants, and small helpers. Everything is deterministic (pinned seeds
 * and instants; fresh stores per build).
 */

import { GOLDEN_BROWNFIELD_SCENARIO } from '../src/index.js';
import { buildBrownfieldLoopInput } from '../src/index.js';
import { runBrownfieldLoop } from '../src/index.js';
import type { BrownfieldLoopResult, BrownfieldFixtureJson, BrownfieldVariant } from '../src/index.js';

export { GOLDEN_BROWNFIELD_SCENARIO };

export function goldenResult(variant: BrownfieldVariant = 'nominal'): BrownfieldLoopResult {
  const { input } = buildBrownfieldLoopInput(GOLDEN_BROWNFIELD_SCENARIO, variant);
  return runBrownfieldLoop(input);
}

export function goldenInput(variant: BrownfieldVariant = 'nominal') {
  return buildBrownfieldLoopInput(GOLDEN_BROWNFIELD_SCENARIO, variant);
}

/** Derive a scenario with a replaced snapshot section (property tests). */
export function scenarioWithSnapshot(scenario: BrownfieldFixtureJson, snapshot: BrownfieldFixtureJson['snapshot']): BrownfieldFixtureJson {
  return { ...scenario, snapshot };
}
