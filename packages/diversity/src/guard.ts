/**
 * Diversity GUARDS (Work Order W13; spec/architecture.md §11, §18
 * "Diversity is intentional"; AGENTS.md §9: "Do not collapse the solution
 * repertoire into a single global winner when materially different solution
 * families are useful"; spec/architecture-lock.md forbidden shortcut:
 * "universal package winner replacing a diverse repertoire").
 *
 * MACHINE-CHECKED RULE: any operation that reduces a population of packages/
 * compositions to a selected subset and would drop EVERY representative of a
 * MATERIALLY DIFFERENT HIGH-PERFORMING family is REJECTED. "High-performing"
 * is declared explicitly by the caller (a finite minimum fitness) — the
 * guard never invents the threshold; "materially different" is the declared
 * solution family (the W6 diversity-profile family vocabulary — the guard
 * never invents its own classification).
 *
 * The sanctioned reduction is familyRepresentatives(): the best entry per
 * family (canonical tiebreak), which by construction can never collapse a
 * family. There is NO single-winner API anywhere in this package.
 */

import { DiversityError } from './errors.js';
import type { DiversityEntry } from './archive.js';

/** The per-family summary a preservation check reports. */
export interface FamilySummary {
  /** The declared solution family. */
  family: string;
  /** The family's best fitness in the population (finite). */
  best_fitness: number;
  /** The family's entry count in the population. */
  population_count: number;
  /** The family's entry count in the selection. */
  selected_count: number;
  /** True iff the family is high-performing under the check's threshold. */
  high_performing: boolean;
  /** True iff at least one representative survives in the selection. */
  preserved: boolean;
}

/** The outcome of a family-preservation check (deterministic). */
export interface FamilyPreservationCheck {
  /** Per-family summaries, sorted by family name (canonical). */
  families: FamilySummary[];
  /** Families whose every representative was dropped (empty iff preserved). */
  collapsed_families: string[];
  /** True iff no high-performing family was collapsed. */
  preserved: boolean;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Check whether a selection preserves every materially different
 * high-performing family of a population.
 *
 * Deterministic and pure: family summaries are sorted by family name; a
 * family is high-performing iff its best fitness in the POPULATION is >=
 * minFitness; it is preserved iff at least one of its entries appears in
 * the selection (matched by entry id).
 */
export function checkFamilyPreservation(
  population: readonly DiversityEntry[],
  selected: readonly DiversityEntry[],
  minFitness: number,
): FamilyPreservationCheck {
  if (!Array.isArray(population) || population.length === 0) {
    throw new DiversityError('checkFamilyPreservation requires a NON-EMPTY population');
  }
  if (!Array.isArray(selected)) {
    throw new DiversityError('checkFamilyPreservation requires a selection array');
  }
  if (typeof minFitness !== 'number' || !Number.isFinite(minFitness)) {
    throw new DiversityError(`minFitness must be a finite number (the caller declares what high-performing means), received: ${JSON.stringify(minFitness)}`);
  }
  const populationById = new Map<string, DiversityEntry>();
  for (const entry of population) {
    populationById.set(entry.id, entry);
  }
  for (const entry of selected) {
    if (!populationById.has(entry.id)) {
      throw new DiversityError(
        `selection contains an entry outside the population: ${JSON.stringify(entry.id)} ` +
          '(a selection may only reduce the population, never invent members)',
      );
    }
  }
  const selectedIds = new Set(selected.map((entry) => entry.id));
  const byFamily = new Map<string, DiversityEntry[]>();
  for (const entry of population) {
    const bucket = byFamily.get(entry.family);
    if (bucket === undefined) {
      byFamily.set(entry.family, [entry]);
    } else {
      bucket.push(entry);
    }
  }
  const families: FamilySummary[] = [...byFamily.entries()]
    .sort((a, b) => compareStrings(a[0], b[0]))
    .map(([family, entries]) => {
      const bestFitness = entries.reduce((best, entry) => (entry.fitness > best ? entry.fitness : best), entries[0]!.fitness);
      const selectedCount = entries.filter((entry) => selectedIds.has(entry.id)).length;
      const highPerforming = bestFitness >= minFitness;
      return {
        family,
        best_fitness: bestFitness,
        population_count: entries.length,
        selected_count: selectedCount,
        high_performing: highPerforming,
        preserved: selectedCount > 0,
      };
    });
  const collapsed = families.filter((summary) => summary.high_performing && !summary.preserved).map((s) => s.family);
  return { families, collapsed_families: collapsed, preserved: collapsed.length === 0 };
}

/**
 * The diversity GUARD: assert that a selection preserves every materially
 * different high-performing family. REJECTS (throws DiversityError) when a
 * high-performing family loses all its representatives — including the
 * single-winner collapse (selecting only one family's champion while other
 * high-performing families exist).
 */
export function assertPreservesFamilies(
  population: readonly DiversityEntry[],
  selected: readonly DiversityEntry[],
  minFitness: number,
): FamilyPreservationCheck {
  const check = checkFamilyPreservation(population, selected, minFitness);
  if (!check.preserved) {
    throw new DiversityError(
      `diversity collapse REJECTED: high-performing solution families lost all representatives in the selection ` +
        `(${check.collapsed_families.map((family) => JSON.stringify(family)).join(', ')}) — the solution repertoire ` +
        'is not collapsed into a single winner when materially different families are useful ' +
        '(spec/architecture.md §11; spec/architecture-lock.md)',
    );
  }
  return check;
}

/** Predicate form of the guard. */
export function preservesFamilies(
  population: readonly DiversityEntry[],
  selected: readonly DiversityEntry[],
  minFitness: number,
): boolean {
  return checkFamilyPreservation(population, selected, minFitness).preserved;
}

/**
 * The sanctioned reduction: the best entry of every family (canonical
 * tiebreak by id — mirroring the W7 repertoire's deterministic
 * equal-fitness rule), sorted by family name. By construction this NEVER
 * collapses a family, however many families the population holds.
 */
export function familyRepresentatives(population: readonly DiversityEntry[]): DiversityEntry[] {
  if (!Array.isArray(population) || population.length === 0) {
    throw new DiversityError('familyRepresentatives requires a NON-EMPTY population');
  }
  const byFamily = new Map<string, DiversityEntry>();
  for (const entry of population) {
    const current = byFamily.get(entry.family);
    if (current === undefined) {
      byFamily.set(entry.family, entry);
      continue;
    }
    if (entry.fitness > current.fitness || (entry.fitness === current.fitness && entry.id < current.id)) {
      byFamily.set(entry.family, entry);
    }
  }
  return [...byFamily.entries()].sort((a, b) => compareStrings(a[0], b[0])).map(([, entry]) => entry);
}
