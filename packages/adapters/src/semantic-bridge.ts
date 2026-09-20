/**
 * The semantic bridge — the W12 enforcement of "ADAPTERS CANNOT REDEFINE
 * SEMANTICS" (spec/work-orders/W12-platform-adapters.md; spec/architecture.md
 * section 17: "Platforms and vendors are adapters or contexts. They do not
 * redefine SOS semantics"; docs/implementation/REFERENCE-STACK.md: "semantic
 * types are framework independent").
 *
 * An adapter is a STRUCTURAL bridge to domain types, never a source of new
 * semantics. Concretely:
 *
 *   1. DOMAIN TYPE REGISTRY (this module): the closed set of domain semantic
 *      types adapter outputs may bridge onto — each entry names the OWNING
 *      workspace package and reuses THAT package's runtime guard verbatim
 *      (guards are consumed, never reimplemented here). The registry is the
 *      single bridge authority for this package; there is no second semantic
 *      registry in the AGENTS.md section 4 sense (spine identities, kinds and
 *      trace types remain solely in the spine/contracts).
 *
 *   2. TYPE-LEVEL GUARD: `AdapterContractDescriptor.outputs` is typed
 *      `Readonly<Record<string, DomainSemanticTypeName>>` — an adapter whose
 *      output bridges to anything outside the registry does not type-check.
 *      A novel semantic concept cannot even be DECLARED.
 *
 *   3. RUNTIME GUARD: `assertValidAdapterDescriptor` rejects descriptors
 *      whose output bridges reference unregistered domain types (a cast
 *      forgery cannot smuggle a novel concept past validation), and
 *      `verifyAdapterOutputs` rejects concrete outputs whose bridged fields
 *      fail the owning package's domain guard. The in-memory reference
 *      adapters in this package run `verifyAdapterOutputs` on everything
 *      they produce — the bridge is enforced live, not only in tests.
 *
 * Control-plane fields (denial codes, error strings, diagnostics) are
 * operational metadata of the adapter plane, not semantic payloads; every
 * field carrying SOS semantic content must be bridged.
 */

import {
  isArtifactId,
  isEvidenceTruthState,
  validateEnvelope,
  validateTraceLink,
} from '@sos-2/semantic-spine';
import { validateProducer, isTimeWindow } from '@sos-2/provenance';
import { validateRawObservation } from '@sos-2/telemetry';
import { validateEvidenceRecord } from '@sos-2/evidence';
import { validateGrant } from '@sos-2/authority';
import { SemanticBridgeError } from './errors.js';
import { isJsonValue } from './json.js';

// ---------------------------------------------------------------------------
// 1. The domain type registry (closed set; guards consumed verbatim)
// ---------------------------------------------------------------------------

/** A registered domain semantic type an adapter output may bridge onto. */
export interface DomainSemanticTypeBinding {
  /** The domain type name (stable; the registry key). */
  readonly name: string;
  /** The workspace package that OWNS the type (and its guard). */
  readonly owningPackage: string;
  /**
   * The owning package's runtime guard, consumed verbatim (predicate form:
   * returns true iff the value satisfies the domain contract).
   */
  readonly guard: (value: unknown) => boolean;
}

/** The closed registry of bridgeable domain semantic types. */
export const DOMAIN_SEMANTIC_TYPES = {
  ArtifactId: {
    name: 'ArtifactId',
    owningPackage: '@sos-2/semantic-spine',
    guard: isArtifactId,
  },
  ArtifactEnvelope: {
    name: 'ArtifactEnvelope',
    owningPackage: '@sos-2/semantic-spine',
    guard: validateEnvelope,
  },
  TraceLink: {
    name: 'TraceLink',
    owningPackage: '@sos-2/semantic-spine',
    guard: validateTraceLink,
  },
  EvidenceTruthState: {
    name: 'EvidenceTruthState',
    owningPackage: '@sos-2/semantic-spine',
    guard: isEvidenceTruthState,
  },
  JsonValue: {
    name: 'JsonValue',
    owningPackage: '@sos-2/semantic-spine',
    guard: isJsonValue,
  },
  Producer: {
    name: 'Producer',
    owningPackage: '@sos-2/provenance',
    guard: validateProducer,
  },
  TimeWindow: {
    name: 'TimeWindow',
    owningPackage: '@sos-2/provenance',
    guard: isTimeWindow,
  },
  RawObservation: {
    name: 'RawObservation',
    owningPackage: '@sos-2/telemetry',
    guard: validateRawObservation,
  },
  EvidenceRecord: {
    name: 'EvidenceRecord',
    owningPackage: '@sos-2/evidence',
    guard: validateEvidenceRecord,
  },
  AuthorityGrant: {
    name: 'AuthorityGrant',
    owningPackage: '@sos-2/authority',
    guard: validateGrant,
  },
} as const satisfies Record<string, DomainSemanticTypeBinding>;

/** The closed union of bridgeable domain type names (the type-level guard). */
export type DomainSemanticTypeName = keyof typeof DOMAIN_SEMANTIC_TYPES;

export function isDomainSemanticTypeName(value: unknown): value is DomainSemanticTypeName {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(DOMAIN_SEMANTIC_TYPES, value)
  );
}

/** The names of all registered domain types, sorted (deterministic). */
export function listDomainSemanticTypes(): DomainSemanticTypeName[] {
  return (Object.keys(DOMAIN_SEMANTIC_TYPES) as DomainSemanticTypeName[]).sort();
}

// ---------------------------------------------------------------------------
// 2. Adapter contract descriptors (type-level constrained)
// ---------------------------------------------------------------------------

