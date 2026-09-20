/**
 * Shared test fixtures for @sos-2/runtimes tests. Grants come from the
 * merged W1 authority; contexts from the merged W1 context package; the
 * SystemState reference id is minted deterministically through the spine.
 */

import { deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import { createGrant, revokeGrant } from '@sos-2/authority';
import type { AuthorityGrantArtifact, GrantScope } from '@sos-2/authority';
import { createContext } from '@sos-2/context';
import type { ContextArtifact } from '@sos-2/context';
import type { Producer } from '@sos-2/provenance';
import type { RuntimeDescriptor } from '../src/index.js';

export const T0 = '2025-03-01T00:00:00.000Z';
export const T1 = '2025-03-02T00:00:00.000Z';
export const GRANT_EXPIRY = '2025-12-31T00:00:00.000Z';
export const PAST_EXPIRY = '2025-01-01T00:00:00.000Z';

/** The executed subject (a candidate Decision artifact). */
export const SUBJECT_ID = deriveDeterministicArtifactId('Decision', {
  note: 'w12 runtimes test subject',
});

/** A SystemState revision the executions observe (a well-formed spine id). */
export const SYSTEM_STATE_ID = deriveDeterministicArtifactId('SystemState', {
  architecture_ref: {
    artifact_id: deriveDeterministicArtifactId('ArchitectureGraph', { note: 'w12 test graph' }),
    version: 1,
  },
  implementation: [
    {
      artifact_id: deriveDeterministicArtifactId('ImplementationModel', { note: 'w12 test impl' }),
      revision: { kind: 'git-sha', value: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0' },
    },
  ],
  configuration: [],
  deployment: [],
  policy: [],
  environment_relationships: [],
  active_experiments: [],
  package_realizations: [],
});

export function toolProducer(): Producer {
  return {
    tool: 'w12-runtimes-test',
    tool_version: '1.0.0',
    model: null,
    model_version: null,
    command: 'pnpm -r test',
    environment: 'ci:test',
  };
}

export function grantFixture(
  overrides: {
    scope?: GrantScope;
    expiryAt?: string;
    revoked?: boolean;
  } = {},
): AuthorityGrantArtifact {
  const base = createGrant({
    grantee: 'w12-runtime-operators',
    scope: overrides.scope ?? { kind: 'KIND', artifact_kind: 'Decision' },
    permissions: ['READ'],
    expiry: { kind: 'TIME', at: overrides.expiryAt ?? GRANT_EXPIRY },
    provenance: ['w12:runtimes-test:grant'],
    created_at: T0,
    status: 'ACTIVE',
  });
  if (!overrides.revoked) {
    return base;
  }
  // A REAL revocation through the merged W1 workflow: the revoked successor
  // revision carries its OWN id (version + 1, supersedes the head).
  return revokeGrant(base, {
    at: { kind: 'TIME', now: T0 },
    provenance: ['w12:runtimes-test:revocation'],
    created_at: T1,
  });
}

export function contextFixture(dimensions: Record<string, unknown>): ContextArtifact {
  return createContext({
    dimensions,
    provenance: ['w12:runtimes-test:context'],
    created_at: T0,
    status: 'ACTIVE',
  });
}

/** A well-formed in-memory runtime descriptor (validated by the SUT on registration). */
export function runtimeFixture(overrides: Partial<RuntimeDescriptor> = {}): RuntimeDescriptor {
  return {
    id: 'runtime:checkout-sandbox',
    kind: 'in-memory',
    version: '1.0.0',
    capabilities: ['evaluate-candidate', 'run-checks'],
    constraints: [{ kind: 'MAX_OUTPUT_BYTES', max_bytes: 4096 }],
    context_constraints: {},
    ...overrides,
  };
}
