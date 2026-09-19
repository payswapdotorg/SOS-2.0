# @sos-2/evidence golden fixtures

## evidence.json

The golden canonical evidence record minted by this package. It is the exact
output of `createEvidence` for the sample creation input used across the test
suite (subject: the deterministic `SystemState` test subject "w3 evidence test
subject" / revision "r1"; kind "telemetry"; class OBSERVATIONAL; method
"telemetry:capture-availability").

Its id is deterministic (content-addressed by the Semantic Spine):
`sos://Evidence/e7f3c74939a13049bbcf014d8e1b7ab2`

Regeneration (bit-exact, from the repository root):

```sh
cd packages/evidence && pnpm run build && node --input-type=module -e "
import { createEvidence } from './dist/index.js';
import { deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
const S = deriveDeterministicArtifactId('SystemState', { note: 'w3 evidence test subject', revision: 'r1' });
const record = createEvidence({ kind: 'telemetry', subject_ref: S, availability: 'SUCCESS', evidence_class: 'OBSERVATIONAL', method: 'telemetry:capture-availability', provenance: ['observation:sha256:' + 'a'.repeat(64)], source_revision: 'git:219cb9c8e329b0435f2deea37ec2d5003b264931', deployment_revision: 'oci:sha256:' + 'b'.repeat(64), window: { start: '2025-01-01T00:00:00.000Z', end: '2025-01-02T00:00:00.000Z' }, subject_revision: 'r1', confidence: { kind: 'QUALITATIVE', uncertainty_class: 'UNQUANTIFIED' }, producer: { tool: 'otel-collector', tool_version: '0.90.0', model: null, model_version: null, command: 'collect --env production', environment: 'ci:local' } });
const { writeFileSync } = await import('node:fs');
writeFileSync('fixtures/evidence.json', JSON.stringify(record, null, 2) + '\n');
"
```

If the id or content changes after an intentional contract change, update this
fixture AND the Architecture Delta record that documents the change.
