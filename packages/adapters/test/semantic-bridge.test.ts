/**
 * Semantic bridge tests — the W12 "adapters cannot redefine semantics"
 * acceptance, positive path (unit) and negative path (novel semantic
 * concepts and non-bridging outputs are REJECTED).
 */

import { describe, expect, it } from 'vitest';
import {
  ADAPTER_CONTRACT_KINDS,
  DOMAIN_SEMANTIC_TYPES,
  REPOSITORY_ADAPTER_DESCRIPTOR,
  REPOSITORY_ENVELOPE_OUTPUT,
  REPOSITORY_TRACE_LINK_OUTPUT,
  SemanticBridgeError,
  assertValidAdapterDescriptor,
  isDomainSemanticTypeName,
  isValidAdapterDescriptor,
  listDomainSemanticTypes,
  verifyAdapterOutputs,
} from '../src/index.js';
import type { AdapterContractDescriptor } from '../src/index.js';
import { envelopeFixture, grantFixture, toolProducer, T0, T1 } from './helpers.js';
import { createTraceLink } from '@sos-2/semantic-spine';

describe('domain semantic type registry', () => {
  it('exposes the closed registry with owning packages and guards', () => {
    for (const name of listDomainSemanticTypes()) {
      const binding = DOMAIN_SEMANTIC_TYPES[name]!;
      expect(binding.name).toBe(name);
      expect(binding.owningPackage.startsWith('@sos-2/')).toBe(true);
      expect(typeof binding.guard).toBe('function');
    }
  });

  it('recognizes registered names and rejects novel ones', () => {
    expect(isDomainSemanticTypeName('ArtifactEnvelope')).toBe(true);
    expect(isDomainSemanticTypeName('UnicornWidget')).toBe(false);
    expect(isDomainSemanticTypeName('trace-link')).toBe(false);
  });

  it('lists deterministically', () => {
    expect(listDomainSemanticTypes()).toEqual([...listDomainSemanticTypes()].sort());
  });
});

describe('adapter contract descriptors (valid)', () => {
  it('accepts the four reference descriptors', () => {
    for (const contract of ADAPTER_CONTRACT_KINDS) {
      const descriptor: AdapterContractDescriptor = {
        contract,
        outputs: { envelope: 'ArtifactEnvelope' },
      };
      expect(() => assertValidAdapterDescriptor(descriptor)).not.toThrow();
      expect(isValidAdapterDescriptor(descriptor)).toBe(true);
    }
  });
});

describe('adapter contract descriptors (negative: novel semantic concepts)', () => {
  it('REJECTS a descriptor bridging to an unregistered domain type', () => {
    const forged = {
      contract: 'RepositoryAdapter',
      outputs: { widget: 'UnicornWidget' },
    } as unknown as AdapterContractDescriptor;
    expect(() => assertValidAdapterDescriptor(forged)).toThrow(SemanticBridgeError);
    expect(() => assertValidAdapterDescriptor(forged)).toThrow(/novel semantic concept/i);
    expect(isValidAdapterDescriptor(forged)).toBe(false);
  });

  it('REJECTS an unknown contract kind', () => {
    const forged = {
      contract: 'TimeMachineAdapter',
      outputs: { envelope: 'ArtifactEnvelope' },
    } as unknown as AdapterContractDescriptor;
    expect(() => assertValidAdapterDescriptor(forged)).toThrow(SemanticBridgeError);
    expect(() => assertValidAdapterDescriptor(forged)).toThrow(/TimeMachineAdapter/);
  });

  it('REJECTS empty output bridges and malformed shapes', () => {
    expect(() => assertValidAdapterDescriptor({ contract: 'RepositoryAdapter', outputs: {} })).toThrow(
      SemanticBridgeError,
    );
    expect(() => assertValidAdapterDescriptor(null)).toThrow(SemanticBridgeError);
    expect(() => assertValidAdapterDescriptor({ contract: 'RepositoryAdapter' })).toThrow(SemanticBridgeError);
    expect(
      isValidAdapterDescriptor({
        contract: 'RepositoryAdapter',
        outputs: { '': 'ArtifactEnvelope' },
      } as unknown as AdapterContractDescriptor),
    ).toBe(false);
  });
});

