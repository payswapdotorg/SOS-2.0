/**
 * Diversity profile (spec/architecture.md §11; R28; spec/architecture-lock.md
 * forbids "universal package winner replacing a diverse repertoire").
 *
 * Every package/composition DECLARES its solution family and its stances on
 * the nine §11 behavioral dimensions. The registry groups candidates BY THE
 * DECLARED family — it never invents its own classification (no second
 * authority) and never collapses families into one winner. Two packages with
 * materially different behavioral profiles are expected to declare
 * different families; the registry preserves whatever diversity is
 * declared.
 *
 * The nine frozen dimensions (spec/architecture.md §11): cost, latency,
 * resilience, privacy, resource footprint, topology, operational
 * complexity, customization, human comprehensibility.
 */

import { PackageError } from './errors.js';

export const DIVERSITY_DIMENSIONS = [
  'COST',
  'LATENCY',
  'RESILIENCE',
  'PRIVACY',
  'RESOURCE_FOOTPRINT',
  'TOPOLOGY',
  'OPERATIONAL_COMPLEXITY',
  'CUSTOMIZATION',
  'HUMAN_COMPREHENSIBILITY',
] as const;

export type DiversityDimension = (typeof DIVERSITY_DIMENSIONS)[number];

const DIVERSITY_DIMENSION_SET: ReadonlySet<string> = new Set(DIVERSITY_DIMENSIONS);

export function isDiversityDimension(value: unknown): value is DiversityDimension {
  return typeof value === 'string' && DIVERSITY_DIMENSION_SET.has(value);
}

/** The package's stance on one behavioral dimension. */
export interface DiversityDimensionStance {
  dimension: DiversityDimension;
  /** The stance statement (non-empty), e.g. "optimizes for p99 < 50ms". */
  stance: string;
}

/** The declared diversity profile: a solution family + at least one dimension stance. */
export interface DiversityProfile {
  /** Solution family name (non-empty), e.g. "durable-queue", "edge-cache". */
  family: string;
  /** Behavioral dimension stances (at least one). */
  dimensions: DiversityDimensionStance[];
}

export function assertValidDiversityProfile(value: unknown): asserts value is DiversityProfile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PackageError(`diversity profile must be an object { family, dimensions }, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || !('family' in record) || !('dimensions' in record)) {
    throw new PackageError('diversity profile must have the exact field set { family, dimensions }');
  }
  if (typeof record['family'] !== 'string' || record['family'].length === 0) {
    throw new PackageError(`diversity profile family must be a non-empty string, received: ${JSON.stringify(record['family'])}`);
  }
  const dimensions = record['dimensions'];
  if (!Array.isArray(dimensions) || dimensions.length === 0) {
    throw new PackageError(
      'diversity profile requires at least one dimension stance — a package without a behavioral dimension ' +
        'cannot participate in diversity-preserving retrieval',
    );
  }
  const seen = new Set<string>();
  for (const stance of dimensions) {
    if (typeof stance !== 'object' || stance === null || Array.isArray(stance)) {
      throw new PackageError(`diversity dimension stance must be an object { dimension, stance }, received: ${JSON.stringify(stance)}`);
    }
    const stanceRecord = stance as Record<string, unknown>;
    if (Object.keys(stanceRecord).length !== 2 || !('dimension' in stanceRecord) || !('stance' in stanceRecord)) {
      throw new PackageError('diversity dimension stance must have the exact field set { dimension, stance }');
    }
    if (!isDiversityDimension(stanceRecord['dimension'])) {
      throw new PackageError(
        `diversity dimension must be one of ${DIVERSITY_DIMENSIONS.join(', ')}, received: ${JSON.stringify(stanceRecord['dimension'])}`,
      );
    }
    if (typeof stanceRecord['stance'] !== 'string' || stanceRecord['stance'].length === 0) {
      throw new PackageError(
        `diversity stance statement must be a non-empty string, received: ${JSON.stringify(stanceRecord['stance'])}`,
      );
    }
    if (seen.has(stanceRecord['dimension'])) {
      throw new PackageError(`duplicate diversity dimension declared: ${JSON.stringify(stanceRecord['dimension'])}`);
    }
    seen.add(stanceRecord['dimension']);
  }
}
