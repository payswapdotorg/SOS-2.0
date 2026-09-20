/**
 * W16 extension artifact kinds: MetaProcess and MetaChange.
 *
 * The 19 core kinds are frozen (spec/meta-model.md); W16 adds exactly TWO
 * registered extensions through the spine's ONLY sanctioned extension point
 * (`registerArtifactKind` — idempotent, add-only; there is no unregister
 * operation, so the kinds cannot be silently removed — the same discipline
 * @sos-2/autonomy follows for AutonomyRaise and @sos-2/provenance for
 * ProvenanceRecord).
 *
 *   MetaProcess — the versioned, spine-traceable realization of the SOS
 *                 PROCESS itself (strategy parameters, retrieval weights,
 *                 candidate-generation policy). What the META loop evolves.
 *   MetaChange  — a typed, versioned proposal to change the SOS PROCESS
 *                 (never the object system — the OBJECT/META separation is
 *                 enforced by the routing stage).
 *
 * Identity discipline: ids are ALWAYS minted by the spine's deterministic
 * content-addressed minter. No second identity system is introduced.
 */

import { registerArtifactKind } from '@sos-2/semantic-spine';

export const META_PROCESS_KIND = 'MetaProcess';
export const META_CHANGE_KIND = 'MetaChange';

let registered = false;

/** Idempotent, add-only registration of the two W16 extension kinds. */
export function registerMetaEvolutionKinds(): void {
  if (registered) {
    return;
  }
  registerArtifactKind(META_PROCESS_KIND);
  registerArtifactKind(META_CHANGE_KIND);
  registered = true;
}

// Eager registration at module load (the autonomy/provenance convention):
// any import of @sos-2/meta-evolution makes the kinds available to the
// process-wide kind registry before any envelope or grant can reference them.
registerMetaEvolutionKinds();
