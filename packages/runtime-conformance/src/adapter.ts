/**
 * RuntimeViewAdapter — the adapter contract of Work Order W4's runtime
 * conformance layer.
 *
 * Per the W4 brief, the runtime layer "consumes runtime observation records
 * (telemetry-shaped)". @sos-2/telemetry IS merged, so the observation type
 * consumed here is its validated `RawObservation` (capture-level
 * availability, caller-supplied windows, producer provenance) — imported,
 * never redefined. TELEMETRY IS INPUT, NOT SEMANTIC TRUTH
 * (@sos-2/telemetry module doc): truth-state assignment for the emitted
 * conformance evidence happens in evaluate.ts under an explicit method.
 *
 * The adapter converts runtime observations into a RuntimeView:
 *
 *   - `graph`        the OBSERVED runtime structure as a validated
 *                    @sos-2/architecture GraphShape (nodes observed
 *                    operating at runtime, edges observed occurring);
 *   - `subjectCoverage`  per-subject observation tallies over ALL 6 frozen
 *                    truth states (zero-filled, like W3's
 *                    summarizeAvailability — no state is ever folded into
 *                    another);
 *   - `sightedNodes`    the nodes the runtime structure asserts (directly
 *                    observed, or indirectly sighted via an observed edge);
 *   - `unprojected`  observations the adapter could not project, with
 *                    reasons — RETAINED, never silently dropped.
 *
 * BUILT-IN ADAPTER: `structuralRuntimeAdapter` (id
 * "runtime-view:structural") interprets each usable observation as a
 * sighting of ONE runtime subject:
 *
 *   - `subject_ref` is the node id (custom adapters may map source-native
 *     labels to node ids instead — that is exactly why the adapter is an
 *     interface);
 *   - the node kind comes from attribute `runtime.node_kind` (default
 *     "Component"; must be a registered node kind);
 *   - outgoing runtime edges come from attribute `runtime.edges`, an array
 *     of { target, kind } objects (edge kinds must be registered edge
 *     kinds). Edge targets become indirectly-sighted nodes; the target kind
 *     is implied by the edge kind ("Provides"/"Consumes" -> Interface,
 *     "Owns" -> DataStore, otherwise Component — documented heuristic, and
 *     only used when the target itself was not directly sighted).
 *
 *   Which observations contribute structure (documented, never silent):
 *     SUCCESS, FAILURE, UNKNOWN, PARTIAL -> contribute the sighting
 *       (UNKNOWN means the OUTCOME is undetermined, not that the subject
 *       was absent — an OTel span with status UNSET still proves the
 *       service existed);
 *     UNAVAILABLE, UNSUPPORTED -> contribute NOTHING structurally (a gap is
 *       data about missing data; an unservable subject asserts nothing) and
 *       are only tallied in subjectCoverage.
 */

import { assertValidGraphShape, isRegisteredEdgeKind, isRegisteredNodeKind } from '@sos-2/architecture';
import type { GraphEdge, GraphNode, GraphShape } from '@sos-2/architecture';
import {
  assertValidRawObservation,
} from '@sos-2/telemetry';
import type { RawObservation } from '@sos-2/telemetry';
import type { EvidenceTruthState } from '@sos-2/semantic-spine';
import { EVIDENCE_TRUTH_STATES } from '@sos-2/semantic-spine';
import { RuntimeConformanceError } from './errors.js';

// ---------------------------------------------------------------------------
// View types
// ---------------------------------------------------------------------------

/** Per-subject observation tallies — ALL 6 truth states, zero-filled. */
export interface RuntimeSubjectCoverage {
  /** The observed subject (as the observations named it). */
  subject: string;
  /** Capture-level observation counts per truth state (all 6 keys always present). */
  counts: Record<EvidenceTruthState, number>;
}

/** A node asserted by the runtime view. */
export interface SightedNode {
  /** The node id in the runtime graph. */
  id: string;
  /** The node kind asserted by the sighting. */
  kind: string;
  /** Whether the node was directly observed (true) or sighted via an edge (false). */
  direct: boolean;
}

/** An observation the adapter could not project (retained, never dropped). */
export interface UnprojectedObservation {
  /** Index of the observation in the input array (deterministic reference). */
  index: number;
  /** The observation's subject_ref (auditability). */
  subject: string;
  /** Deterministic reason the observation could not be projected. */
  reason: string;
}

