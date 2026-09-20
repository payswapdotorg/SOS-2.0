/**
 * The harness runner: execute the greenfield pipeline on the golden demo
 * scenario and re-verify the trace chain (belt and braces — the pipeline
 * itself already machine-checks it before returning).
 */

import {
  assertTraceChainComplete,
  runGreenfieldPipeline,
} from '@sos-2/greenfield';
import type { GreenfieldPipelineResult } from '@sos-2/greenfield';
import { buildGoldenScenarioInput } from './scenario.js';

/** Run the golden scenario end to end (throws on any stage failure). */
export function runGoldenScenario(): GreenfieldPipelineResult {
  const result = runGreenfieldPipeline(buildGoldenScenarioInput());
  // Re-verify the traceability invariant before the result leaves the
  // harness (the exit-0 contract depends on it).
  assertTraceChainComplete({
    artifacts: result.trace.artifacts,
    links: result.trace.links,
    mission_id: result.summary.mission_id,
    system_state_id: result.summary.realization.system_state_id,
  });
  return result;
}
