// One-off fixture generation for @sos-2/packages (W6 golden fixtures).
// Mirrors test/helpers.ts goldenPackageInput(); the reproduction test pins
// bit-exact equality, so any drift fails loudly.
import { writeFileSync } from 'node:fs';
import { createPackageArtifact } from '../dist/index.js';

const W05_GOLDEN_PACKAGE_ID = 'sos://Package/7f8e6f3257bd8625b2082cb4476a1d6b';
const W05_GOLDEN_EVIDENCE_ID = 'sos://Evidence/c412ae3f8bbc84f6ddb21a69b32208ce';
const W05_GOLDEN_IMPLEMENTATION_MODEL_ID = 'sos://ImplementationModel/541b1845dff6ebfc15fef3ee55a508af';
const W05_BASE_REVISION = '5b0aea0386ee56f91e53ffa0e34e74a0da1682bf';

const content = {
  semantic_capability: 'sos-semantic-spine',
  contracts: [
    'sos://schema/trace-link',
    'sos://schema/architecture-delta',
    'sos://schema/evidence',
    'sos://schema/package',
    'sos://schema/implementation-model',
  ],
  preconditions: ['a registered artifact kind vocabulary is available'],
  postconditions: ['artifacts carry stable content-addressed spine identities'],
  realizations: [
    {
      ref: W05_GOLDEN_IMPLEMENTATION_MODEL_ID,
      revision: W05_BASE_REVISION,
      note: 'the W0.5 semantic spine implementation model',
    },
  ],
  applicability: [
    {
      kind: 'QUALITATIVE',
      uncertainty_class: 'UNQUANTIFIED',
      context: { layer: 'semantic-core' },
      sample_size: 1,
      window: null,
    },
  ],
  evidence_refs: [W05_GOLDEN_EVIDENCE_ID],
  failure_refs: [],
  compatibility_refs: [],
  composition_refs: [],
  assurance_obligations: [
    {
      kind: 'PROPERTY_CHECK',
      obligation: 'canonical round trips and deterministic id reproduction stay pinned by tests',
    },
  ],
  context: { layer: 'semantic-core' },
  learned_limitations: [],
  diversity_profile: {
    family: 'semantic-core',
    dimensions: [
      { dimension: 'HUMAN_COMPREHENSIBILITY', stance: 'prioritizes human-readable, explainable reasoning' },
    ],
  },
  maturity: 'DISCOVERED',
  changes: 'initial discovery (W6 golden fixture, projected onto the W0.5 golden package record)',
  superseded_by: null,
};

const artifact = createPackageArtifact({
  content,
  provenance: ['W6:golden-package-fixture'],
  created_at: '2025-01-01T00:00:00.000Z',
  authority_ref: null,
  version: 1,
  status: 'DRAFT',
  supersedes: null,
  id: W05_GOLDEN_PACKAGE_ID,
});

writeFileSync(
  new URL('../fixtures/package-artifact.json', import.meta.url),
  JSON.stringify(artifact, null, 2) + '\n',
);
console.log('wrote fixtures/package-artifact.json, id =', artifact.envelope.id);

// ---------------------------------------------------------------------------
// The durable-store companion fixture (a second package used by composition
// and registry tests; deterministic id, DISCOVERED).
// ---------------------------------------------------------------------------

const durableStoreContent = {
  semantic_capability: 'durable-artifact-store',
  contracts: ['contract:durable-store/v1'],
  preconditions: ['a POSIX filesystem or object store is reachable'],
  postconditions: ['writes are persisted before acknowledgment'],
  realizations: [],
  applicability: [
    {
      kind: 'QUALITATIVE',
      uncertainty_class: 'UNQUANTIFIED',
      context: { tier: 'durable' },
      sample_size: 0,
      window: null,
    },
  ],
  evidence_refs: [W05_GOLDEN_EVIDENCE_ID],
  failure_refs: [],
  compatibility_refs: [],
  composition_refs: [],
  assurance_obligations: [
    {
      kind: 'TEST',
      obligation: 'write-then-read round trips preserve artifact bytes exactly',
    },
  ],
  context: { tier: 'durable' },
  learned_limitations: [],
  diversity_profile: {
    family: 'write-through-store',
    dimensions: [{ dimension: 'RESILIENCE', stance: 'fsync before acknowledgment' }],
  },
  maturity: 'DISCOVERED',
  changes: 'initial discovery (W6 companion fixture)',
  superseded_by: null,
};

const durableStore = createPackageArtifact({
  content: durableStoreContent,
  provenance: ['W6:durable-store-fixture'],
  created_at: '2025-01-01T00:00:00.000Z',
  authority_ref: null,
  version: 1,
  status: 'DRAFT',
  supersedes: null,
});

writeFileSync(
  new URL('../fixtures/durable-store-package.json', import.meta.url),
  JSON.stringify(durableStore, null, 2) + '\n',
);
console.log('wrote fixtures/durable-store-package.json, id =', durableStore.envelope.id);
