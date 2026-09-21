/**
 * Projection tests — every product-shell projection over the demo world:
 * truth states, provenance and exact revisions are preserved; every
 * consequential view model carries a valid rationale chain that binds its
 * subject; the six-question structure (what/why/evidence/uncertainty/
 * authority/next) is present on every view model.
 */

import { describe, expect, test } from 'vitest';
import { assertValidRationaleChain } from '@sos-2/ui-contracts';
import {
  assertValidAuthorityView,
  assertValidNextActionView,
  assertValidProductVmCore,
  authorityModeLabel,
  currentGapOf,
  gateNextAction,
  projectActiveTask,
  projectBodyLease,
  projectCurrentChange,
  projectEvidenceQuality,
  projectExperimentStatus,
  projectMissionHero,
  projectNextAllowedAction,
  projectObservationStatus,
  projectPackageReuse,
  projectRecentLearning,
  projectShortfallOpportunity,
  projectSystemCondition,
  rationaleRoute,
} from '../src/index.js';
import { chainFor, currentOf, demoSource, evidenceAbout, world } from './helpers.js';

const w = world();
const source = demoSource();
const mission = currentOf(w.missions);
const systemState = currentOf(w.system_states);
const candidate = w.candidates[0]!;

function coreChecks(vm: { core: ReturnType<typeof projectMissionHero>['core'] }, label: string) {
  expect(vm.core.data_source.kind, `${label} is demo-backed`).toBe('DEMO');
  expect(vm.core.data_source.kind === 'DEMO' ? vm.core.data_source.label : '').toBe('DEMO — SIMULATED DATA');
  expect(() => assertValidProductVmCore(vm.core), `${label} core is valid`).not.toThrow();
  expect(() => assertValidRationaleChain(vm.core.rationale), `${label} rationale is valid`).not.toThrow();
  expect(vm.core.rationale.subject_id).toBe(vm.core.subject_id);
  expect(() => assertValidAuthorityView(vm.core.authority), `${label} authority is valid`).not.toThrow();
  expect(() => assertValidNextActionView(vm.core.next_allowed_action), `${label} next action is valid`).not.toThrow();
  expect(vm.core.uncertainty.statement.length).toBeGreaterThan(0);
}

describe('mission hero projection', () => {
  test('carries the mission purpose, goals with measures and a healthy structure', () => {
    const vm = projectMissionHero({
      mission,
      gaps: w.gaps,
      rationale: chainFor(mission.envelope.id, w.links),
      data_source: source,
      evidence_refs: w.evidence.filter((record) => record.subject_ref === systemState.envelope.id).map((record) => record.id),
      uncertainty: { uncertainty_class: 'MODERATE', statement: 'Peak-hour telemetry is partially available.' },
      authority: {
        mode: 'AUTONOMOUS_WITH_ASK',
        required_permission: null,
        grant_ref: w.grants.mission_revision.envelope.id,
        note: 'The mission evolves under an explicit revision grant.',
      },
      next_allowed_action: {
        action_id: 'hero-next',
        kind: 'DECIDE',
        label: 'Answer the open question',
        description: 'One question is waiting for a human decision.',
        href: '/ask',
        rationale_ref: w.ask.request.envelope.id,
        requires_authority: null,
      },
    });
    coreChecks(vm, 'mission hero');
    expect(vm.purpose).toBe(mission.content.purpose);
    expect(vm.mission_id).toBe(mission.envelope.id);
    expect(vm.goals.map((goal) => goal.status)).toEqual(['MEASURABLE', 'MEASURABLE']);
    expect(vm.goals[1]!.measures.map((measure) => measure.measure_id)).toEqual(['measure-p95', 'measure-cost']);
    // The documented display rule: the DEGRADED shortfall drives the chip.
    expect(vm.outcome_health).toBe('DEGRADED');
    expect(vm.outcome_basis).toContain('250 ms');
  });

  test('rejects a rationale chain that does not bind the mission', () => {
    expect(() =>
      projectMissionHero({
        mission,
        gaps: w.gaps,
        rationale: chainFor(systemState.envelope.id, w.links),
        data_source: source,
        evidence_refs: [],
        uncertainty: { uncertainty_class: 'MODERATE', statement: 'x' },
        authority: { mode: 'READ_ONLY', required_permission: null, grant_ref: null, note: 'x' },
        next_allowed_action: {
          action_id: 'a', kind: 'NAVIGATE', label: 'Go', description: 'Go', href: '/', rationale_ref: null, requires_authority: null,
        },
      }),
    ).toThrow(/must bind the mission id/);
  });
});

