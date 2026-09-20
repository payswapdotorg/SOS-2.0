/**
 * Shared test fixtures for @sos-2/adapters tests. Envelopes and trace links
 * are minted through the spine; grants through the merged W1 authority;
 * evidence through the merged W3 evidence package.
 */

import { deriveDeterministicArtifactId, createEnvelope } from '@sos-2/semantic-spine';
import type { ArtifactEnvelope } from '@sos-2/semantic-spine';
import { createGrant } from '@sos-2/authority';
import type { AuthorityGrantArtifact, GrantScope } from '@sos-2/authority';
import type { Producer } from '@sos-2/provenance';
import type { OtelResource, OtelSpan } from '@sos-2/telemetry';

export const T0 = '2025-03-01T00:00:00.000Z';
export const T1 = '2025-03-02T00:00:00.000Z';
export const GRANT_EXPIRY = '2025-12-31T00:00:00.000Z';
export const PAST_EXPIRY = '2025-01-01T00:00:00.000Z';

/** A subject artifact (any spine kind works for envelope round trips). */
export const SUBJECT_ID = deriveDeterministicArtifactId('Decision', {
  note: 'w12 adapters test subject',
});

export function envelopeFixture(overrides: Partial<Parameters<typeof createEnvelope>[0]> = {}): ArtifactEnvelope {
  return createEnvelope({
    kind: 'Decision',
    provenance: ['w12:adapters-test:envelope'],
    created_at: T0,
    ...overrides,
  });
}

export function grantFixture(
  overrides: {
    scope?: GrantScope;
    permissions?: string[];
    expiryAt?: string;
    revoked?: boolean;
  } = {},
): AuthorityGrantArtifact {
  const base = createGrant({
    grantee: 'w12-adapter-operators',
    scope: overrides.scope ?? { kind: 'KIND', artifact_kind: 'Decision' },
    permissions: overrides.permissions ?? ['READ'],
    expiry: { kind: 'TIME', at: overrides.expiryAt ?? GRANT_EXPIRY },
    provenance: ['w12:adapters-test:grant'],
    created_at: T0,
    status: 'ACTIVE',
  });
  if (!overrides.revoked) {
    return base;
  }
  // A revoked revision of the same grant (explicit revocation workflow shape).
  return {
    envelope: base.envelope,
    content: {
      ...base.content,
      revoked_at: T1,
      revocation_provenance: ['w12:adapters-test:revocation'],
    },
  };
}

export function toolProducer(): Producer {
  return {
    tool: 'w12-adapters-test',
    tool_version: '1.0.0',
    model: null,
    model_version: null,
    command: 'pnpm -r test',
    environment: 'ci:test',
  };
}

/** A minimal OTel span resource (service.name is required by the converter). */
export function otelResource(serviceName = 'checkout'): OtelResource {
  return {
    attributes: {
      'service.name': serviceName,
      'telemetry.sdk.version': '1.28.0',
      'deployment.environment.name': 'production',
    },
  };
}

export function otelSpanFixture(overrides: Record<string, unknown> = {}): OtelSpan {
  const span: OtelSpan = {
    traceId: 'd4cda95b652f4a1592b4f4d2ba58dcca',
    spanId: '6e0c63257de34c92',
    parentSpanId: null,
    name: 'POST /checkout',
    kind: 'SERVER',
    startTimeUnixNano: '1735689600000000000',
    endTimeUnixNano: '1735689600123000000',
    status: { code: 'OK', message: null },
    attributes: { 'http.status_code': 200 },
    resource: otelResource(),
  };
  return { ...span, ...(overrides as Partial<OtelSpan>) };
}