/** The four W12 adapter contracts. */
export const ADAPTER_CONTRACT_KINDS = [
  'RepositoryAdapter',
  'TelemetryIngestionAdapter',
  'ReasoningProviderAdapter',
  'ExecutionAdapter',
] as const;

export type AdapterContractKind = (typeof ADAPTER_CONTRACT_KINDS)[number];

export function isAdapterContractKind(value: unknown): value is AdapterContractKind {
  return typeof value === 'string' && (ADAPTER_CONTRACT_KINDS as readonly string[]).includes(value);
}

/**
 * A declared adapter contract: which of the four W12 contracts this adapter
 * implements, and the output bridges — every semantic output field mapped
 * onto ONE registered domain type. The `outputs` record is constrained to
 * `DomainSemanticTypeName` VALUES at the type level: an adapter introducing
 * a novel semantic concept does not type-check.
 */
export interface AdapterContractDescriptor {
  /** One of the four W12 adapter contract kinds. */
  readonly contract: AdapterContractKind;
  /**
   * Output field name -> the registered domain type it bridges onto.
   * Non-empty; values must be registered domain type names (runtime-guarded).
   */
  readonly outputs: Readonly<Record<string, DomainSemanticTypeName>>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Runtime validation of an adapter contract descriptor (throws
 * SemanticBridgeError). A descriptor referencing a domain type outside the
 * registry — a NOVEL SEMANTIC CONCEPT — is REJECTED, even when the
 * TypeScript type has been bypassed by a cast.
 */
export function assertValidAdapterDescriptor(value: unknown): asserts value is AdapterContractDescriptor {
  if (!isPlainObject(value)) {
    throw new SemanticBridgeError('adapter contract descriptor must be an object { contract, outputs }');
  }
  const actual = Object.keys(value);
  if (actual.length !== 2 || !actual.includes('contract') || !actual.includes('outputs')) {
    throw new SemanticBridgeError('adapter contract descriptor must have the exact field set { contract, outputs }');
  }
  if (!isAdapterContractKind(value['contract'])) {
    throw new SemanticBridgeError(
      `adapter contract kind must be one of ${ADAPTER_CONTRACT_KINDS.join(' | ')}, received: ${JSON.stringify(value['contract'])}`,
    );
  }
  const outputs = value['outputs'];
  if (!isPlainObject(outputs)) {
    throw new SemanticBridgeError('adapter contract descriptor outputs must be an object of field -> domain type name');
  }
  const outputKeys = Object.keys(outputs);
  if (outputKeys.length === 0) {
    throw new SemanticBridgeError(
      'adapter contract descriptor must declare at least one output bridge (an adapter with no semantic outputs does nothing)',
    );
  }
  for (const field of outputKeys) {
    if (field.length === 0) {
      throw new SemanticBridgeError('adapter output bridge field names must be non-empty strings');
    }
    const domainType = outputs[field];
    if (!isDomainSemanticTypeName(domainType)) {
      throw new SemanticBridgeError(
        `adapter output bridge "${field}" references a NOVEL semantic concept: ${JSON.stringify(domainType)} ` +
          `is not a registered domain type (registered: ${listDomainSemanticTypes().join(', ')}). ` +
          'Adapters are structural bridges to domain types — they never introduce new semantics ' +
          '(spec/architecture.md section 17).',
      );
    }
  }
}

/** Predicate form of assertValidAdapterDescriptor. */
export function isValidAdapterDescriptor(value: unknown): value is AdapterContractDescriptor {
  try {
    assertValidAdapterDescriptor(value);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 3. Output verification (runtime guard over concrete outputs)
// ---------------------------------------------------------------------------

/**
 * Verify concrete adapter outputs against a contract descriptor (throws
 * SemanticBridgeError). Every declared bridge field must be PRESENT on the
 * output record and PASS the owning package's domain guard. An adapter
 * emitting a semantic payload that does not satisfy its declared domain type
 * is REJECTED.
 *
 * `output` is the record the adapter produced (an envelope, an observation,
 * a reasoning completion, an execution result, ...). Only fields named by the
 * descriptor's `outputs` map are checked; presence + guard per bridge.
 */
export function verifyAdapterOutputs(
  descriptor: AdapterContractDescriptor,
  output: unknown,
): void {
  assertValidAdapterDescriptor(descriptor);
  if (!isPlainObject(output)) {
    throw new SemanticBridgeError(
      `adapter output for contract ${descriptor.contract} must be an object so the declared bridges can be verified`,
    );
  }
  for (const [field, domainTypeName] of Object.entries(descriptor.outputs)) {
    if (!Object.prototype.hasOwnProperty.call(output, field)) {
      throw new SemanticBridgeError(
        `adapter output for contract ${descriptor.contract} is missing the declared bridge field "${field}" ` +
          `(bridged to domain type ${domainTypeName})`,
      );
    }
    const binding: DomainSemanticTypeBinding = DOMAIN_SEMANTIC_TYPES[domainTypeName]!;
    if (!binding.guard(output[field])) {
      throw new SemanticBridgeError(
        `adapter output field "${field}" does not satisfy its bridged domain type ${domainTypeName} ` +
          `(owned by ${binding.owningPackage}) — adapters cannot emit values outside the domain contract`,
      );
    }
  }
}

/** Predicate form of verifyAdapterOutputs. */
export function adapterOutputsVerified(
  descriptor: AdapterContractDescriptor,
  output: unknown,
): boolean {
  try {
    verifyAdapterOutputs(descriptor, output);
    return true;
  } catch {
    return false;
  }
}
