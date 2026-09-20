/**
 * OBJECT/META SEPARATION — the W16 structural invariant (stage 1).
 *
 * The OBJECT loop treats a TARGET SYSTEM (the W15 brownfield golden
 * fixtures): its changes are CandidateState-kind artifacts replacing bounded
 * subgraphs of an object system's architecture. The META loop proposes
 * changes to the SOS PROCESS ITSELF: its changes are MetaChange-kind
 * artifacts patching the MetaProcess parameters. One never masquerades as
 * the other: the routing layer pins the artifact KIND to the lane (the kind
 * is part of the spine id itself — sos://<Kind>/<segment> — so the check is
 * exact and unforgeable), and a change submitted to the wrong lane is
 * REJECTED with a typed RoutingRejection record.
 */

import { isArtifactId, parseArtifactId } from '@sos-2/semantic-spine';
import { MetaEvolutionError } from './errors.js';
import { META_CHANGE_KIND } from './kinds.js';

export type ChangeLane = 'OBJECT' | 'META';

/** Object-lane changes are CandidateState artifacts (the W9/W15 candidate contract). */
export const OBJECT_CHANGE_KIND = 'CandidateState';
/** Meta-lane changes are MetaChange artifacts (this package's extension kind — re-exported for lane checks). */
export { META_CHANGE_KIND };

export const ROUTING_REJECTION_CODES = ['OBJECT_META_CONFLATION', 'MALFORMED_CHANGE_ID'] as const;
export type RoutingRejectionCode = (typeof ROUTING_REJECTION_CODES)[number];

/** The typed routing rejection record (retained verbatim in the stage record). */
export interface RoutingRejection {
  code: RoutingRejectionCode;
  /** The lane that REJECTED the submission. */
  lane: ChangeLane;
  /** The kind parsed from the submitted id (null when malformed). */
  submitted_kind: string | null;
  /** The only kind this lane accepts. */
  expected_kind: string;
  /** The submitted artifact id (verbatim). */
  artifact_id: string;
  /** Human-readable reason (non-empty). */
  reason: string;
}

export interface RoutingVerdict {
  lane: ChangeLane;
  artifact_id: string;
  parsed_kind: string | null;
  accepted: boolean;
  rejection: RoutingRejection | null;
}

function route(lane: ChangeLane, artifactId: string): RoutingVerdict {
  const expectedKind = lane === 'OBJECT' ? OBJECT_CHANGE_KIND : META_CHANGE_KIND;
  if (!isArtifactId(artifactId)) {
    const rejection: RoutingRejection = {
      code: 'MALFORMED_CHANGE_ID',
      lane,
      submitted_kind: null,
      expected_kind: expectedKind,
      artifact_id: artifactId,
      reason: `the submitted change id is not a well-formed spine artifact id: ${JSON.stringify(artifactId)}`,
    };
    return { lane, artifact_id: artifactId, parsed_kind: null, accepted: false, rejection };
  }
  const parsedKind = parseArtifactId(artifactId).kind;
  if (parsedKind !== expectedKind) {
    const rejection: RoutingRejection = {
      code: 'OBJECT_META_CONFLATION',
      lane,
      submitted_kind: parsedKind,
      expected_kind: expectedKind,
      artifact_id: artifactId,
      reason:
        lane === 'OBJECT'
          ? `a ${parsedKind} artifact was routed through the OBJECT pipeline — the object loop accepts only ${expectedKind} changes against a target system (object/meta conflation rejected)`
          : `a ${parsedKind} artifact was routed through the META pipeline — the meta loop accepts only ${expectedKind} proposals against the SOS process itself (object/meta conflation rejected)`,
    };
    return { lane, artifact_id: artifactId, parsed_kind: parsedKind, accepted: false, rejection };
  }
  return { lane, artifact_id: artifactId, parsed_kind: parsedKind, accepted: true, rejection: null };
}

/**
 * Route a change submission to the OBJECT pipeline (the W15 brownfield loop
 * over an existing-system snapshot). A MetaChange submitted here is
 * REJECTED with a typed OBJECT_META_CONFLATION record.
 */
export function routeToObjectPipeline(artifactId: string): RoutingVerdict {
  return route('OBJECT', artifactId);
}

/**
 * Route a change submission to the META pipeline (this package's meta loop).
 * A CandidateState (object change) submitted here is REJECTED with a typed
 * OBJECT_META_CONFLATION record.
 */
export function routeToMetaPipeline(artifactId: string): RoutingVerdict {
  return route('META', artifactId);
}

/** Throwing form (pipeline-level invariant breach). */
export function assertRoutedToMeta(artifactId: string): void {
  const verdict = routeToMetaPipeline(artifactId);
  if (!verdict.accepted) {
    throw new MetaEvolutionError(
      'OBJECT_META_CONFLATION',
      verdict.rejection?.reason ?? `change ${artifactId} was not accepted by the meta pipeline`,
    );
  }
}
