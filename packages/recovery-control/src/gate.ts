/**
 * The RecoveryGate — where live changes meet the rollback contract
 * (Work Order W8; docs/assurance-model.md: "Promotion requires current
 * authority + assurance + evidence + compatible current System State").
 *
 * registerLiveChange({ declaration, grant, now, evidence }) performs the
 * FULL gate, in this order (every refusal is loud):
 *
 *   1. DECLARATION   the recovery declaration artifact is structurally
 *                    valid (mechanism, trigger, authority and evidence all
 *                    declared and well formed);
 *
 *   2. POLICY        the declaration satisfies the CURRENT trusted
 *                    recovery policy — unbounded/unspecified recovery is
 *                    REJECTED unless an explicit governed exception record
 *                    exists (spec/architecture.md section 13);
 *
 *   3. AUTHORITY     the presented grant IS the declaration's authority_ref
 *                    (the declaration names its authorizing grant; the gate
 *                    verifies THAT grant, not any other) and validly
 *                    authorizes PROMOTE on the live change artifact at the
 *                    registration instant, through the merged W1 authority
 *                    (expired/revoked/out-of-scope/unpermitted grants never
 *                    pass);
 *
 *   4. EVIDENCE      the referenced Evidence record is PRESENT in the
 *                    provided pool and has availability SUCCESS — the
 *                    declared containment must be demonstrated to work (a
 *                    failed or inconclusive rehearsal is not working
 *                    evidence, and a missing one is no evidence at all).
 *
 * The gate is in-memory (like the W1 AuthorityStore and the W3 stores); the
 * durable authorities are the artifacts (declarations, grants, evidence
 * records) that flow through it.
 */

import { authorize } from '@sos-2/authority';
import type { AuthorityGrantArtifact } from '@sos-2/authority';
import { assertValidEvidenceRecord } from '@sos-2/evidence';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import { isArtifactId, RFC3339_PATTERN } from '@sos-2/semantic-spine';
import { RecoveryGateError } from './errors.js';
import {
  assertValidRecoveryDeclaration,
  checkRecoveryDeclarationAgainstPolicy,
} from './declaration.js';
import type { RecoveryDeclarationArtifact } from './declaration.js';
import { assertValidRecoveryPolicy, updateRecoveryPolicy } from './policy.js';
import type { RecoveryPolicyArtifact, RecoveryPolicyChange } from './policy.js';

export interface LiveChangeRegistration {
  /** The recovery declaration for the live change. */
  declaration: RecoveryDeclarationArtifact;
  /** The grant the declaration names (content.authority_ref) — verified, not just trusted. */
  grant: AuthorityGrantArtifact;
  /** RFC3339 registration instant (also the grant evaluation point). */
  now: string;
  /** The evidence pool; MUST contain the referenced evidence record. */
  evidence: readonly EvidenceRecordW3[];
}

/** The gate's durable record of one registered live change. */
export interface LiveChangeRecord {
  /** The live change artifact id. */
  change_ref: string;
  /** The recovery declaration artifact id. */
  declaration_id: string;
  /** The recovery declaration envelope version. */
  declaration_version: number;
  /** The policy (id) the declaration was checked against. */
  policy_id: string;
  /** The policy version the declaration was checked against. */
  policy_version: number;
  /** The grant id that authorized the registration. */
  authorized_by: string;
  /** Registration instant (echo). */
  registered_at: string;
  /** Whether the declared mechanism is bounded. */
  bounded: boolean;
  /** Whether acceptance rode on a governed exception record. */
  via_exception: boolean;
}

/**
 * In-memory recovery gate: holds the current trusted policy, exposes the
 * authority-gated policy update path, and registers live changes against
 * the full four-step gate.
 */
export class RecoveryGate {
  private policyHead: RecoveryPolicyArtifact;
  private readonly registered: LiveChangeRecord[] = [];
  private readonly seenDeclarationIds = new Set<string>();

  constructor(policy: RecoveryPolicyArtifact) {
    assertValidRecoveryPolicy(policy);
    this.policyHead = policy;
  }

  /** The current policy head (defensive copy of the artifact). */
  policy(): RecoveryPolicyArtifact {
    return structuredClone(this.policyHead);
  }

  /**
   * Update the trusted policy through the authority-gated path (see
   * policy.ts — candidate origin is ALWAYS rejected). The gate's head moves
   * to the returned revision.
   */
  updatePolicy(change: RecoveryPolicyChange): RecoveryPolicyArtifact {
    const next = updateRecoveryPolicy(this.policyHead, change);
    this.policyHead = next;
    return structuredClone(next);
  }