export interface RuntimeView {
  /** The observed runtime structure (validated GraphShape). */
  graph: GraphShape;
  /** Per-subject observation tallies for every subject the observations named (sorted by subject). */
  subjectCoverage: RuntimeSubjectCoverage[];
  /** Nodes asserted by the runtime view (sorted by id). */
  sightedNodes: SightedNode[];
  /** Observations that could not be projected, with reasons (input order). */
  unprojected: UnprojectedObservation[];
}

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

/**
 * Converts runtime observation records into a RuntimeView.
 * Contract: `project` is deterministic (identical observations produce
 * identical views) and NEVER throws on observation CONTENT — malformed
 * observations throw (validation), unprojectable-but-valid ones are
 * retained in `unprojected`.
 */
export interface RuntimeViewAdapter {
  /** Stable, non-empty adapter identifier (e.g. "runtime-view:structural"). */
  readonly id: string;
  /** Project runtime observations into the runtime view. */
  project(observations: readonly RawObservation[]): RuntimeView;
}

// ---------------------------------------------------------------------------
// Built-in structural adapter
// ---------------------------------------------------------------------------

export const STRUCTURAL_ADAPTER_ID = 'runtime-view:structural';

/** Edge kinds implying an Interface target, a DataStore target, else Component. */
function impliedTargetKind(edgeKind: string): string {
  if (edgeKind === 'Provides' || edgeKind === 'Consumes') return 'Interface';
  if (edgeKind === 'Owns') return 'DataStore';
  return 'Component';
}

interface StructuralEdgeSighting {
  target: string;
  kind: string;
}

function isStructuralEdgeSighting(value: unknown): value is StructuralEdgeSighting {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record['target'] !== 'string' || (record['target'] as string).length === 0) {
    return false;
  }
  return typeof record['kind'] === 'string' && (record['kind'] as string).length > 0;
}

