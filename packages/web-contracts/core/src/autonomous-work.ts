/**
 * The active autonomous work surface (P1 task packet): active tasks, body
 * leases (ephemeral execution resources) and observation status — with "SOS
 * is watching" shown as a state SEPARATE from "a body is working"
 * (user-journey 14: continuous monitoring without a body).
 *
 * THE FIXTURE DISCIPLINE (honesty about ownership): the durable task /
 * body-lease / observation-plane contracts are owned by the execution-fabric
 * Work Orders (P6 Spirit orchestrator, P7 continuous observation, P12
 * continuous autonomy) and are NOT yet frozen domain packages. The records
 * consumed here are therefore clearly-labelled VIEW-LEVEL fixtures: they
 * carry plain (non-spine) ids, they reference REAL spine ids (the mission,
 * evidence, ask requests they serve), and every view model binds the
 * rationale chain of the spine subject it serves — so each surface still
 * answers the six product review questions over typed spine trace links.
 * When the real contracts land, these projections consume them instead;
 * nothing here redefines or anticipates frozen semantics.
 *
 * Journey coverage: 14 (watching without a body), 15 (body interruption —
 * the task persists, the body is an interchangeable resource), 16 (cloud
 * work continues while the user's device is off), 17 (local companion
 * scope, queueing and reconciliation).
 */

import type { UncertaintyClass } from '@sos-2/evidence';
import type { RationaleChain } from '@sos-2/ui-contracts';
import type { DataSource } from './data-source.js';
import { WebContractError } from './errors.js';
import type { NextActionView } from './next-action.js';
import type { ProductVmCore } from './vm-core.js';

// ---------------------------------------------------------------------------
// View-level fixture records (plain ids — NOT spine ids; see module doc)
// ---------------------------------------------------------------------------

/** Task statuses for the product shell (view states over task runtime state; P12 owns the runtime). */
export const DEMO_TASK_STATUSES = ['RUNNING', 'PAUSED', 'QUEUED', 'AWAITING_DECISION', 'COMPLETED'] as const;

export type DemoTaskStatus = (typeof DEMO_TASK_STATUSES)[number];

export function isDemoTaskStatus(value: unknown): value is DemoTaskStatus {
  return typeof value === 'string' && (DEMO_TASK_STATUSES as readonly string[]).includes(value);
}

/**
 * A demo task record. Task state and evidence are DURABLE; a task survives
 * body replacement (journey 15) — `checkpoint` carries the durable resume
 * point, `lease_id` the (ephemeral) execution resource currently or last
 * attached.
 */
export interface DemoTaskRecord {
  task_id: string;
  title: string;
  status: DemoTaskStatus;
  /** What the task is doing, in one honest sentence. */
  summary: string;
  /** The spine mission id this task serves. */
  mission_ref: string;
  /** The demo body lease executing it, or null (observation-only or queued tasks need no body). */
  lease_id: string | null;
  /** The durable checkpoint note (journey 15), or null. */
  checkpoint: string | null;
  /** The spine AskRequest id this task is waiting on, or null. */
  ask_ref: string | null;
  /** Spine Evidence ids produced or consumed by the task. */
  evidence_refs: string[];
  /** Whether the task runs in the cloud (independent of the user's device) — journey 16. */
  runs_in_cloud: boolean;
  /** Static fixture instant (RFC3339 literal; never a hidden clock). */
  updated_at: string;
}

/** Body kinds from the execution architecture (cloud / remote / local bodies). */
export const DEMO_BODY_KINDS = ['CLOUD', 'REMOTE', 'LOCAL'] as const;

export type DemoBodyKind = (typeof DEMO_BODY_KINDS)[number];

/** Body lease statuses (the broker may suspend, replace or release a body without losing the task). */
export const DEMO_LEASE_STATUSES = ['ACTIVE', 'SUSPENDED', 'RELEASED'] as const;

export type DemoLeaseStatus = (typeof DEMO_LEASE_STATUSES)[number];

