/**
 * The diversity ARCHIVE over the package/repertoire population (Work Order
 * W13; spec/architecture.md §11; requirement R28; spec/architecture-lock.md
 * forbids "universal package winner replacing a diverse repertoire").
 *
 * REUSE, NOT DUPLICATION: this archive COMPOSES the merged Quality-Diversity
 * repertoire of @sos-2/optimization (MapElitesArchive, MapElitesSpec,
 * EliteCandidate — the W7 QD authority). Every archive mechanic — typed
 * behavior descriptors, per-cell elites, deterministic confluent updates,
 * canonical snapshots — is the W7 implementation; this layer adds the
 * package-population discipline:
 *
 *   - the POPULATION is packages and compositions: every entry id is a
 *     well-formed spine id of kind Package or PackageComposition;
 *   - the BEHAVIOR SPACE is the nine frozen §11 dimensions (axes.ts) —
 *     a spec with an axis outside §11 is REJECTED;
 *   - the FAMILY of an entry is its declared solution family (the W6
 *     diversity profile family vocabulary — @sos-2/packages); materially
 *     different families land in different cells and NEVER evict each
 *     other (the W7 repertoire guarantee, inherited);
 *   - UNCERTAINTY is carried through the archive verbatim (mandatory
 *     CarriedUncertainty — §12; numeric probability only with calibration
 *     ref, enforced by the W7 authority);
 *   - the COVERAGE REPORT is deterministic and canonical: a pure function
 *     of the archive state, byte-identical across insertion orders
 *     (property-tested).
 */

import { isArtifactId, parseArtifactId } from '@sos-2/semantic-spine';
import { assertValidEliteCandidate, MapElitesArchive } from '@sos-2/optimization';
import type { EliteCandidate, MapElitesSnapshot, MapElitesSpec } from '@sos-2/optimization';
import { assertValidDiversitySpec } from './axes.js';
import { DiversityError } from './errors.js';

/** The population kinds a diversity entry may come from. */
export const DIVERSITY_POPULATION_KINDS = ['Package', 'PackageComposition'] as const;

export type DiversityPopulationKind = (typeof DIVERSITY_POPULATION_KINDS)[number];

const DIVERSITY_POPULATION_KIND_SET: ReadonlySet<string> = new Set(DIVERSITY_POPULATION_KINDS);

/**
 * A diversity archive entry — the imported W7 EliteCandidate (id, family,
 * fitness, behavior over the spec axes, mandatory carried uncertainty)
 * constrained to the package/composition population. The TYPE is imported
 * (never duplicated); the population constraints are enforced at insert.
 */
export type DiversityEntry = EliteCandidate;

/** Per-axis occupied-bin statistics of the coverage report. */
export interface AxisCoverage {
  /** The §11 axis name. */
  axis: string;
  /** Total bins on this axis (edges + 1). */
  bins: number;
  /** Occupied bins with their elite counts, sorted by bin index. */
  occupied_bins: { bin: number; elites: number }[];
}

/**
 * The deterministic, canonical coverage report of a diversity archive —
 * a pure function of the archive state.
 */
export interface DiversityCoverageReport {
  /** The archive spec (canonical axes; defensive copy). */
  spec: MapElitesSpec;
  /** Per-axis occupied-bin statistics (axis order = spec order). */
  axes: AxisCoverage[];
  /** Number of occupied cells. */
  occupied_cells: number;
  /** Total addressable cells (product of per-axis bin counts). */
  total_cells: number;
  /** occupied_cells / total_cells (deterministic rational value). */
  occupancy_ratio: number;
  /** Distinct families present (sorted). */
  families: string[];
  /** The repertoire view: one summary per occupied cell, canonical cell order. */
  cells: { cell: number[]; id: string; family: string; fitness: number }[];
}

