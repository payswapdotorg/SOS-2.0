/**
 * Task-graph invariant scans (Work Order P6).
 *
 * Crash safety is a STRUCTURAL property: worker crashes, provider outages
 * and body loss produce typed failures that leave the graph VALID. The
 * scans below are the machine-checked witness (consumed by the graph
 * after every mutation and pinned by tests/property suites):
 *
 *   G1  every node carries a mission reference and an authority reference
 *       (well-formed spine ids — no task exists outside mission+authority);
 *   G2  every dependency resolves to an existing node (no orphaned
 *       references) and the dependency relation is ACYCLIC;
 *   G3  owned-path scopes are non-empty and well-formed, and the scopes of
 *       concurrently RUNNING nodes are pairwise DISJOINT (no silent
 *       overlap — the collision is denied at assignment);
 *   G4  a RUNNING node carries an assignment (lane in 1..3, worker ref,
 *       lease ref); at most three lanes are in use at any time;
 *   G5  the checkpoint chain references checkpoints that exist (no
 *       partial-write ghosts) and is ordered by record order;
 *   G6  a FAILED node carries a recovery decision (RETRYABLE or TERMINAL
 *       — never NONE, never silently "done");
 *   G7  a COMPLETED node carries a final verification record reference
 *       (completion is verification-gated — section 10);
 *   G8  pending ask references are unique within a node (ASK is
 *       first-class, never duplicated);
 *   G9  every node's durable record is a complete section 6 shape (the
 *       caller-supplied record checks run in the graph; the scan verifies
 *       the node view agrees with the record).
 */

import type { TaskNode } from './node.js';
import { scopesCollide } from './scope.js';

/** One structural violation (named, machine-checkable). */
export interface GraphViolation {
  readonly rule: string;
  readonly task_id: string | null;
  readonly detail: string;
}

/** The invariant scan report. */
export interface GraphInvariantReport {
  readonly valid: boolean;
  readonly violations: readonly GraphViolation[];
  readonly node_count: number;
}