  /**
   * Register a live change: full declaration + policy + authority +
   * evidence verification. Returns the gate's record; the same declaration
   * artifact cannot be registered twice (loud duplicate rejection).
   */
  registerLiveChange(input: LiveChangeRegistration): LiveChangeRecord {
    if (typeof input !== 'object' || input === null) {
      throw new RecoveryGateError('live change registration must be an object');
    }
    if (typeof input.now !== 'string' || !RFC3339_PATTERN.test(input.now)) {
      throw new RecoveryGateError(`registration now must be an RFC3339 timestamp, received: ${JSON.stringify(input.now)}`);
    }
    if (!Array.isArray(input.evidence)) {
      throw new RecoveryGateError('registration evidence must be an array of Evidence records');
    }

    // 1. Declaration.
    assertValidRecoveryDeclaration(input.declaration);

    // 2. Policy.
    const policyCheck = checkRecoveryDeclarationAgainstPolicy(
      input.declaration.content.mechanism,
      input.declaration.content.exception,
      this.policyHead.content.require_bounded_recovery,
    );
    if (!policyCheck.satisfied) {
      throw new RecoveryGateError(
        `live change ${input.declaration.content.change_ref} REJECTED by the recovery policy: ${policyCheck.reason}`,
      );
    }

    // 3. Authority — the declaration names its grant; verify THAT grant.
    if (input.grant.envelope.id !== input.declaration.content.authority_ref) {
      throw new RecoveryGateError(
        `the presented grant ${input.grant.envelope.id} is not the grant the declaration names as its authority ` +
          `(${input.declaration.content.authority_ref}) — the declaration's own authority must be verified, not substituted`,
      );
    }
    authorize(input.grant, {
      action: 'PROMOTE',
      target: { kind: 'ARTIFACT', artifact_id: input.declaration.content.change_ref },
      at: { kind: 'TIME', now: input.now },
    });

    // 4. Evidence — present and SUCCESS (the containment demonstrably works).
    const evidencePool = new Map<string, EvidenceRecordW3>();
    for (const record of input.evidence) {
      try {
        assertValidEvidenceRecord(record);
      } catch (cause) {
        throw new RecoveryGateError(`evidence pool contains an invalid record: ${(cause as Error).message}`);
      }
      if (!isArtifactId(record.id)) {
        throw new RecoveryGateError(`evidence pool contains a record with a malformed id: ${JSON.stringify(record.id)}`);
      }
      if (!evidencePool.has(record.id)) {
        evidencePool.set(record.id, record);
      }
    }
    const rehearsal = evidencePool.get(input.declaration.content.evidence_ref);
    if (rehearsal === undefined) {
      throw new RecoveryGateError(
        `the referenced evidence ${input.declaration.content.evidence_ref} is not in the provided evidence pool — ` +
          'a declared containment that cannot be produced for verification is no containment (fail-safe rejection)',
      );
    }
    if (rehearsal.availability !== 'SUCCESS') {
      throw new RecoveryGateError(
        `the referenced evidence ${input.declaration.content.evidence_ref} has availability ${rehearsal.availability} — ` +
          'only SUCCESS evidence demonstrates a working recovery mechanism (a failed or inconclusive rehearsal is not working evidence)',
      );
    }

    // Duplicate registration of the same declaration artifact is rejected.
    if (this.seenDeclarationIds.has(input.declaration.envelope.id)) {
      throw new RecoveryGateError(
        `recovery declaration ${input.declaration.envelope.id} is already registered (register each declaration once)`,
      );
    }

    const record: LiveChangeRecord = {
      change_ref: input.declaration.content.change_ref,
      declaration_id: input.declaration.envelope.id,
      declaration_version: input.declaration.envelope.version,
      policy_id: this.policyHead.envelope.id,
      policy_version: this.policyHead.envelope.version,
      authorized_by: input.grant.envelope.id,
      registered_at: input.now,
      bounded: input.declaration.content.mechanism.kind !== 'UNSPECIFIED',
      via_exception: input.declaration.content.exception !== null,
    };
    this.seenDeclarationIds.add(input.declaration.envelope.id);
    this.registered.push(record);
    return { ...record };
  }

  /** All registration records, sorted by (registered_at, declaration_id). Deterministic. */
  liveChanges(): LiveChangeRecord[] {
    return [...this.registered]
      .sort((a, b) =>
        a.registered_at === b.registered_at
          ? a.declaration_id < b.declaration_id
            ? -1
            : 1
          : a.registered_at < b.registered_at
            ? -1
            : 1,
      )
      .map((record) => ({ ...record }));
  }

  get size(): number {
    return this.registered.length;
  }
}