function emptyCounts(): Record<EvidenceTruthState, number> {
  return { SUCCESS: 0, FAILURE: 0, UNKNOWN: 0, UNAVAILABLE: 0, UNSUPPORTED: 0, PARTIAL: 0 };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * The built-in structural runtime view adapter (see module doc for the
 * interpretation contract). Deterministic; total on valid observations.
 */
export const structuralRuntimeAdapter: RuntimeViewAdapter = {
  id: STRUCTURAL_ADAPTER_ID,
  project(observations: readonly RawObservation[]): RuntimeView {
    if (!Array.isArray(observations)) {
      throw new RuntimeConformanceError('observations must be an array of RawObservation records');
    }
    for (const observation of observations) {
      try {
        assertValidRawObservation(observation);
      } catch (cause) {
        throw new RuntimeConformanceError(`observation is invalid: ${(cause as Error).message}`);
      }
    }

    // Per-subject tallies over all 6 states (insertion order of first sighting; sorted at the end).
    const coverageBySubject = new Map<string, Record<EvidenceTruthState, number>>();
    const tally = (subject: string, availability: EvidenceTruthState): void => {
      const counts = coverageBySubject.get(subject) ?? emptyCounts();
      counts[availability] += 1;
      coverageBySubject.set(subject, counts);
    };

    // Node sightings: subject -> { kind, direct } (first usable observation decides the kind;
    // later sightings never overwrite it — deterministic first-wins, documented).
    const directKinds = new Map<string, string>();
    const indirectKinds = new Map<string, string>();
    // Edge sightings keyed by (source, target, kind).
    const edgeSightings = new Map<string, GraphEdge>();
    const unprojected: UnprojectedObservation[] = [];

    const usable = (availability: EvidenceTruthState): boolean =>
      availability === 'SUCCESS' ||
      availability === 'FAILURE' ||
      availability === 'UNKNOWN' ||
      availability === 'PARTIAL';

    observations.forEach((observation, index) => {
      tally(observation.subject_ref, observation.availability);
      if (!usable(observation.availability)) {
        return; // gaps and unservable subjects assert nothing structurally (tallied only)
      }
      const nodeKindAttribute = observation.attributes['runtime.node_kind'];
      let nodeKind = 'Component';
      if (nodeKindAttribute !== undefined) {
        if (typeof nodeKindAttribute !== 'string' || !isNonEmptyString(nodeKindAttribute)) {
          unprojected.push({
            index,
            subject: observation.subject_ref,
            reason: `attribute runtime.node_kind must be a non-empty string, received: ${JSON.stringify(nodeKindAttribute)}`,
          });
          return;
        }
        nodeKind = nodeKindAttribute;
        if (!isRegisteredNodeKind(nodeKind)) {
          unprojected.push({
            index,
            subject: observation.subject_ref,
            reason: `attribute runtime.node_kind "${nodeKind}" is not a registered architecture node kind`,
          });
          return;
        }
      }
      if (!directKinds.has(observation.subject_ref)) {
        directKinds.set(observation.subject_ref, nodeKind);
      }

      const edgesAttribute = observation.attributes['runtime.edges'];
      if (edgesAttribute === undefined) {
        return;
      }
      if (!Array.isArray(edgesAttribute)) {
        unprojected.push({
          index,
          subject: observation.subject_ref,
          reason: `attribute runtime.edges must be an array of { target, kind } objects, received: ${JSON.stringify(edgesAttribute)}`,
        });
        return;
      }
      for (const candidate of edgesAttribute) {
        if (!isStructuralEdgeSighting(candidate)) {
          unprojected.push({
            index,
            subject: observation.subject_ref,
            reason: `runtime.edges entry is not a { target, kind } object, received: ${JSON.stringify(candidate)}`,
          });
          continue;
        }
        if (!isRegisteredEdgeKind(candidate.kind)) {
          unprojected.push({
            index,
            subject: observation.subject_ref,
            reason: `runtime.edges entry kind "${candidate.kind}" is not a registered architecture edge kind`,
          });
          continue;
        }
        const key = `${observation.subject_ref}->${candidate.target}->${candidate.kind}`;
        if (!edgeSightings.has(key)) {
          edgeSightings.set(key, {
            source: observation.subject_ref,
            target: candidate.target,
            kind: candidate.kind,
            criticality: 'normal',
            attributes: {},
          });
        }
        if (!directKinds.has(candidate.target) && !indirectKinds.has(candidate.target)) {
          indirectKinds.set(candidate.target, impliedTargetKind(candidate.kind));
        }
      }
    });

    // Assemble the graph: directly-sighted nodes plus indirectly-sighted edge
    // targets (their kind is only implied when not directly sighted).
    const nodes: GraphNode[] = [];
    const kindById = new Map<string, string>();
    for (const [id, kind] of [...directKinds.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
      nodes.push({ id, kind, criticality: 'normal', attributes: {} });
      kindById.set(id, kind);
    }
    for (const [id, kind] of [...indirectKinds.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
      if (kindById.has(id)) continue;
      nodes.push({ id, kind, criticality: 'normal', attributes: {} });
      kindById.set(id, kind);
    }
    const edges = [...edgeSightings.values()].sort((a, b) => {
      const ka = `${a.source}->${a.target}->${a.kind}`;
      const kb = `${b.source}->${b.target}->${b.kind}`;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });

    const graph: GraphShape = { nodes, edges };
    try {
      assertValidGraphShape(graph);
    } catch (cause) {
      throw new RuntimeConformanceError(
        `the structural adapter produced an invalid runtime graph: ${(cause as Error).message}`,
      );
    }

    const subjectCoverage: RuntimeSubjectCoverage[] = [...coverageBySubject.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([subject, counts]) => ({ subject, counts }));

    const sightedNodes: SightedNode[] = [...kindById.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([id, kind]) => ({ id, kind, direct: directKinds.has(id) }));

    return { graph, subjectCoverage, sightedNodes, unprojected };
  },
};

/** Guard: is this a RuntimeViewAdapter-shaped object? */
export function isRuntimeViewAdapter(value: unknown): value is RuntimeViewAdapter {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (!isNonEmptyString(record['id'])) {
    return false;
  }
  return typeof record['project'] === 'function';
}

/** All 6 truth states, in the frozen order (used by view construction helpers). */
export const VIEW_TRUTH_STATES: readonly EvidenceTruthState[] = EVIDENCE_TRUTH_STATES;
