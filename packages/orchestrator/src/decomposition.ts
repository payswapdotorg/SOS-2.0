/**
 * Mission-aware decomposition (Work Order P6).
 *
 * A Mission (consumed from @sos-2/mission) decomposes into a durable
 * task graph. DECOMPOSITION IS A TYPED RECORD (inputs, plan, rationale)
 * routed through the reasoning broker as NON-AUTHORITATIVE INPUT: the
 * broker's analysis INFORMS the plan (proposals, ordering hints), while
 * THE TASK GRAPH ITSELF IS AUTHORITATIVE STRUCTURE BUILT BY DETERMINISTIC
 * CODE — every planned task, owned-path scope, dependency and step is
 * derived deterministically from the mission content (pinned by tests:
 * the same mission + same broker output reproduces the same plan; the
 * plan survives even when the broker is honest-unavailable, because the
 * deterministic path needs no provider).
 *
 * The broker's contribution is recorded as broker_input
 * (non_authoritative: true — the analysis ids are inputs, never
 * authority, never verification evidence).
 */

import { contentHash } from '@sos-2/semantic-spine';
import type { JsonValue } from '@sos-2/semantic-spine';
import type { MissionArtifact } from '@sos-2/mission';
import { assertValidMission } from '@sos-2/mission';
import type { NonAuthoritativeAnalysis } from '@sos-2/reasoning-broker';
import type { TaskCostEnvelope } from '@sos-2/task-graph';
import { InvalidOrchestratorInputError } from './errors.js';
import type { WorkerStep } from '@sos-2/worker-runtime';

/** One planned task of the decomposition (deterministic structure). */
export interface PlannedTask {
  readonly task_id: string;
  readonly title: string;
  readonly owned_paths: readonly string[];
  readonly dependencies: readonly string[];
  readonly steps: readonly WorkerStep[];
  readonly cost_envelope: TaskCostEnvelope;
  readonly uncertainty: readonly string[];
}

/** The typed decomposition record (inputs, plan, rationale). */
export interface DecompositionRecord {
  /** Content-derived deterministic id ('dec:' + 24 hex). */
  readonly decomposition_id: string;
  readonly mission_ref: string;
  readonly authority_ref: string;
  /** The exact inputs: the mission digest + the broker analysis ids (non-authoritative). */
  readonly inputs: {
    readonly mission_digest: string;
    readonly broker_analyses: readonly string[];
  };
  /** The authoritative plan — built by DETERMINISTIC CODE. */
  readonly plan: readonly PlannedTask[];
  readonly rationale: string;
  /** The broker's contribution, recorded as non-authoritative input. */
  readonly broker_input: {
    readonly analysis_ids: readonly string[];
    readonly non_authoritative: true;
    readonly simulated: boolean;
    readonly routing_note: string;
  } | null;
  readonly created_at: string;
}

/** A deterministic id source for planned tasks (caller-supplied identity discipline). */
export interface TaskIdSource {
  next(): string;
}