describe('system condition projection', () => {
  test('classifies from the evidence about the current system state, with exact revisions preserved', () => {
    const currentEvidence = evidenceAbout(w.evidence, [systemState.envelope.id, w.observed_model_id]);
    const vm = projectSystemCondition({
      system_state: systemState,
      current_evidence: currentEvidence,
      coverage: { present: ['uptime telemetry', 'latency telemetry'], missing: ['implementation-model telemetry'] },
      rationale: chainFor(systemState.envelope.id, w.links, currentEvidence.map((record) => record.id)),
      data_source: source,
      uncertainty: { uncertainty_class: 'MODERATE', statement: 'Latency telemetry is partially available.' },
      authority: {
        mode: 'AUTONOMOUS_WITH_ASK',
        required_permission: 'REVISE',
        grant_ref: w.grants.mission_revision.envelope.id,
        note: 'System state transitions require revision authority.',
      },
      next_allowed_action: {
        action_id: 'system-next', kind: 'REVIEW', label: 'View the system', description: 'See exact revisions.',
        href: '/system', rationale_ref: systemState.envelope.id, requires_authority: null,
      },
    });
    coreChecks(vm, 'system condition');
    // PARTIAL latency evidence -> DEGRADED, with the basis shown.
    expect(vm.condition).toBe('DEGRADED');
    expect(vm.refs.map((ref) => ref.kind).sort()).toEqual(['CONFIGURATION', 'DEPLOYMENT', 'IMPLEMENTATION', 'POLICY']);
    const deployment = vm.refs.find((ref) => ref.kind === 'DEPLOYMENT');
    expect(deployment?.revision).toBe('deploy:checkout-prod-2025-06-01');
    expect(vm.active_experiment_refs).toEqual([w.experiment.artifact.envelope.id]);
    // The coverage block lists exactly what is present and missing.
    expect(vm.coverage_block?.kind).toBe('PARTIAL');
    expect(vm.coverage_block?.missing).toEqual(['implementation-model telemetry']);
  });

  test('UNKNOWN when nothing has been observed about the current system', () => {
    const vm = projectSystemCondition({
      system_state: systemState,
      current_evidence: [],
      coverage: { present: [], missing: ['all sources'] },
      rationale: chainFor(systemState.envelope.id, w.links),
      data_source: source,
      uncertainty: { uncertainty_class: 'UNQUANTIFIED', statement: 'Nothing observed yet.' },
      authority: { mode: 'READ_ONLY', required_permission: null, grant_ref: null, note: 'Observing.' },
      next_allowed_action: {
        action_id: 'a', kind: 'REVIEW', label: 'View', description: 'View', href: '/system', rationale_ref: null, requires_authority: null,
      },
    });
    expect(vm.condition).toBe('UNKNOWN');
    expect(vm.coverage_block).toBeNull();
  });
});