/** A demo body lease record — an EPHEMERAL execution resource. */
export interface DemoBodyLeaseRecord {
  lease_id: string;
  body_kind: DemoBodyKind;
  status: DemoLeaseStatus;
  /** The demo task holding the lease, or null. */
  held_by_task: string | null;
  /** Advertised capability classes (from the broker's capability selection). */
  capabilities: string[];
  /** Isolation note (what the body can and cannot touch). */
  isolation: string;
  /** Static fixture instant (RFC3339 literal). */
  granted_at: string;
}

/** A demo observation status record (the Observation Plane without a body). */
export interface DemoObservationRecord {
  watching: boolean;
  /** The event sources being consumed (GitHub/CI/deployment/runtime/probes). */
  sources: string[];
  /** Static fixture instant of the last ingested event. */
  last_event_at: string;
  /** Events ingested in the fixed demo window (static count). */
  events_in_window: number;
  /** The honest note that observation does not imply a working body. */
  note: string;
}

// ---------------------------------------------------------------------------
// View models
// ---------------------------------------------------------------------------

/** One active task summary (task state is durable; the body is a resource). */
export interface ActiveTaskSummaryVM {
  core: ProductVmCore;
  task_id: string;
  title: string;
  status: DemoTaskStatus;
  summary: string;
  mission_ref: string;
  lease_id: string | null;
  /** The body kind actually working on this task, or null when no body is attached. */
  working_body_kind: DemoBodyKind | null;
  checkpoint: string | null;
  ask_ref: string | null;
  runs_in_cloud: boolean;
  updated_at: string;
}

/** One body lease summary (an ephemeral execution resource). */
export interface BodyLeaseSummaryVM {
  core: ProductVmCore;
  lease_id: string;
  body_kind: DemoBodyKind;
  status: DemoLeaseStatus;
  held_by_task: string | null;
  capabilities: string[];
  isolation: string;
  granted_at: string;
  /** The journeys-15/16 note: the lease is ephemeral; the task and evidence survive it. */
  ephemerality_note: string;
}

/** The observation status (SEPARATE from body work — journey 14). */
export interface ObservationStatusVM {
  core: ProductVmCore;
  watching: boolean;
  sources: string[];
  last_event_at: string;
  events_in_window: number;
  note: string;
  /** Whether any body lease is currently ACTIVE (rendered beside, never merged with, watching). */
  any_body_working: boolean;
  separation_note: string;
}

// ---------------------------------------------------------------------------
// Projections (deterministic, total)
// ---------------------------------------------------------------------------

