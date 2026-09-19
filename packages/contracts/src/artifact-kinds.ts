/**
 * Artifact kinds — seeded registry of the 19 core entities from spec/meta-model.md.
 *
 * The 19 core kinds are built-in and canonical. The registry is extensible
 * through an explicit registration API (`registerArtifactKind`); there is no
 * unregister operation — the frozen core cannot be silently removed.
 *
 * This module is the ONLY normative source of artifact kinds in SOS 2.0.
 * No second kind registry is permitted (AGENTS.md §4).
 */

export const CORE_ARTIFACT_KINDS = [
  'Constitution',
  'Mission',
  'ValueModel',
  'Context',
  'SystemState',
  'ArchitectureGraph',
  'ImplementationModel',
  'Evidence',
  'CausalHypothesis',
  'CandidateState',
  'AssuranceCase',
  'Experiment',
  'Decision',
  'Package',
  'PackageComposition',
  'ArchitectureMemory',
  'Evaluation',
  'AuthorityGrant',
  'AskRequest',
] as const;

export type CoreArtifactKind = (typeof CORE_ARTIFACT_KINDS)[number];

/** ArtifactKind is the union of core kinds plus explicitly registered extensions. */
export type ArtifactKind = CoreArtifactKind | (string & {});

/** Kind names are PascalCase identifiers (all 19 core kinds satisfy this). */
export const KIND_PATTERN = /^[A-Z][A-Za-z0-9]*$/;

export function isCoreArtifactKind(value: unknown): value is CoreArtifactKind {
  return typeof value === 'string' && (CORE_ARTIFACT_KINDS as readonly string[]).includes(value);
}

export function isValidArtifactKindFormat(value: unknown): value is string {
  return typeof value === 'string' && KIND_PATTERN.test(value);
}

export interface KindRegistry {
  /** Register a new kind. Throws on invalid format or duplicate registration. */
  register(kind: string): void;
  isRegistered(kind: string): boolean;
  /** Sorted list of registered kinds (deterministic). */
  list(): string[];
}

export function createKindRegistry(seed: readonly string[] = CORE_ARTIFACT_KINDS): KindRegistry {
  const kinds = new Set<string>(seed);
  return {
    register(kind: string): void {
      if (!isValidArtifactKindFormat(kind)) {
        throw new TypeError(
          `invalid artifact kind format: ${JSON.stringify(kind)} (expected PascalCase, e.g. "Mission")`,
        );
      }
      if (kinds.has(kind)) {
        throw new Error(`artifact kind already registered: ${kind}`);
      }
      kinds.add(kind);
    },
    isRegistered(kind: string): boolean {
      return kinds.has(kind);
    },
    list(): string[] {
      return [...kinds].sort();
    },
  };
}

/**
 * The default (process-wide) registry, seeded with the 19 canonical kinds.
 * Downstream Work Orders register their extensions here, or build isolated
 * registries with `createKindRegistry`.
 */
const defaultRegistry: KindRegistry = createKindRegistry();

export function registerArtifactKind(kind: string): void {
  defaultRegistry.register(kind);
}

export function isRegisteredArtifactKind(kind: string): boolean {
  return defaultRegistry.isRegistered(kind);
}

export function listArtifactKinds(): string[] {
  return defaultRegistry.list();
}
