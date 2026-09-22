/**
 * NonAuthoritativeAnalysis + provenance (Work Order P6).
 *
 * ALL broker output is typed NonAuthoritativeAnalysis:
 *
 *   - it carries a STRUCTURAL non_authoritative:true marker (validated —
 *     an analysis without the marker is a typed provenance violation);
 *   - it carries the FULL provenance block: provider identity, provider
 *     kind, model, version, the routing decision id that selected the
 *     provider, and the EXPLICIT simulated marker (the P8 discipline:
 *     simulation is evaluation infrastructure, never evidence);
 *   - it can inform decomposition, planning and summaries — it can NEVER
 *     enter authority, semantic-identity or verification-verdict paths
 *     (pinned by structural scans in the acceptance suites: no authority
 *     or verification field is ever populated from broker output).
 *
 * Analysis ids are CONTENT-DERIVED (deterministic): 'ra:' + the first 24
 * hex of the sha-256 over the canonical serialization of the creation
 * address — identical request + provider + model reproduces the
 * identical id (no randomness, no minting authority).
 */

import { contentHash, canonicalSerialize } from '@sos-2/semantic-spine';
import type { JsonValue } from '@sos-2/semantic-spine';
import { InvalidReasoningInputError, ReasoningProvenanceError } from './errors.js';
import type { ReasoningProviderKind, ReasoningRequestKind } from './port.js';

/** The provenance block every broker output carries (model/version discipline). */
export interface ReasoningProvenance {
  readonly provider_id: string;
  readonly provider_kind: ReasoningProviderKind;
  readonly model: string;
  readonly version: string;
  /** The routing decision that selected this provider (recorded — traceability). */
  readonly routing_decision_id: string;
  /** EXPLICIT simulated marker — reference providers are simulated. */
  readonly simulated: boolean;
}

/** THE broker output type — non-authoritative by construction. */
export interface NonAuthoritativeAnalysis {
  /** Content-derived deterministic analysis id ('ra:' + 24 hex). */
  readonly analysis_id: string;
  readonly kind: ReasoningRequestKind;
  /** The canonical digest of the exact request input. */
  readonly input_digest: string;
  /** The analysis payload (opaque canonical JSON — informative only). */
  readonly content: JsonValue;
  readonly provenance: ReasoningProvenance;
  /** STRUCTURAL non-authoritative marker — validated, pinned by scans. */
  readonly non_authoritative: true;
  /** EXPLICIT simulated marker — reference providers are simulated. */
  readonly simulated: boolean;
}