describe('shortfall/opportunity projection', () => {
  test('projects the current shortfall with its goal and measure', () => {
    const gap = currentGapOf(w.gaps);
    expect(gap?.kind).toBe('SHORTFALL');
    const vm = projectShortfallOpportunity({
      gap: gap!,
      mission,
      rationale: chainFor(mission.envelope.id, w.links, gap!.evidence_refs),
      data_source: source,
      authority: { mode: 'AUTONOMOUS_WITH_ASK', required_permission: null, grant_ref: null, note: 'The gap is defined by the mission measure.' },
      next_allowed_action: {
        action_id: 'gap-next', kind: 'REVIEW', label: 'View the experiment', description: 'The canary addresses this gap.',
        href: '/experiments', rationale_ref: w.experiment.artifact.envelope.id, requires_authority: null,
      },
    });
    coreChecks(vm, 'shortfall');
    expect(vm.kind).toBe('SHORTFALL');
    expect(vm.goal_ref).toBe('goal-latency');
    expect(vm.measure_target).toBe('<= 250');
    expect(vm.core.evidence_refs).toEqual(gap!.evidence_refs);
  });

  test('shortfalls sort before opportunities (the current-gap rule)', () => {
    expect(currentGapOf([...w.gaps].reverse())?.record_id).toBe('gap-latency-shortfall');
    expect(currentGapOf([])).toBeNull();
  });
});

describe('next allowed action projection + gating', () => {
  const askAction = {
    action_id: 'hero-next',
    kind: 'DECIDE' as const,
    label: 'Answer the open question',
    description: 'One question is waiting for a human decision.',
    href: '/ask',
    rationale_ref: w.ask.request.envelope.id,
    requires_authority: null,
  };

  test('projects the pending-ASK action with NEEDS_HUMAN_DECISION availability', () => {
    const availability = gateNextAction({
      action: askAction,
      data_source: source,
      pending_ask_ref: w.ask.request.envelope.id,
    });
    expect(availability.kind).toBe('NEEDS_HUMAN_DECISION');
    const vm = projectNextAllowedAction({
      subject_id: w.ask.request.envelope.id,
      action: askAction,
      availability,
      priority_reason: 'A question SOS cannot answer with evidence outranks autonomous next steps.',
      rationale: chainFor(w.ask.request.envelope.id, w.links),
      data_source: source,
      evidence_refs: w.ask.decision.content.evidence_refs,
      uncertainty: { uncertainty_class: 'UNQUANTIFIED', statement: 'The deciding question is irreducible.' },
      authority: { mode: 'AUTONOMOUS_WITH_ASK', required_permission: 'RETIRE', grant_ref: w.grants.retirement.envelope.id, note: 'Retirement authority is held; the human answer is still required.' },
    });
    coreChecks(vm, 'next action');
    expect(vm.availability.kind).toBe('NEEDS_HUMAN_DECISION');
  });

  test('an EXECUTE action on a DEMO surface is never presented as executable', () => {
    const availability = gateNextAction({
      action: {
        action_id: 'advance-canary',
        kind: 'EXECUTE',
        label: 'Advance the canary to 25% exposure',
        description: 'Raises the treatment arm exposure.',
        href: null,
        rationale_ref: w.experiment.artifact.envelope.id,
        requires_authority: 'PROMOTE',
      },
      data_source: source,
      grant_held: true,
    });
    expect(availability.kind).toBe('NOT_AVAILABLE_IN_DEMO');
  });

  test('a LIVE EXECUTE action without a grant needs authority', () => {
    const availability = gateNextAction({
      action: {
        action_id: 'advance-canary',
        kind: 'EXECUTE',
        label: 'Advance the canary to 25% exposure',
        description: 'Raises the treatment arm exposure.',
        href: null,
        rationale_ref: null,
        requires_authority: 'PROMOTE',
      },
      data_source: { kind: 'LIVE', store_ref: 'durable://system-state', as_of: '2025-06-15T12:00:00Z' },
      grant_held: false,
    });
    expect(availability.kind).toBe('NEEDS_AUTHORITY');
  });

  test('navigation actions are always enabled', () => {
    const availability = gateNextAction({
      action: { ...askAction, kind: 'NAVIGATE' },
      data_source: source,
    });
    expect(availability.kind).toBe('ENABLED');
  });
});