/** Validate a diversity entry (delegates the QD discipline to the W7 authority). */
export function assertValidDiversityEntry(spec: MapElitesSpec, value: unknown): asserts value is DiversityEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DiversityError(`diversity entry must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const id = record['id'];
  if (!isArtifactId(id)) {
    throw new DiversityError(
      `diversity entry id must be a well-formed spine artifact id, received: ${JSON.stringify(id)} ` +
        '(the diversity archive covers the package/composition population)',
    );
  }
  const kind = parseArtifactId(id).kind;
  if (!DIVERSITY_POPULATION_KIND_SET.has(kind)) {
    throw new DiversityError(
      `diversity entry id must be a Package or PackageComposition id (the population is packages and compositions), ` +
        `received: ${JSON.stringify(id)}`,
    );
  }
  // Everything else (family, fitness, behavior-over-spec-axes, carried
  // uncertainty) is the W7 QD discipline — delegated, never re-implemented.
  try {
    assertValidEliteCandidate(spec, record);
  } catch (cause) {
    throw new DiversityError(`diversity entry is invalid: ${(cause as Error).message}`);
  }
}

/**
 * The diversity archive over the package/repertoire population — a
 * §11-constrained MAP-Elites archive (the W7 repertoire composed, never
 * duplicated).
 */
export class DiversityArchive {
  private readonly archive: MapElitesArchive;

  constructor(spec: MapElitesSpec) {
    assertValidDiversitySpec(spec);
    this.archive = new MapElitesArchive(spec);
  }

  /** The archive spec (defensive copy). */
  getSpec(): MapElitesSpec {
    return this.archive.getSpec();
  }

  /** Number of occupied cells. */
  get size(): number {
    return this.archive.size;
  }

  /**
   * Insert a population entry. Deterministic update outcomes (NEW_CELL /
   * IMPROVED / TIE_REPLACED / RETAINED) come from the W7 repertoire;
   * materially different families land in different cells and never evict
   * each other.
   */
  insert(entry: DiversityEntry): string {
    assertValidDiversityEntry(this.getSpec(), entry);
    return this.archive.insert(entry);
  }

  /** The elite of a cell, or undefined. */
  get(cell: readonly number[]): DiversityEntry | undefined {
    return this.archive.get(cell);
  }

  /** All occupied cells with their elites, in lexicographic cell order (deterministic). */
  cellsWithElites(): { cell: number[]; elite: DiversityEntry }[] {
    return this.archive.cellsWithElites();
  }

  /** All elites in cell order (deterministic). */
  elites(): DiversityEntry[] {
    return this.archive.elites();
  }

  /** Distinct families present in the archive (sorted) — the repertoire view. */
  families(): string[] {
    return this.archive.families();
  }

  /** A serializable snapshot (deterministic; the W7 snapshot shape). */
  snapshot(): MapElitesSnapshot {
    return this.archive.snapshot();
  }

  /** Rebuild a diversity archive from a snapshot (validated; canonical round trip). */
  static restore(snapshot: MapElitesSnapshot): DiversityArchive {
    const archive = new DiversityArchive(snapshot.spec);
    if (!Array.isArray(snapshot.elites)) {
      throw new DiversityError('diversity snapshot elites must be an array');
    }
    for (const elite of snapshot.elites) {
      archive.insert(elite);
    }
    return archive;
  }

  /**
   * The deterministic, canonical coverage report: per-axis occupied bins,
   * occupancy, families present and the per-cell repertoire summary — a
   * pure function of the archive state (byte-identical across insertion
   * orders; property-tested).
   */
  coverageReport(): DiversityCoverageReport {
    const spec = this.getSpec();
    const cellsWithElites = this.cellsWithElites();
    const axes: AxisCoverage[] = spec.dimensions.map((dimension, axisIndex) => {
      const bins = dimension.edges.length + 1;
      const counts = new Map<number, number>();
      for (const entry of cellsWithElites) {
        const bin = entry.cell[axisIndex]!;
        counts.set(bin, (counts.get(bin) ?? 0) + 1);
      }
      return {
        axis: dimension.axis,
        bins,
        occupied_bins: [...counts.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([bin, elites]) => ({ bin, elites })),
      };
    });
    let totalCells = 1;
    for (const dimension of spec.dimensions) {
      totalCells *= dimension.edges.length + 1;
    }
    return {
      spec,
      axes,
      occupied_cells: cellsWithElites.length,
      total_cells: totalCells,
      occupancy_ratio: totalCells === 0 ? 0 : cellsWithElites.length / totalCells,
      families: this.families(),
      cells: cellsWithElites.map((entry) => ({
        cell: [...entry.cell],
        id: entry.elite.id,
        family: entry.elite.family,
        fitness: entry.elite.fitness,
      })),
    };
  }
}
