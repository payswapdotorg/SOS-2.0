/**
 * Quality-Diversity repertoire — a MAP-Elites-style archive
 * (spec/architecture.md §9 "quality-diversity repertoires", §11 diversity;
 * requirement R12; AGENTS.md §9: "Do not collapse the solution repertoire
 * into a single global winner when materially different solution families
 * are useful"; the lock forbids "universal package winner replacing a
 * diverse repertoire").
 *
 * DESIGN (typed, deterministic, order-independent):
 *   - BEHAVIOR DESCRIPTORS are TYPED dimensions: each archive declares its
 *     behavior axes with explicit bin edges; a candidate's behavior is a
 *     record of finite values over exactly those axes, and its CELL is the
 *     bin-index tuple the values fall into;
 *   - PER-CELL ELITES: each cell keeps exactly one elite — the
 *     highest-fitness candidate seen for that cell (fitness semantics:
 *     higher is better; within-cell competition only, never a global
 *     ranking);
 *   - DETERMINISTIC ARCHIVE UPDATES: equal-fitness contests are resolved by
 *     canonical id (smaller id wins), so the archive is CONFLUENT — the
 *     final archive is a pure function of the candidate SET, independent of
 *     insertion order (property-tested with random shuffles);
 *   - THE REPERTOIRE PRESERVES MATERIALLY DIFFERENT high-performing
 *     solution FAMILIES: candidates with different behavior land in
 *     different cells and NEVER evict each other — a globally dominant
 *     family cannot collapse the repertoire (negative/unit-tested);
 *   - UNCERTAINTY PRESERVED: every elite carries a mandatory
 *     CarriedUncertainty payload through the archive (results never
 *     collapse to point scores / fitness values alone).
 */

import { OptimizationError } from './errors.js';
import { assertValidCarriedUncertainty } from './uncertainty.js';
import type { CarriedUncertainty } from './uncertainty.js';

/** One behavior axis of the archive: a name plus strictly ascending bin edges. */
export interface BehaviorAxisSpec {
  /** Behavior axis name (non-empty). */
  axis: string;
  /**
   * Strictly ascending finite bin edges (>= 1). K edges define K+1 bins:
   * bin 0 = values below edges[0]; bin i (1..K-1) = [edges[i-1], edges[i]);
   * bin K = values >= edges[K-1].
   */
  edges: number[];
}

/** The archive's behavior space (>= 1 axis, unique axis names). */
export interface MapElitesSpec {
  dimensions: BehaviorAxisSpec[];
}

/** A candidate for the repertoire (uncertainty mandatory — never stripped). */
export interface EliteCandidate {
  /** Candidate id (non-empty; unique across the archive's inserts). */
  id: string;
  /** Declared solution family (non-empty). */
  family: string;
  /** Scalar fitness for WITHIN-CELL competition (higher is better; finite). */
  fitness: number;
  /** Behavior descriptor: a finite value for EVERY spec axis (exactly). */
  behavior: Record<string, number>;
  /** The uncertainty carried through the archive (mandatory, preserved verbatim). */
  uncertainty: CarriedUncertainty;
  /** Opaque caller payload; carried through untouched. */
  payload?: unknown;
}

/** The deterministic outcome of one archive insert. */
export type InsertOutcome =
  | 'NEW_CELL'
  | 'IMPROVED'
  | 'TIE_REPLACED'
  | 'RETAINED';