/** A deterministic sequence id source ('task-0001', 'task-0002', ...). */
export function createDeterministicTaskIdSource(prefix = 'task'): TaskIdSource {
  let counter = 0;
  return {
    next(): string {
      counter += 1;
      return `${prefix}-${String(counter).padStart(4, '0')}`;
    },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** The canonical mission view handed to the reasoning broker (non-authoritative input). */
export function missionView(mission: MissionArtifact): JsonValue {
  assertValidMission(mission);
  const content = mission.content;
  return {
    purpose: content.purpose,
    goals: content.goals.map((goal) => ({ id: goal.id, statement: goal.statement, status: goal.status })),
    constraints: content.constraints.map((constraint) => ({ id: constraint.id, statement: constraint.statement, hard: constraint.hard })),
  };
}

/**
 * DETERMINISTIC DECOMPOSITION — the authoritative structure builder.
 * The mission's goals become planned tasks on DISJOINT owned-path
 * scopes (one scope per goal — three goals -> three concurrent lanes),
 * each with a deterministic step program (implementation write ->
 * checkpoint -> commit -> artifact capture). The broker's analysis is
 * consulted for INFORMATIVE proposals only: when a proposal names a
 * goal, its suggested title informs the planned title; the structure,
 * scopes, dependencies and steps are fixed deterministic code.
 */
export function decomposeMissionDeterministically(input: {
  mission: MissionArtifact;
  authority_ref: string;
  idSource: TaskIdSource;
  analysis: NonAuthoritativeAnalysis | null;
  created_at: string;
}): DecompositionRecord {
  assertValidMission(input.mission);
  if (!isNonEmptyString(input.authority_ref)) {
    throw new InvalidOrchestratorInputError('decomposition requires the authority reference the tasks will run under');
  }
  const mission = input.mission;
  const goals = mission.content.goals;
  const proposals = input.analysis === null ? [] : readProposals(input.analysis);
  const planned: PlannedTask[] = goals.map((goal) => {
    const proposal = proposals.find((candidate) => candidate.goal_id === goal.id) ?? null;
    const taskId = input.idSource.next();
    const scope = `work/${goal.id}`;
    const title = proposal === null ? `Advance goal ${goal.id}: ${goal.statement}` : `Advance goal ${goal.id}: ${proposal.suggested_title}`;
    const steps: WorkerStep[] = [
      {
        kind: 'operation',
        operation: {
          kind: 'workspace.write',
          path: `${scope}/implementation.ts`,
          content: `// deterministic work product for goal ${goal.id}\n// mission purpose: ${mission.content.purpose}\nexport const achieved = ${JSON.stringify(goal.statement)};\n`,
        },
      },
      { kind: 'checkpoint', label: `after writing ${scope}`, notes: 'deterministic decomposition checkpoint' },
      { kind: 'operation', operation: { kind: 'git.status' } },
      { kind: 'operation', operation: { kind: 'git.commit', message: `feat(work): advance goal ${goal.id}`, paths: [] } },
      {
        kind: 'operation',
        operation: { kind: 'artifacts.capture', name: `${goal.id}-summary`, content: `goal ${goal.id} advanced: ${goal.statement}` },
      },
    ];
    return {
      task_id: taskId,
      title,
      owned_paths: [scope],
      dependencies: [],
      steps,
      cost_envelope: { max_cost_usd: null, max_duration_ms: 3_600_000 },
      uncertainty: goal.status === 'PROPOSED' ? [`goal ${goal.id} is PROPOSED (not yet measurable)`] : [],
    };
  });
  const missionDigest = contentHash(missionView(mission));
  const decompositionId = `dec:${contentHash({
    mission_ref: mission.envelope.id,
    authority_ref: input.authority_ref,
    mission_digest: missionDigest,
    plan: planned,
    created_at: input.created_at,
  }).slice(0, 24)}`;
  const rationale =
    input.analysis === null
      ? `deterministic decomposition from the mission's ${goals.length} goal(s) — no broker analysis was available; the managed default is always present, so this branch means the caller explicitly passed none (the deterministic path needs no provider)`
      : `deterministic decomposition from the mission's ${goals.length} goal(s); the reasoning broker's analysis ${JSON.stringify(input.analysis.analysis_id)} informed titles/ordering as NON-AUTHORITATIVE input (simulated: ${input.analysis.simulated}) while the structure, scopes and step programs are deterministic code`;
  return {
    decomposition_id: decompositionId,
    mission_ref: mission.envelope.id,
    authority_ref: input.authority_ref,
    inputs: {
      mission_digest: missionDigest,
      broker_analyses: input.analysis === null ? [] : [input.analysis.analysis_id],
    },
    plan: planned,
    rationale,
    broker_input:
      input.analysis === null
        ? null
        : {
            analysis_ids: [input.analysis.analysis_id],
            non_authoritative: true,
            simulated: input.analysis.simulated,
            routing_note: `analysis produced by provider ${JSON.stringify(input.analysis.provenance.provider_id)} (model ${input.analysis.provenance.model} v${input.analysis.provenance.version}) — non-authoritative input to deterministic decomposition`,
          },
    created_at: input.created_at,
  };
}

/** Read the deterministic proposals from a broker analysis (defensive). */
function readProposals(analysis: NonAuthoritativeAnalysis): { proposal_id: string; goal_id: string | null; suggested_title: string }[] {
  const content = analysis.content;
  if (!isPlainObject(content) || !Array.isArray(content['proposed_work_items'])) {
    return [];
  }
  const items: { proposal_id: string; goal_id: string | null; suggested_title: string }[] = [];
  for (const entry of content['proposed_work_items']) {
    if (!isPlainObject(entry)) {
      continue;
    }
    items.push({
      proposal_id: typeof entry['proposal_id'] === 'string' ? entry['proposal_id'] : '',
      goal_id: typeof entry['goal_id'] === 'string' ? entry['goal_id'] : null,
      suggested_title: typeof entry['suggested_title'] === 'string' ? entry['suggested_title'] : '',
    });
  }
  return items;
}

/** Validate a DecompositionRecord (throws InvalidOrchestratorInputError). */
export function assertValidDecompositionRecord(value: unknown): asserts value is DecompositionRecord {
  if (!isPlainObject(value)) {
    throw new InvalidOrchestratorInputError('decomposition record must be an object');
  }
  const keys = ['decomposition_id', 'mission_ref', 'authority_ref', 'inputs', 'plan', 'rationale', 'broker_input', 'created_at'];
  const actual = Object.keys(value);
  if (actual.length !== keys.length || !keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    throw new InvalidOrchestratorInputError(`decomposition record must have the exact field set { ${keys.join(', ')} }`);
  }
  if (!isNonEmptyString(value['decomposition_id']) || !value['decomposition_id'].startsWith('dec:')) {
    throw new InvalidOrchestratorInputError('decomposition_id must be a content-derived dec: id');
  }
  if (!isNonEmptyString(value['mission_ref']) || !value['mission_ref'].startsWith('sos://Mission/')) {
    throw new InvalidOrchestratorInputError('decomposition mission_ref must be a sos://Mission/... artifact id');
  }
  if (!isNonEmptyString(value['authority_ref'])) {
    throw new InvalidOrchestratorInputError('decomposition authority_ref must be present — every task runs under authority');
  }
  if (!Array.isArray(value['plan']) || value['plan'].length === 0) {
    throw new InvalidOrchestratorInputError('decomposition plan must be a non-empty array of planned tasks');
  }
  for (const planned of value['plan']) {
    if (!isPlainObject(planned) || !isNonEmptyString(planned['task_id']) || !Array.isArray(planned['owned_paths']) || planned['owned_paths'].length === 0) {
      throw new InvalidOrchestratorInputError('every planned task carries a task id and a non-empty owned-path scope');
    }
  }
  if (value['broker_input'] !== null) {
    const brokerInput = value['broker_input'];
    if (
      !isPlainObject(brokerInput) ||
      !Array.isArray(brokerInput['analysis_ids']) ||
      brokerInput['non_authoritative'] !== true ||
      typeof brokerInput['simulated'] !== 'boolean' ||
      typeof brokerInput['routing_note'] !== 'string'
    ) {
      throw new InvalidOrchestratorInputError(
        'decomposition broker_input must be { analysis_ids, non_authoritative: true, simulated, routing_note } — broker output is recorded as non-authoritative input, never authority',
      );
    }
  }
}