describe('autonomous work projections', () => {
  test('tasks project with body attachment distinct from task state', () => {
    const running = w.tasks.find((task) => task.task_id === 'task-canary-guardrail-eval')!;
    const vm = projectActiveTask({
      task: running,
      leases: w.leases,
      rationale: chainFor(running.mission_ref, w.links, running.evidence_refs),
      data_source: source,
      uncertainty: { uncertainty_class: 'MODERATE', statement: 'Guardrail evaluation is in progress.' },
      authority: { mode: 'AUTONOMOUS_WITH_ASK', required_permission: null, grant_ref: null, note: 'Evaluation is read-only.' },
      next_allowed_action: {
        action_id: 'task-next', kind: 'REVIEW', label: 'View the task', description: 'See progress and evidence.',
        href: '/', rationale_ref: null, requires_authority: null,
      },
    });
    coreChecks(vm, 'active task');
    expect(vm.status).toBe('RUNNING');
    expect(vm.working_body_kind).toBe('CLOUD');
    expect(vm.runs_in_cloud).toBe(true);
    // The paused shadow task has NO working body (the lease is suspended) — journey 15.
    const paused = w.tasks.find((task) => task.task_id === 'task-edge-cache-shadow')!;
    const pausedVm = projectActiveTask({
      task: paused,
      leases: w.leases,
      rationale: chainFor(paused.mission_ref, w.links, paused.evidence_refs),
      data_source: source,
      uncertainty: { uncertainty_class: 'WEAK', statement: 'Resume behavior on a replacement body is unproven.' },
      authority: { mode: 'AUTONOMOUS_WITH_ASK', required_permission: null, grant_ref: null, note: 'The broker will select a replacement body.' },
      next_allowed_action: {
        action_id: 'task-next', kind: 'REVIEW', label: 'View the task', description: 'See the checkpoint.',
        href: '/', rationale_ref: null, requires_authority: null,
      },
    });
    expect(pausedVm.status).toBe('PAUSED');
    expect(pausedVm.working_body_kind).toBeNull();
    expect(pausedVm.checkpoint).toContain('62%');
  });

  test('body leases are ephemeral resources; observation is separate from body work', () => {
    const lease = w.leases[0]!;
    const leaseVm = projectBodyLease({
      lease,
      mission_ref: mission.envelope.id,
      rationale: chainFor(mission.envelope.id, w.links),
      data_source: source,
      uncertainty: { uncertainty_class: 'UNQUANTIFIED', statement: 'Lease lifetime is ephemeral.' },
      authority: { mode: 'AUTONOMOUS_WITH_ASK', required_permission: null, grant_ref: null, note: 'Bodies cannot widen authority.' },
      next_allowed_action: {
        action_id: 'lease-next', kind: 'REVIEW', label: 'View leases', description: 'See the execution resources.',
        href: '/', rationale_ref: null, requires_authority: null,
      },
    });
    coreChecks(leaseVm, 'body lease');
    expect(leaseVm.ephemerality_note).toContain('ephemeral');

    const observationVm = projectObservationStatus({
      observation: w.observation,
      system_state_ref: systemState.envelope.id,
      any_body_working: true,
      rationale: chainFor(systemState.envelope.id, w.links),
      data_source: source,
      uncertainty: { uncertainty_class: 'UNQUANTIFIED', statement: 'Observation coverage is partial.' },
      authority: { mode: 'READ_ONLY', required_permission: null, grant_ref: null, note: 'Observation requires no action authority.' },
      next_allowed_action: {
        action_id: 'obs-next', kind: 'REVIEW', label: 'View evidence', description: 'See what observation produced.',
        href: '/evidence', rationale_ref: systemState.envelope.id, requires_authority: null,
      },
    });
    coreChecks(observationVm, 'observation status');
    expect(observationVm.watching).toBe(true);
    expect(observationVm.any_body_working).toBe(true);
    expect(observationVm.separation_note).toContain('does not use a working body');
  });
});

