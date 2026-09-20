# @sos-2/assurance golden fixtures

## assurance-case.json

The golden canonical assurance case minted by this package: an ACTIVE case
with three claims (operational safety concluded from correctness +
recoverability), one argument, one assumption, one hazard, one control, two
evidence references (SUPPORTS + VERIFIES, bound to the deterministic test
evidence records), two validity conditions (IMPLEMENTATION on
"payments-service", ENVIRONMENT on "prod-eu") and one OPEN objection
("objection-corpus-coverage").

Its id is deterministic (content-addressed by the Semantic Spine):
`sos://AssuranceCase/cfd0c4d34161d82b443866725f7fc63e`

The referenced evidence ids are likewise deterministic (minted by
`@sos-2/evidence createEvidence` for the sample inputs in
`test/helpers.ts`): the test suite re-derives them and pins the binding.

Regeneration (bit-exact, from the repository root):

```sh
cd packages/assurance && pnpm run build && node --input-type=module -e "
import { createAssuranceCase } from './dist/index.js';
import { createEvidence } from '@sos-2/evidence';
import { deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
const S = deriveDeterministicArtifactId('SystemState', { note: 'w8 assurance test subject', revision: 'r1' });
const producer = { tool: 'w8-assurance-test', tool_version: '1.0.0', model: null, model_version: null, command: 'pnpm -r test', environment: 'ci:test' };
const base = { subject_ref: S, availability: 'SUCCESS', evidence_class: 'OBSERVATIONAL', method: 'test-run:exit-code', provenance: ['W8:test-fixture'], source_revision: 'rev-0001', deployment_revision: 'dpl-0001', window: { start: '2025-01-01T00:00:00.000Z', end: '2025-01-02T00:00:00.000Z' }, subject_revision: S + '@v1', producer };
const supporting = createEvidence({ ...base, kind: 'test-run' });
const runtime = createEvidence({ ...base, kind: 'runtime-conformance' });
const artifact = createAssuranceCase({ content: { claims: [ { id: 'claim-payments-safe', statement: 'The payment flow is safe to operate in production.' }, { id: 'claim-payments-correct', statement: 'Payment totals are computed correctly for every checkout.' }, { id: 'claim-payments-recoverable', statement: 'Any in-flight payment can be recovered without data loss.' } ], arguments: [ { id: 'argument-safety', strategy: 'Correctness plus recoverability jointly establish operational safety.', conclusion: 'claim-payments-safe', premises: ['claim-payments-correct', 'claim-payments-recoverable'] } ], assumptions: [ { id: 'assumption-corpus-representative', statement: 'The test corpus is representative of production traffic.' } ], hazards: [ { id: 'hazard-double-charge', description: 'A retried payment charges the customer twice.' } ], controls: [ { id: 'control-idempotency-key', mechanism: 'Idempotency keys on every payment request.', addresses: ['hazard-double-charge'] } ], evidence: [ { evidence_id: supporting.id, role: 'SUPPORTS', claim_ref: 'claim-payments-correct' }, { evidence_id: runtime.id, role: 'VERIFIES', claim_ref: 'claim-payments-correct' } ], validity_conditions: [ { kind: 'IMPLEMENTATION', subject: 'payments-service', valid_revisions: ['rev-0001', 'rev-0002'] }, { kind: 'ENVIRONMENT', subject: 'prod-eu', valid_revisions: ['env-2025-01'] } ], objections: [ { id: 'objection-corpus-coverage', statement: 'The corpus does not cover currency-conversion rounding.', raised_at: '2025-01-02T00:00:00.000Z', status: 'OPEN', resolution: null } ] }, provenance: ['W8:golden-fixture:assurance-case'], created_at: '2025-01-02T00:00:00.000Z', status: 'ACTIVE' });
const { writeFileSync } = await import('node:fs');
writeFileSync('fixtures/assurance-case.json', JSON.stringify(artifact, null, 2) + '\n');
"
```

If the id or content changes after an intentional contract change, update
this fixture AND the Architecture Delta record that documents the change.
