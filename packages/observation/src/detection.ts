/**
 * Shortfall / opportunity detection — typed, non-authoritative records.
 *
 * Detections are INPUTS for the orchestrator (P6's lane), never
 * conclusions: they name what the observations show (CI failing on the
 * observed head, a deployment not at the observed head, a state claim
 * diverged, a passing-CI revision differing from the claimed one) with
 * the evidence event ids that produced them. Ordering of revisions is
 * NEVER claimed (shas are opaque): "NEWER" is not asserted anywhere —
 * only difference, with the evidence to inspect.
 */

import type { ProjectionSnapshot } from './projection.js';
import type { ReconciliationFinding } from './reconcile.js';

export type DetectionKind = 'SHORTFALL' | 'OPPORTUNITY';

export const DETECTION_CODES = {
  ciFailingOnHead: 'CI_FAILING_ON_HEAD',
  deployedNotAtHead: 'DEPLOYED_NOT_AT_HEAD',
  stateDiverged: 'STATE_DIVERGED',
  revisionUpdateAvailable: 'REVISION_UPDATE_AVAILABLE',
} as const;

export interface Detection {
  /** Deterministic detection id: `detection:<code>:<subject>`. */
  readonly detectionId: string;
  readonly kind: DetectionKind;
  readonly code: string;
  readonly subject: string;
  readonly detail: string;
  readonly evidenceEventIds: readonly string[];
  readonly detectedAt: string;
}

export interface DetectionEngineDeps {
  /**
   * Extracts the observed head revision + its evidence event ids for one
   * repository subject (the composition wires which branch is "the"
   * head — usually main). Returns null when the subject is not wired.
   */
  readonly headRevisionOf: (subject: string, snapshot: ProjectionSnapshot) => { revision: string; evidenceEventIds: readonly string[] } | null;
  /**
   * Extracts the currently-deployed revision for a repository subject +
   * environment (composition wiring). Returns null when not wired or
   * nothing deployed.
   */
  readonly deployedRevisionOf: (subject: string, environment: string, snapshot: ProjectionSnapshot) => { revision: string; evidenceEventIds: readonly string[] } | null;
  /** The environment to compare deployments against the head (e.g. "production"). */
  readonly primaryEnvironment: string;
  /** The repository subjects to run head/deployment detection over. */
  readonly repositorySubjects: readonly string[];
}

export class DetectionEngine {
  private readonly headRevisionOf: DetectionEngineDeps['headRevisionOf'];
  private readonly deployedRevisionOf: DetectionEngineDeps['deployedRevisionOf'];
  private readonly primaryEnvironment: string;
  private readonly repositorySubjects: readonly string[];

  constructor(deps: DetectionEngineDeps) {
    this.headRevisionOf = deps.headRevisionOf;
    this.deployedRevisionOf = deps.deployedRevisionOf;
    this.primaryEnvironment = deps.primaryEnvironment;
    this.repositorySubjects = deps.repositorySubjects;
  }

  /**
   * Run all detections over one snapshot + its reconciliation findings.
   * Deterministic: repository subjects in configured order, then
   * findings in their order.
   */
  detect(snapshot: ProjectionSnapshot, findings: readonly ReconciliationFinding[], detectedAt: string): readonly Detection[] {
    const detections: Detection[] = [];
    for (const subject of this.repositorySubjects) {
      const head = this.headRevisionOf(subject, snapshot);
      if (head !== null) {
        const ci = snapshot.ci.get(subject);
        if (ci !== undefined && ci.freshness.state === 'FRESH') {
          for (const run of Object.values(ci.latestByPipeline)) {
            if (run.status === 'FAILURE' && run.ref === head.revision) {
              detections.push(detection('SHORTFALL', DETECTION_CODES.ciFailingOnHead, subject, `CI pipeline reported FAILURE on the observed head ${head.revision}`, head.evidenceEventIds, detectedAt));
              break;
            }
          }
        }
        const deployed = this.deployedRevisionOf(subject, this.primaryEnvironment, snapshot);
        if (deployed !== null && deployed.revision !== head.revision) {
          detections.push(
            detection(
              'SHORTFALL',
              DETECTION_CODES.deployedNotAtHead,
              subject,
              `environment ${this.primaryEnvironment} deploys ${deployed.revision} while the observed head is ${head.revision} (ordering NOT asserted — inspect evidence)`,
              mergeIds(head.evidenceEventIds, deployed.evidenceEventIds),
              detectedAt,
            ),
          );
        }
      }
    }
    for (const finding of findings) {
      if (finding.kind === 'DIVERGED') {
        detections.push(detection('SHORTFALL', DETECTION_CODES.stateDiverged, finding.subject, `System State claims ${finding.claimedRevision} but observation shows ${finding.observedRevision}`, finding.evidenceEventIds, detectedAt));
      }
      if (finding.kind === 'ALIGNED') {
        // An aligned claim is not a detection — nothing to act on.
        continue;
      }
      void finding;
    }
    for (const subject of this.repositorySubjects) {
      const head = this.headRevisionOf(subject, snapshot);
      const ci = snapshot.ci.get(subject);
      if (head === null || ci === undefined || ci.freshness.state !== 'FRESH') {
        continue;
      }
      const passing = Object.values(ci.latestByPipeline).some((run) => run.ref === head.revision && run.status === 'SUCCESS');
      const claim = findings.find((entry) => entry.subject === subject && entry.observedRevision !== null);
      if (passing && claim !== undefined && claim.observedRevision !== head.revision) {
        detections.push(detection('OPPORTUNITY', DETECTION_CODES.revisionUpdateAvailable, subject, `an observed revision (${head.revision}) differs from the claimed one (${claim.claimedRevision}) with passing CI on the observed head`, mergeIds(head.evidenceEventIds, claim.evidenceEventIds), detectedAt));
      }
    }
    return detections;
  }
}

function detection(kind: DetectionKind, code: string, subject: string, detail: string, evidenceEventIds: readonly string[], detectedAt: string): Detection {
  return { detectionId: `detection:${code}:${subject}`, kind, code, subject, detail, evidenceEventIds, detectedAt };
}

function mergeIds(left: readonly string[], right: readonly string[]): readonly string[] {
  return [...new Set([...left, ...right])].sort();
}
