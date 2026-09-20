/**
 * @sos-2/ecology — the SOS 2.0 Package Ecology layer (Work Order W13;
 * requirements R24, R27 partially — the compatibility graph and composition
 * interaction evidence complete the ecology model of docs/package-ecology.md).
 *
 *   - the evidence-backed COMPATIBILITY/CONFLICT GRAPH over the package
 *     population (typed COMPATIBLE_WITH / CONFLICTS_WITH edges — frozen
 *     spine trace types; an evidence-free edge is REJECTED);
 *   - COMPOSITION INTERACTION EVIDENCE: synergy/interference outcomes about
 *     the composition itself, own-evidence backed (member success does not
 *     imply composition success);
 *   - DECAY/OBSOLESCENCE SIGNALS feeding a maturity REVIEW queue that never
 *     auto-demotes (signals are Evidence-shaped input only; demotion stays
 *     a governed decision).
 *
 * EXPORT DISCIPLINE (binding, mirrors W0.5-W8): core identifiers, envelope
 * logic and the frozen trace-type vocabulary are ALWAYS obtained from
 * @sos-2/semantic-spine; evidence records come from @sos-2/evidence.
 * Package and composition authorities stay in @sos-2/packages /
 * @sos-2/composition / @sos-2/registry — this layer references the
 * population by spine ids and never becomes a second package registry.
 */

export * from './errors.js';
export * from './graph.js';
export * from './interaction.js';
export * from './signals.js';

// Re-export the spine pieces downstream ecology consumers most often need
// (still the same single semantic registry — no duplication).
export { canonicalSerialize, contentHash, fullContentHash } from '@sos-2/semantic-spine';
export type { TraceLink, TraceLinkType } from '@sos-2/semantic-spine';
export type { EvidenceRecordW3 } from '@sos-2/evidence';
