/**
 * The shared RUN_REAL evidence writer (Work Order P19) — deliberately a
 * PLAIN module, NEVER a *.real.test.ts file: importing a test module from
 * another test module re-registers the imported suite in the runner (a
 * standalone run-2 invocation would re-drive run-1's journey against its
 * now-existing repository, tripping the honest PRE_EXISTING_REPOSITORY
 * abort and clobbering the committed run-1 evidence with the abort
 * record). The shared surface lives here instead; the real test files
 * import ONLY types/helpers, never each other.
 */

import type { DogfoodRunRecord } from '@sos-2/dogfood-live';
import { credentialEnvNames } from './real-world.js';
import { writeDogfoodEvidence } from '../../src/evidence.js';

/** Write the full evidence package of one real run (§5 run-N/). */
export function writeRunEvidence(record: DogfoodRunRecord, head: string, source: Readonly<Record<string, string>>, runDir: 'run-1' | 'run-2'): void {
  writeDogfoodEvidence({
    evidence_kind: 'dogfood-journey-record',
    record: {
      schema: `sos-2/p19/${runDir}`,
      credential_envs: credentialEnvNames(source),
      mission: record.mission,
      repository: record.repository,
      implementation_branch: record.implementationBranch,
      store_selection: record.storeSelection,
      model_calls: record.modelCalls,
      repairs: record.repairs,
      asks: record.asks,
      stages: record.stages,
      ticks: record.ticks,
      pull_request: record.pullRequest,
      deployment: record.deployment,
      runtime_verification: record.runtimeVerification,
      final_state: record.finalState === null ? null : { stage: record.finalState.stage, status: record.finalState.status },
      pending_ask: record.pendingAsk,
      honest_notes: record.honestNotes,
    },
    file: `${runDir}/journey-record.json`,
    head,
  });
  writeDogfoodEvidence({
    evidence_kind: 'dogfood-provider-states',
    record: {
      schema: `sos-2/p19/${runDir}/provider-states`,
      credential_envs: credentialEnvNames(source),
      provider_states: record.providerStates,
      store_selection: record.storeSelection,
    },
    file: `${runDir}/provider-states.json`,
    head,
  });
}