/** A serializable archive snapshot (round-trips through restoreArchive). */
export interface MapElitesSnapshot {
  spec: MapElitesSpec;
  /** One elite per occupied cell (deterministic order). */
  elites: EliteCandidate[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate a MAP-Elites spec (throws OptimizationError). */
export function assertValidMapElitesSpec(value: unknown): asserts value is MapElitesSpec {
  if (!isPlainObject(value)) {
    throw new OptimizationError(`MAP-Elites spec must be an object { dimensions }, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !('dimensions' in record)) {
    throw new OptimizationError('MAP-Elites spec must have the exact field set { dimensions }');
  }
  const dimensions = record['dimensions'];
  if (!Array.isArray(dimensions) || dimensions.length === 0) {
    throw new OptimizationError('MAP-Elites spec requires at least one behavior dimension');
  }
  const seen = new Set<string>();
  for (const dimension of dimensions) {
    if (!isPlainObject(dimension)) {
      throw new OptimizationError(`behavior dimension must be an object { axis, edges }, received: ${JSON.stringify(dimension)}`);
    }
    const dimensionRecord = dimension as Record<string, unknown>;
    if (Object.keys(dimensionRecord).length !== 2 || !('axis' in dimensionRecord) || !('edges' in dimensionRecord)) {
      throw new OptimizationError('behavior dimension must have the exact field set { axis, edges }');
    }
    if (typeof dimensionRecord['axis'] !== 'string' || dimensionRecord['axis'].length === 0) {
      throw new OptimizationError(
        `behavior axis name must be a non-empty string, received: ${JSON.stringify(dimensionRecord['axis'])}`,
      );
    }
    if (seen.has(dimensionRecord['axis'])) {
      throw new OptimizationError(`duplicate behavior axis: ${JSON.stringify(dimensionRecord['axis'])}`);
    }
    seen.add(dimensionRecord['axis']);
    const edges = dimensionRecord['edges'];
    if (!Array.isArray(edges) || edges.length === 0) {
      throw new OptimizationError(`behavior axis ${JSON.stringify(dimensionRecord['axis'])} requires at least one bin edge`);
    }
    for (const edge of edges) {
      if (typeof edge !== 'number' || !Number.isFinite(edge)) {
        throw new OptimizationError(
          `behavior axis ${JSON.stringify(dimensionRecord['axis'])} edges must be finite numbers, received: ${JSON.stringify(edges)}`,
        );
      }
    }
    for (let i = 1; i < edges.length; i += 1) {
      if ((edges[i] as number) <= (edges[i - 1] as number)) {
        throw new OptimizationError(
          `behavior axis ${JSON.stringify(dimensionRecord['axis'])} edges must be strictly ascending, received: ${JSON.stringify(edges)}`,
        );
      }
    }
  }
}

/** Predicate form of assertValidMapElitesSpec. */
export function isValidMapElitesSpec(value: unknown): value is MapElitesSpec {
  try {
    assertValidMapElitesSpec(value);
    return true;
  } catch {
    return false;
  }
}

/** Validate an elite candidate against a spec (throws OptimizationError). */
export function assertValidEliteCandidate(spec: MapElitesSpec, value: unknown): asserts value is EliteCandidate {
  if (!isPlainObject(value)) {
    throw new OptimizationError(`elite candidate must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const hasPayload = 'payload' in record;
  if (Object.keys(record).length !== (hasPayload ? 6 : 5)) {
    throw new OptimizationError(
      'elite candidate must have the exact field set { id, family, fitness, behavior, uncertainty [, payload] }',
    );
  }
  if (typeof record['id'] !== 'string' || record['id'].length === 0) {
    throw new OptimizationError(`elite candidate id must be a non-empty string, received: ${JSON.stringify(record['id'])}`);
  }
  if (typeof record['family'] !== 'string' || record['family'].length === 0) {
    throw new OptimizationError(`elite candidate family must be a non-empty string, received: ${JSON.stringify(record['family'])}`);
  }
  if (typeof record['fitness'] !== 'number' || !Number.isFinite(record['fitness'])) {
    throw new OptimizationError(`elite candidate fitness must be a finite number, received: ${JSON.stringify(record['fitness'])}`);
  }
  if (!isPlainObject(record['behavior'])) {
    throw new OptimizationError(`elite candidate behavior must be an object of axis -> number, received: ${JSON.stringify(record['behavior'])}`);
  }
  const specAxes = spec.dimensions.map((dimension) => dimension.axis).sort();
  const behaviorAxes = Object.keys(record['behavior']).sort();
  if (specAxes.length !== behaviorAxes.length || specAxes.some((axis, i) => axis !== behaviorAxes[i])) {
    throw new OptimizationError(
      `elite candidate ${JSON.stringify(record['id'])} behavior must declare exactly the spec axes [${specAxes.join(', ')}], ` +
        `received [${behaviorAxes.join(', ')}]`,
    );
  }
  for (const [axis, behaviorValue] of Object.entries(record['behavior'])) {
    if (typeof behaviorValue !== 'number' || !Number.isFinite(behaviorValue)) {
      throw new OptimizationError(
        `elite candidate ${JSON.stringify(record['id'])} behavior on axis ${JSON.stringify(axis)} must be a finite number, ` +
          `received: ${JSON.stringify(behaviorValue)}`,
      );
    }
  }
  try {
    assertValidCarriedUncertainty(record['uncertainty']);
  } catch (cause) {
    throw new OptimizationError(
      `elite candidate ${JSON.stringify(record['id'])} carries invalid uncertainty: ${(cause as Error).message}`,
    );
  }
}

/** Predicate form of assertValidEliteCandidate. */
export function isValidEliteCandidate(spec: MapElitesSpec, value: unknown): value is EliteCandidate {
  try {
    assertValidEliteCandidate(spec, value);
    return true;
  } catch {
    return false;
  }
}

/** The bin index of a value under strictly ascending edges (see BehaviorAxisSpec). */
export function binIndex(value: number, edges: readonly number[]): number {
  if (edges.length === 0) {
    throw new OptimizationError('binIndex requires at least one edge');
  }
  if (value < (edges[0] as number)) {
    return 0;
  }
  for (let i = 1; i < edges.length; i += 1) {
    if (value < (edges[i] as number)) {
      return i;
    }
  }
  return edges.length;
}

/** The cell (bin-index tuple) of a behavior record under a spec. */
export function cellOf(spec: MapElitesSpec, behavior: Readonly<Record<string, number>>): number[] {
  assertValidMapElitesSpec(spec);
  return spec.dimensions.map((dimension) => binIndex(behavior[dimension.axis]!, dimension.edges));
}

function cellKey(cell: readonly number[]): string {
  return cell.join(',');
}

/**
 * The MAP-Elites archive. In-memory, deterministic, confluent (insertion
 * order never changes the final archive).
 */
export class MapElitesArchive {
  private readonly spec: MapElitesSpec;
  private readonly cells = new Map<string, { cell: number[]; elite: EliteCandidate }>();
  private readonly ids = new Set<string>();

  constructor(spec: MapElitesSpec) {
    assertValidMapElitesSpec(spec);
    this.spec = { dimensions: spec.dimensions.map((dimension) => ({ axis: dimension.axis, edges: [...dimension.edges] })) };
  }

  /** The archive spec (defensive copy). */
  getSpec(): MapElitesSpec {
    return { dimensions: this.spec.dimensions.map((dimension) => ({ axis: dimension.axis, edges: [...dimension.edges] })) };
  }

  /** Number of occupied cells. */
  get size(): number {
    return this.cells.size;
  }

  /**
   * Insert a candidate. Deterministic update rule:
   *   NEW_CELL      the cell was empty — the candidate becomes its elite;
   *   IMPROVED      the candidate's fitness is STRICTLY higher than the cell elite's;
   *   TIE_REPLACED  equal fitness and the candidate's id sorts before the elite's
   *                 (canonical tiebreak — keeps the archive confluent);
   *   RETAINED      the candidate loses the within-cell contest.
   * A candidate id already present in the archive (in any cell) is rejected
   * — an id occupies at most one cell.
   */
  insert(candidate: EliteCandidate): InsertOutcome {
    assertValidEliteCandidate(this.spec, candidate);
    if (this.ids.has(candidate.id)) {
      throw new OptimizationError(
        `elite candidate id already present in the archive: ${JSON.stringify(candidate.id)} (one id, one cell)`,
      );
    }
    const cell = cellOf(this.spec, candidate.behavior);
    const key = cellKey(cell);
    const existing = this.cells.get(key);
    if (existing === undefined) {
      this.cells.set(key, { cell, elite: structuredClone(candidate) });
      this.ids.add(candidate.id);
      return 'NEW_CELL';
    }
    if (candidate.fitness > existing.elite.fitness) {
      this.ids.delete(existing.elite.id);
      this.cells.set(key, { cell, elite: structuredClone(candidate) });
      this.ids.add(candidate.id);
      return 'IMPROVED';
    }
    if (candidate.fitness === existing.elite.fitness && candidate.id < existing.elite.id) {
      this.ids.delete(existing.elite.id);
      this.cells.set(key, { cell, elite: structuredClone(candidate) });
      this.ids.add(candidate.id);
      return 'TIE_REPLACED';
    }
    return 'RETAINED';
  }

  /** The elite of a cell, or undefined. */
  get(cell: readonly number[]): EliteCandidate | undefined {
    const existing = this.cells.get(cellKey(cell));
    return existing === undefined ? undefined : structuredClone(existing.elite);
  }

  /** All occupied cells with their elites, in lexicographic cell order (deterministic). */
  cellsWithElites(): { cell: number[]; elite: EliteCandidate }[] {
    return [...this.cells.values()]
      .sort((a, b) => {
        for (let i = 0; i < Math.min(a.cell.length, b.cell.length); i += 1) {
          const delta = (a.cell[i] as number) - (b.cell[i] as number);
          if (delta !== 0) {
            return delta;
          }
        }
        return a.cell.length - b.cell.length;
      })
      .map((entry) => ({ cell: [...entry.cell], elite: structuredClone(entry.elite) }));
  }

  /** All elites in cell order (deterministic). */
  elites(): EliteCandidate[] {
    return this.cellsWithElites().map((entry) => entry.elite);
  }

  /** Distinct families present in the archive (sorted) — the repertoire view. */
  families(): string[] {
    return [...new Set([...this.cells.values()].map((entry) => entry.elite.family))].sort();
  }

  /** A serializable snapshot (deterministic). */
  snapshot(): MapElitesSnapshot {
    return { spec: this.getSpec(), elites: this.elites() };
  }

  /**
   * Rebuild an archive from a snapshot. Validated: the snapshot's elites
   * must be re-insertable (spec-conform behavior, unique ids); the restored
   * archive equals the snapshotting archive (round-trip property).
   */
  static restore(snapshot: MapElitesSnapshot): MapElitesArchive {
    if (!isPlainObject(snapshot)) {
      throw new OptimizationError(`MAP-Elites snapshot must be an object { spec, elites }, received: ${JSON.stringify(snapshot)}`);
    }
    const record = snapshot as Record<string, unknown>;
    if (Object.keys(record).length !== 2 || !('spec' in record) || !('elites' in record)) {
      throw new OptimizationError('MAP-Elites snapshot must have the exact field set { spec, elites }');
    }
    const archive = new MapElitesArchive(snapshot.spec);
    if (!Array.isArray(snapshot.elites)) {
      throw new OptimizationError('MAP-Elites snapshot elites must be an array');
    }
    for (const elite of snapshot.elites) {
      archive.insert(elite);
    }
    return archive;
  }
}

/** Functional alias for MapElitesArchive.restore. */
export function restoreArchive(snapshot: MapElitesSnapshot): MapElitesArchive {
  return MapElitesArchive.restore(snapshot);
}