describe('verifyAdapterOutputs (runtime guard)', () => {
  it('accepts outputs whose bridged fields satisfy the domain guards', () => {
    const envelope = envelopeFixture();
    const link = createTraceLink({
      source: envelope.id,
      target: envelopeFixture({ created_at: T1 }).id,
      type: 'DERIVED_FROM',
      provenance: ['w12:adapters-test:link'],
    });
    expect(() => verifyAdapterOutputs(REPOSITORY_ENVELOPE_OUTPUT, { envelope })).not.toThrow();
    expect(() => verifyAdapterOutputs(REPOSITORY_TRACE_LINK_OUTPUT, { traceLink: link })).not.toThrow();
  });

  it('REJECTS outputs with a missing bridged field', () => {
    const envelope = envelopeFixture();
    // The full repository contract requires BOTH output sites on one record.
    expect(() => verifyAdapterOutputs(REPOSITORY_ADAPTER_DESCRIPTOR, { envelope })).toThrow(SemanticBridgeError);
    expect(() => verifyAdapterOutputs(REPOSITORY_ENVELOPE_OUTPUT, {})).toThrow(SemanticBridgeError);
    expect(() => verifyAdapterOutputs(REPOSITORY_TRACE_LINK_OUTPUT, { envelope })).toThrow(SemanticBridgeError);
  });

  it('REJECTS outputs whose bridged fields fail the owning package guard', () => {
    const envelope = envelopeFixture();
    // A tampered envelope: wrong field shape for the spine guard.
    expect(() =>
      verifyAdapterOutputs(REPOSITORY_ENVELOPE_OUTPUT, { envelope: { ...envelope, version: 0 } }),
    ).toThrow(SemanticBridgeError);
    expect(() => verifyAdapterOutputs(REPOSITORY_ENVELOPE_OUTPUT, { envelope: 'not-an-envelope' })).toThrow(
      SemanticBridgeError,
    );
    // A forged "trace link" missing the spine's required structure.
    expect(() =>
      verifyAdapterOutputs(REPOSITORY_TRACE_LINK_OUTPUT, {
        traceLink: { source: 'x', target: 'y', type: 'NOVEL_LINK' },
      }),
    ).toThrow(SemanticBridgeError);
  });

  it('REJECTS non-object outputs', () => {
    expect(() => verifyAdapterOutputs(REPOSITORY_ENVELOPE_OUTPUT, null)).toThrow(SemanticBridgeError);
    expect(() => verifyAdapterOutputs(REPOSITORY_ENVELOPE_OUTPUT, 'envelope')).toThrow(SemanticBridgeError);
  });
});

describe('bridge guards over every registered domain type', () => {
  it('validates real instances of each domain type', () => {
    const envelope = envelopeFixture();
    const link = createTraceLink({
      source: envelope.id,
      target: envelopeFixture({ created_at: T1 }).id,
      type: 'OBSERVES',
      provenance: ['w12:adapters-test:link'],
    });
    const grant = grantFixture();
    const producer = toolProducer();
    const samples: Record<string, unknown> = {
      ArtifactId: envelope.id,
      ArtifactEnvelope: envelope,
      TraceLink: link,
      EvidenceTruthState: 'UNKNOWN',
      JsonValue: { any: [1, 2, null, true] },
      Producer: producer,
      TimeWindow: { start: T0, end: T1 },
      AuthorityGrant: grant,
    };
    for (const [name, value] of Object.entries(samples)) {
      const binding = DOMAIN_SEMANTIC_TYPES[name as keyof typeof DOMAIN_SEMANTIC_TYPES]!;
      expect(binding.guard(value), `guard for ${name}`).toBe(true);
    }
  });

  it('rejects garbage for each domain type', () => {
    for (const name of listDomainSemanticTypes()) {
      const binding = DOMAIN_SEMANTIC_TYPES[name]!;
      expect(binding.guard(undefined), `guard(${name}, undefined)`).toBe(false);
      // A function is not JSON, so no guard accepts it (including JsonValue).
      expect(binding.guard(() => 1), `guard(${name}, fn)`).toBe(false);
      // A plain object IS a JsonValue; for every OTHER domain type it fails.
      if (name !== 'JsonValue') {
        expect(binding.guard({ garbage: true }), `guard(${name}, garbage)`).toBe(false);
      }
    }
  });
});