describe('overview card projections', () => {
  test('current change preserves candidate vocabulary and rollback readiness', () => {
    const vm = projectCurrentChange({
      candidate,
      title: 'Durable-queue checkout buffering',
      experiment_ref: w.experiment.artifact.envelope.id,
      rollback_evidence: w.evidence.filter((record) => record.kind === 'rollback-rehearsal'),
      rationale: chainFor(candidate.envelope.id, w.links),
      data_source: source,
      evidence_refs: w.evidence.filter((record) => record.subject_ref === candidate.envelope.id).map((record) => record.id),
      uncertainty: { uncertainty_class: 'MODERATE', statement: 'Canary evidence covers 10% of traffic.' },
      authority: {
        mode: 'AUTONOMOUS_WITH_ASK',
        required_permission: 'PROMOTE',
        grant_ref: w.grants.promotion.envelope.id,
        note: 'Promotion authority over the candidate is held.',
      },
      next_allowed_action: {
        action_id: 'change-next', kind: 'REVIEW', label: 'View the change', description: 'See the full change story.',
        href: '/changes', rationale_ref: candidate.envelope.id, requires_authority: 'PROMOTE',
      },
    });
    coreChecks(vm, 'current change');
    expect(vm.rollback_rehearsed).toBe(true);
    expect(vm.predicted_effects.join(' ')).toContain('p95 latency');
    expect(vm.confidence_class).toBe('MODERATE');
  });

  test('evidence quality counts carry ALL six truth-state keys', () => {
    const vm = projectEvidenceQuality({
      records: w.evidence,
      coverage: { present: ['telemetry', 'tests', 'rehearsals'], missing: ['model collector'] },
      rationale: chainFor(systemState.envelope.id, w.links),
      data_source: source,
      uncertainty: { uncertainty_class: 'MODERATE', statement: 'Some sources are unreachable.' },
      authority: { mode: 'READ_ONLY', required_permission: null, grant_ref: null, note: 'Evidence review needs no authority.' },
      next_allowed_action: {
        action_id: 'ev-next', kind: 'NAVIGATE', label: 'Open Evidence', description: 'See every record.',
        href: '/evidence', rationale_ref: null, requires_authority: null,
      },
    });
    coreChecks(vm, 'evidence quality');
    expect(Object.keys(vm.counts).sort()).toEqual(['FAILURE', 'PARTIAL', 'SUCCESS', 'UNAVAILABLE', 'UNKNOWN', 'UNSUPPORTED']);
    expect(vm.total).toBe(w.evidence.length);
    expect(vm.counts.UNKNOWN).toBe(1);
    expect(vm.counts.UNAVAILABLE).toBe(1);
    expect(vm.counts.UNSUPPORTED).toBe(1);
    expect(vm.counts.PARTIAL).toBe(1);
    expect(vm.counts.FAILURE).toBe(2);
    expect(vm.llm_analysis_count).toBe(1);
    expect(vm.coverage_block?.kind).toBe('PARTIAL');
  });

  test('experiment status keeps the frozen phase vocabulary and the simulated honesty', () => {
    const vm = projectExperimentStatus({
      experiment: w.experiment.artifact,
      title: 'Durable-queue canary',
      result: { simulated: w.experiment.result.simulated, simulator: { version: w.experiment.result.simulator!.version, seed: w.experiment.result.simulator!.seed } },
      evaluation_summary: `Overall availability of the simulated run: ${w.experiment.evaluation.overall_availability}.`,
      rationale: chainFor(w.experiment.artifact.envelope.id, w.links),
      data_source: source,
      evidence_refs: w.evidence.filter((record) => record.subject_ref === w.experiment.artifact.envelope.id).map((record) => record.id),
      uncertainty: { uncertainty_class: 'MODERATE', statement: 'Simulated evaluation is infrastructure, not intervention evidence.' },
      authority: {
        mode: 'AUTONOMOUS_WITH_ASK',
        required_permission: 'PROMOTE',
        grant_ref: w.grants.promotion.envelope.id,
        note: 'Advancing the ladder requires promotion-grade evidence.',
      },
      next_allowed_action: {
        action_id: 'exp-next', kind: 'REVIEW', label: 'View the experiment', description: 'See stages and guardrails.',
        href: '/experiments', rationale_ref: w.experiment.artifact.envelope.id, requires_authority: 'PROMOTE',
      },
    });
    coreChecks(vm, 'experiment status');
    expect(vm.phase).toBe('CANARY');
    expect(vm.exposure_percent).toBe(10);
    expect(vm.canary_ladder).toEqual([5, 10, 25, 50]);
    expect(vm.run_is_simulated).toBe(true);
    expect(vm.simulator?.seed).toBe(424242);
    expect(vm.metrics.filter((metric) => metric.role === 'GUARDRAIL')).toHaveLength(2);
    expect(vm.rollback_criteria).toHaveLength(2);
  });

  test('package reuse keeps maturity, families and limitations', () => {
    const vm = projectPackageReuse({
      packages: w.packages,
      composition_count: 0,
      composition_note: 'No compositions are formed in this dataset yet.',
      rationale: chainFor(mission.envelope.id, w.links),
      data_source: source,
      uncertainty: { uncertainty_class: 'MODERATE', statement: 'Applicability is context-conditioned.' },
      authority: { mode: 'AUTONOMOUS_WITH_ASK', required_permission: null, grant_ref: null, note: 'Reuse review needs no authority.' },
      next_allowed_action: {
        action_id: 'pkg-next', kind: 'NAVIGATE', label: 'Open Packages', description: 'See the validated capabilities.',
        href: '/packages', rationale_ref: null, requires_authority: null,
      },
    });
    coreChecks(vm, 'package reuse');
    expect(vm.package_count).toBe(2);
    expect(vm.family_count).toBe(2);
    expect(vm.packages.every((row) => row.maturity === 'VALIDATED')).toBe(true);
    expect(vm.packages.flatMap((row) => row.limitations).length).toBe(2);
  });

  test('recent learning orders newest-first and keeps refs', () => {
    const vm = projectRecentLearning({
      entries: w.learning,
      as_of: w.now,
      rationale: chainFor(mission.envelope.id, w.links),
      data_source: source,
      uncertainty: { uncertainty_class: 'UNQUANTIFIED', statement: 'Learning is qualitative.' },
      authority: { mode: 'READ_ONLY', required_permission: null, grant_ref: null, note: 'Learning review needs no authority.' },
      next_allowed_action: {
        action_id: 'learn-next', kind: 'NAVIGATE', label: 'Open History', description: 'See the revision timeline.',
        href: '/history', rationale_ref: null, requires_authority: null,
      },
    });
    coreChecks(vm, 'recent learning');
    expect(vm.entries.map((entry) => entry.kind).sort()).toEqual(['AMBIGUITY_RESOLUTION', 'MISSION_REVISION', 'PACKAGE_LIMITATION']);
    expect(vm.entries[0]!.learned_at).toBe('2025-06-01T00:00:00Z');
    expect(vm.entries.every((entry) => entry.refs.length > 0)).toBe(true);
  });
});

describe('authority modes + rationale routes', () => {
  test('the three product authority modes have distinct labels', () => {
    const labels = (['AUTONOMOUS_WITH_ASK', 'SUPERVISED', 'READ_ONLY'] as const).map((mode) => authorityModeLabel(mode));
    expect(new Set(labels).size).toBe(3);
  });

  test('rationale routes are path-safe decompositions of spine ids', () => {
    const id = mission.envelope.id; // sos://Mission/<hex>
    const route = rationaleRoute('Mission', id.slice('sos://Mission/'.length));
    expect(route).toMatch(/^\/rationale\/Mission\/[0-9a-f]{32}$/);
  });
});