/** The exact address an analysis id is derived from (deterministic identity). */
export interface AnalysisCreationAddress {
  readonly kind: ReasoningRequestKind;
  readonly input_digest: string;
  readonly provider_id: string;
  readonly model: string;
  readonly version: string;
  readonly routing_decision_id: string;
  readonly simulated: boolean;
  readonly content: JsonValue;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

/** Derive the deterministic analysis id from a creation address. */
export function analysisArtifactId(address: AnalysisCreationAddress): string {
  const digest = contentHash({
    kind: address.kind,
    input_digest: address.input_digest,
    provider_id: address.provider_id,
    model: address.model,
    version: address.version,
    routing_decision_id: address.routing_decision_id,
    simulated: address.simulated,
    content: address.content,
  });
  return `ra:${digest.slice(0, 24)}`;
}

/** Construct a NonAuthoritativeAnalysis (id derived deterministically). */
export function createNonAuthoritativeAnalysis(
  address: AnalysisCreationAddress & { readonly provider_kind: ReasoningProviderKind },
): NonAuthoritativeAnalysis {
  const analysisId = analysisArtifactId(address);
  return {
    analysis_id: analysisId,
    kind: address.kind,
    input_digest: address.input_digest,
    content: structuredClone(address.content),
    provenance: {
      provider_id: address.provider_id,
      provider_kind: address.provider_kind,
      model: address.model,
      version: address.version,
      routing_decision_id: address.routing_decision_id,
      simulated: address.simulated,
    },
    non_authoritative: true,
    simulated: address.simulated,
  };
}

/** The canonical digest of a request input (the R30-style reproducibility anchor). */
export function reasoningInputDigest(input: JsonValue): string {
  return contentHash(input);
}

/**
 * Full validation of a NonAuthoritativeAnalysis (throws typed errors):
 * exact shape, structural non_authoritative marker, provenance block,
 * simulated-marker agreement and canonical-JSON payload.
 */
export function assertValidNonAuthoritativeAnalysis(value: unknown): asserts value is NonAuthoritativeAnalysis {
  if (!isPlainObject(value)) {
    throw new InvalidReasoningInputError('analysis must be an object');
  }
  if (!hasExactKeys(value, ['analysis_id', 'kind', 'input_digest', 'content', 'provenance', 'non_authoritative', 'simulated'])) {
    throw new InvalidReasoningInputError(
      'analysis must have the exact field set { analysis_id, kind, input_digest, content, provenance, non_authoritative, simulated }',
    );
  }
  if (value['non_authoritative'] !== true) {
    throw new ReasoningProvenanceError(
      'non-authoritative-marker',
      'broker output MUST carry non_authoritative:true — model-produced analysis is explicitly non-authoritative until independently evidenced (spec/productization-execution-architecture.md §8)',
    );
  }
  if (typeof value['analysis_id'] !== 'string' || !value['analysis_id'].startsWith('ra:')) {
    throw new InvalidReasoningInputError(`analysis_id must be a content-derived 'ra:'-prefixed id, received: ${JSON.stringify(value['analysis_id'])}`);
  }
  if (typeof value['input_digest'] !== 'string' || !/^[0-9a-f]{64}$/.test(value['input_digest'])) {
    throw new InvalidReasoningInputError('analysis input_digest must be 64 lowercase hex chars');
  }
  const provenance = value['provenance'];
  if (
    !isPlainObject(provenance) ||
    !hasExactKeys(provenance, ['provider_id', 'provider_kind', 'model', 'version', 'routing_decision_id', 'simulated']) ||
    typeof provenance['provider_id'] !== 'string' ||
    provenance['provider_id'].length === 0 ||
    (provenance['provider_kind'] !== 'managed' && provenance['provider_kind'] !== 'byo') ||
    typeof provenance['model'] !== 'string' ||
    provenance['model'].length === 0 ||
    typeof provenance['version'] !== 'string' ||
    provenance['version'].length === 0 ||
    typeof provenance['routing_decision_id'] !== 'string' ||
    provenance['routing_decision_id'].length === 0 ||
    typeof provenance['simulated'] !== 'boolean'
  ) {
    throw new ReasoningProvenanceError(
      'provenance-block',
      'analysis provenance must be { provider_id, provider_kind, model, version, routing_decision_id, simulated } — model/version provenance rides EVERY broker output',
    );
  }
  if (value['simulated'] !== provenance['simulated']) {
    throw new ReasoningProvenanceError('simulated-marker-agreement', 'the analysis simulated marker must agree with its provenance simulated marker');
  }
  try {
    canonicalSerialize(value['content']);
  } catch {
    throw new InvalidReasoningInputError('analysis content must be canonical JSON');
  }
  if (value['kind'] !== 'decomposition' && value['kind'] !== 'planning' && value['kind'] !== 'summary') {
    throw new InvalidReasoningInputError(`analysis kind must be decomposition | planning | summary, received: ${JSON.stringify(value['kind'])}`);
  }
}

/** Predicate form of assertValidNonAuthoritativeAnalysis. */
export function validateNonAuthoritativeAnalysis(value: unknown): value is NonAuthoritativeAnalysis {
  try {
    assertValidNonAuthoritativeAnalysis(value);
    return true;
  } catch {
    return false;
  }
}
