// One-off fixture generation for @sos-2/composition (W6 golden fixture).
// Mirrors test/helpers.ts goldenCompositionInput(); the reproduction test
// pins bit-exact equality, so any drift fails loudly.
import { readFileSync, writeFileSync } from 'node:fs';
import { createPackageComposition } from '../dist/index.js';

function readJson(url) {
  return JSON.parse(readFileSync(url, 'utf8'));
}

const here = new URL('.', import.meta.url);
const goldenPackage = readJson(new URL('../../packages/fixtures/package-artifact.json', here));
const durableStore = readJson(new URL('../../packages/fixtures/durable-store-package.json', here));

const content = {
  semantic_capability: 'durable-semantic-store',
  contracts: ['contract:durable-spine-store/v1'],
  members: [
    {
      package_id: goldenPackage.envelope.id,
      role: 'spine',
      bound_contracts: ['sos://schema/trace-link'],
    },
    {
      package_id: durableStore.envelope.id,
      role: 'store',
      bound_contracts: ['contract:durable-store/v1'],
    },
  ],
  bindings: [
    {
      kind: 'PROVIDES_TO',
      source_role: 'spine',
      target_role: 'store',
      contract: 'contract:durable-spine-store/v1',
      wiring: { channel: 'artifact-write-through', durability: 'strong' },
    },
  ],
  preconditions: ['a spine artifact registry is reachable'],
  postconditions: ['artifacts are durably persisted with stable spine identities'],
  applicability: [
    {
      kind: 'QUALITATIVE',
      uncertainty_class: 'UNQUANTIFIED',
      context: { tier: 'durable' },
      sample_size: 0,
      window: null,
    },
  ],
  evidence_refs: [],
  failure_refs: [],
  compatibility_refs: [],
  assurance_obligations: [
    {
      kind: 'REPLAY',
      obligation: 'the composed store replays a full artifact chain after restart',
    },
  ],
  context: { tier: 'durable' },
  learned_limitations: [],
  diversity_profile: {
    family: 'write-through-store',
    dimensions: [{ dimension: 'RESILIENCE', stance: 'strong durability, higher write latency' }],
  },
  maturity: 'FORMING',
  independence: [],
  changes: 'initial composition hypothesis (W6 golden fixture)',
  superseded_by: null,
};

const artifact = createPackageComposition({
  content,
  provenance: ['W6:golden-composition-fixture'],
  created_at: '2025-01-01T00:00:00.000Z',
  authority_ref: null,
  version: 1,
  status: 'DRAFT',
  supersedes: null,
});

writeFileSync(
  new URL('../fixtures/package-composition.json', import.meta.url),
  JSON.stringify(artifact, null, 2) + '\n',
);
console.log('wrote fixtures/package-composition.json, id =', artifact.envelope.id);