/** Project one task record (the rationale binds the mission the task serves). */
export function projectActiveTask(input: {
  task: DemoTaskRecord;
  leases: readonly DemoBodyLeaseRecord[];
  rationale: RationaleChain;
  data_source: DataSource;
  uncertainty: { uncertainty_class: UncertaintyClass; statement: string };
  authority: ProductVmCore['authority'];
  next_allowed_action: NextActionView;
}): ActiveTaskSummaryVM {
  if (input.rationale.subject_id !== input.task.mission_ref) {
    throw new WebContractError('the active-task rationale must bind the mission the task serves');
  }
  const lease = input.task.lease_id ? input.leases.find((entry) => entry.lease_id === input.task.lease_id) ?? null : null;
  const working_body_kind = lease && lease.status === 'ACTIVE' ? lease.body_kind : null;
  return {
    core: {
      subject_id: input.task.mission_ref,
      data_source: input.data_source,
      rationale: input.rationale,
      evidence_refs: [...new Set(input.task.evidence_refs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      uncertainty: {
        uncertainty_class: input.uncertainty.uncertainty_class,
        statement: input.uncertainty.statement,
      },
      authority: input.authority,
      next_allowed_action: input.next_allowed_action,
    },
    task_id: input.task.task_id,
    title: input.task.title,
    status: input.task.status,
    summary: input.task.summary,
    mission_ref: input.task.mission_ref,
    lease_id: input.task.lease_id,
    working_body_kind,
    checkpoint: input.task.checkpoint,
    ask_ref: input.task.ask_ref,
    runs_in_cloud: input.task.runs_in_cloud,
    updated_at: input.task.updated_at,
  };
}

/** Project one body lease record (the rationale binds the mission the leased work serves). */
export function projectBodyLease(input: {
  lease: DemoBodyLeaseRecord;
  mission_ref: string;
  rationale: RationaleChain;
  data_source: DataSource;
  uncertainty: { uncertainty_class: UncertaintyClass; statement: string };
  authority: ProductVmCore['authority'];
  next_allowed_action: NextActionView;
}): BodyLeaseSummaryVM {
  if (input.rationale.subject_id !== input.mission_ref) {
    throw new WebContractError('the body-lease rationale must bind the mission the leased work serves');
  }
  return {
    core: {
      subject_id: input.mission_ref,
      data_source: input.data_source,
      rationale: input.rationale,
      evidence_refs: [],
      uncertainty: {
        uncertainty_class: input.uncertainty.uncertainty_class,
        statement: input.uncertainty.statement,
      },
      authority: input.authority,
      next_allowed_action: input.next_allowed_action,
    },
    lease_id: input.lease.lease_id,
    body_kind: input.lease.body_kind,
    status: input.lease.status,
    held_by_task: input.lease.held_by_task,
    capabilities: [...input.lease.capabilities],
    isolation: input.lease.isolation,
    granted_at: input.lease.granted_at,
    ephemerality_note:
      'A body lease is an ephemeral execution resource. The task, its checkpoints and its evidence survive body replacement.',
  };
}

/** Project the observation status (the rationale binds the system state observation updates). */
export function projectObservationStatus(input: {
  observation: DemoObservationRecord;
  system_state_ref: string;
  any_body_working: boolean;
  rationale: RationaleChain;
  data_source: DataSource;
  uncertainty: { uncertainty_class: UncertaintyClass; statement: string };
  authority: ProductVmCore['authority'];
  next_allowed_action: NextActionView;
}): ObservationStatusVM {
  if (input.rationale.subject_id !== input.system_state_ref) {
    throw new WebContractError('the observation-status rationale must bind the system state observation updates');
  }
  return {
    core: {
      subject_id: input.system_state_ref,
      data_source: input.data_source,
      rationale: input.rationale,
      evidence_refs: [],
      uncertainty: {
        uncertainty_class: input.uncertainty.uncertainty_class,
        statement: input.uncertainty.statement,
      },
      authority: input.authority,
      next_allowed_action: input.next_allowed_action,
    },
    watching: input.observation.watching,
    sources: [...input.observation.sources],
    last_event_at: input.observation.last_event_at,
    events_in_window: input.observation.events_in_window,
    note: input.observation.note,
    any_body_working: input.any_body_working,
    separation_note:
      'SOS is watching. Observation is continuous and does not use a working body; a body is summoned only when active inspection or change is required.',
  };
}

/** The deterministic task list order: RUNNING, then AWAITING_DECISION, PAUSED, QUEUED, COMPLETED; then task id. */
export function compareDemoTasks(a: DemoTaskRecord, b: DemoTaskRecord): number {
  const rank: Record<DemoTaskStatus, number> = {
    RUNNING: 0,
    AWAITING_DECISION: 1,
    PAUSED: 2,
    QUEUED: 3,
    COMPLETED: 4,
  };
  if (rank[a.status] !== rank[b.status]) {
    return rank[a.status] - rank[b.status];
  }
  return a.task_id < b.task_id ? -1 : a.task_id > b.task_id ? 1 : 0;
}

/** The deterministic lease list order: ACTIVE, SUSPENDED, RELEASED; then lease id. */
export function compareDemoLeases(a: DemoBodyLeaseRecord, b: DemoBodyLeaseRecord): number {
  const rank: Record<DemoLeaseStatus, number> = {
    ACTIVE: 0,
    SUSPENDED: 1,
    RELEASED: 2,
  };
  if (rank[a.status] !== rank[b.status]) {
    return rank[a.status] - rank[b.status];
  }
  return a.lease_id < b.lease_id ? -1 : a.lease_id > b.lease_id ? 1 : 0;
}