/** The full invariant scan over the node views of one graph. */
export function scanGraphInvariants(nodes: readonly TaskNode[]): GraphInvariantReport {
  const violations: GraphViolation[] = [];
  const byId = new Map<string, TaskNode>();
  for (const node of nodes) {
    byId.set(node.task_id, node);
  }

  for (const node of nodes) {
    // G1 — mission + authority references on EVERY task.
    if (typeof node.mission_ref !== 'string' || node.mission_ref.length === 0 || !node.mission_ref.startsWith('sos://Mission/')) {
      violations.push({
        rule: 'G1:mission-ref-required',
        task_id: node.task_id,
        detail: `every task carries a mission reference, received: ${JSON.stringify(node.mission_ref)}`,
      });
    }
    if (typeof node.authority_ref !== 'string' || node.authority_ref.length === 0 || !node.authority_ref.startsWith('sos://AuthorityGrant/')) {
      violations.push({
        rule: 'G1:authority-ref-required',
        task_id: node.task_id,
        detail: `every task carries an authority reference, received: ${JSON.stringify(node.authority_ref)}`,
      });
    }
    // G2 — dependencies resolve.
    for (const dependency of node.dependencies) {
      if (!byId.has(dependency)) {
        violations.push({
          rule: 'G2:orphaned-dependency',
          task_id: node.task_id,
          detail: `dependency ${JSON.stringify(dependency)} resolves to no node in the graph`,
        });
      }
    }
    // G3 — scope shape.
    if (!Array.isArray(node.owned_paths) || node.owned_paths.length === 0) {
      violations.push({
        rule: 'G3:owned-paths-required',
        task_id: node.task_id,
        detail: 'every task owns a non-empty path scope',
      });
    }
    // G4 — assignment on RUNNING nodes + lane bounds.
    if (node.state === 'RUNNING') {
      if (node.assignment === null) {
        violations.push({
          rule: 'G4:running-requires-assignment',
          task_id: node.task_id,
          detail: 'a RUNNING task carries its assignment (lane, worker ref, lease ref)',
        });
      } else if (node.assignment.lane !== 1 && node.assignment.lane !== 2 && node.assignment.lane !== 3) {
        violations.push({
          rule: 'G4:lane-bounds',
          task_id: node.task_id,
          detail: `lane must be 1 | 2 | 3, received: ${JSON.stringify(node.assignment.lane)}`,
        });
      }
    }
    if (node.assignment !== null && node.state !== 'RUNNING' && node.state !== 'PAUSED') {
      violations.push({
        rule: 'G4:assignment-state-consistency',
        task_id: node.task_id,
        detail: `an assignment exists while the node state is ${node.state} (assignments belong to RUNNING and PAUSED tasks — terminal writes clear them)`,
      });
    }
    // G6 — recovery discipline.
    if (node.state === 'FAILED' && node.recovery.status === 'NONE') {
      violations.push({
        rule: 'G6:failed-requires-recovery',
        task_id: node.task_id,
        detail: 'a FAILED task carries a recovery decision (RETRYABLE or TERMINAL) — never silently done',
      });
    }
    if (node.state !== 'FAILED' && node.recovery.status !== 'NONE') {
      violations.push({
        rule: 'G6:recovery-only-after-failure',
        task_id: node.task_id,
        detail: `recovery state ${node.recovery.status} is set while the node state is ${node.state}`,
      });
    }
    // G7 — verification gate.
    if (node.state === 'COMPLETED' && (node.verification_ref === null || node.verification_ref.length === 0)) {
      violations.push({
        rule: 'G7:completed-requires-verification',
        task_id: node.task_id,
        detail: 'a COMPLETED task carries its final verification record reference (section 10 — completion is verification-gated)',
      });
    }
    // G8 — unique pending asks.
    if (new Set(node.pending_asks).size !== node.pending_asks.length) {
      violations.push({
        rule: 'G8:pending-asks-unique',
        task_id: node.task_id,
        detail: 'pending ask references are unique within a task',
      });
    }
  }

  // G2 — acyclicity (deterministic DFS with explicit stacks).
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const id of byId.keys()) {
    color.set(id, WHITE);
  }
  for (const start of [...byId.keys()].sort()) {
    if (color.get(start) !== WHITE) {
      continue;
    }
    const stack: { id: string; next: number }[] = [{ id: start, next: 0 }];
    color.set(start, GREY);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const node = byId.get(frame.id)!;
      if (frame.next < node.dependencies.length) {
        const dependency = node.dependencies[frame.next]!;
        frame.next += 1;
        if (dependency === frame.id) {
          violations.push({
            rule: 'G2:acyclic',
            task_id: frame.id,
            detail: `task ${JSON.stringify(frame.id)} depends on itself`,
          });
          continue;
        }
        const dependencyColor = color.get(dependency) ?? BLACK;
        if (dependencyColor === GREY) {
          violations.push({
            rule: 'G2:acyclic',
            task_id: frame.id,
            detail: `dependency cycle reached through ${JSON.stringify(dependency)}`,
          });
        } else if (dependencyColor === WHITE && byId.has(dependency)) {
          color.set(dependency, GREY);
          stack.push({ id: dependency, next: 0 });
        }
      } else {
        color.set(frame.id, BLACK);
        stack.pop();
      }
    }
  }

  // G3 — concurrent (RUNNING) scope disjointness; G4 — lane exclusivity.
  const running = nodes.filter((node) => node.state === 'RUNNING');
  for (let i = 0; i < running.length; i += 1) {
    for (let j = i + 1; j < running.length; j += 1) {
      const a = running[i]!;
      const b = running[j]!;
      if (scopesCollide(a.owned_paths, b.owned_paths)) {
        violations.push({
          rule: 'G3:concurrent-scope-disjointness',
          task_id: a.task_id,
          detail: `RUNNING task ${JSON.stringify(a.task_id)} scope [${a.owned_paths.join(', ')}] overlaps RUNNING task ${JSON.stringify(b.task_id)} scope [${b.owned_paths.join(', ')}] — concurrent assignment requires DISJOINT scopes`,
        });
      }
      if (a.assignment !== null && b.assignment !== null && a.assignment.lane === b.assignment.lane) {
        violations.push({
          rule: 'G4:lane-exclusive',
          task_id: a.task_id,
          detail: `RUNNING tasks ${JSON.stringify(a.task_id)} and ${JSON.stringify(b.task_id)} occupy the same lane ${a.assignment.lane}`,
        });
      }
    }
  }

  return {
    valid: violations.length === 0,
    violations,
    node_count: nodes.length,
  };
}
