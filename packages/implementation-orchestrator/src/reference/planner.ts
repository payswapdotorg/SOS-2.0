/**
 * THE REFERENCE ARCHITECTURE PLANNER (Work Order P13) — the deterministic,
 * offline stand-in behind the ArchitecturePlannerPort seam.
 *
 * Produces the typed ImplementationPlan for the flagship greenfield
 * journey from the FORMALIZED mission (a mission without goals cannot be
 * planned -> typed ASK, the honest refusal):
 *
 *   - CAPABILITY REQUIREMENTS: the §3 capabilities the journey's bodies
 *     must advertise (terminal + filesystem + repository-operations —
 *     the coding-body set) and the evaluation capability (the P9
 *     evaluator suite);
 *   - CANDIDATE STRUCTURE: one component per mission GOAL (plus a
 *     scaffold component every implementation depends on), each with a
 *     DISJOINT owned-path scope, deterministic file contents, cloud
 *     placement and its P9 evaluation gate;
 *   - ASSURANCE CONSTRAINTS: the P9 evaluator types that gate completion
 *     (tests + static-contract-checks at the node level; the full
 *     journey-level gate adds deployment/runtime/security checks);
 *   - the bounded repair attempts (the P9 repair discipline).
 *
 * The planner is a MECHANISM: its output is typed records re-validated by
 * this package's structural guards, never authority. A real reasoning
 * provider attaches behind the same seam later without contract change.
 */

import type { MissionArtifact } from '@sos-2/mission';
import { mintPipelineAsk } from '../asks.js';
import { buildImplementationPlan } from '../planning.js';
import type {
  ArchitecturePlannerPort,
  AssuranceConstraint,
  CapabilityRequirement,
  ImplementationPlan,
  PlannedComponent,
  PlanningOutcome,
} from '../planning.js';

/** Options: the planning instant is caller-supplied (no hidden clocks). */
export interface ReferenceArchitecturePlannerOptions {
  /** RFC3339 planning instant (caller-supplied). */
  readonly createdAt: string;
  /** The bounded repair attempts (default 2 — the P9 discipline). */
  readonly maxRepairAttempts?: number;
}

/** The body capabilities the reference journey's coding components require. */
export const REFERENCE_CODING_CAPABILITIES = ['terminal', 'filesystem', 'repository-operations'] as const;

/** The node-level evaluation gate of the reference journey. */
export const REFERENCE_NODE_EVALUATION_TYPES = ['tests', 'static-contract-checks'] as const;

/**
 * The scaffold component id (the reference planner's repository-
 * provisioning component every goal component depends on).
 */
export const SCAFFOLD_COMPONENT_ID = 'scaffold';

export class ReferenceArchitecturePlanner implements ArchitecturePlannerPort {
  private readonly options: ReferenceArchitecturePlannerOptions;

  constructor(options: ReferenceArchitecturePlannerOptions) {
    if (typeof options !== 'object' || options === null || typeof options.createdAt !== 'string' || options.createdAt.length === 0) {
      throw new TypeError('ReferenceArchitecturePlanner requires a caller-supplied createdAt RFC3339 instant (no hidden clocks)');
    }
    this.options = options;
  }

  plan(input: { readonly mission: MissionArtifact }): PlanningOutcome {
    const mission = input.mission;
    if (mission.content.goals.length === 0) {
      return {
        kind: 'ASK',
        ask: mintPipelineAsk({
          stage: 'PLANNING',
          reasonCode: 'MISSION_NOT_FORMALIZED',
          detail:
            'the mission carries no goals — an implementation plan decomposes over formalized goals, and the planner never invents scope the mission does not state',
          openQuestions: ['Which goals must the implementation deliver?'],
          context: { missionRef: mission.envelope.id, purpose: mission.content.purpose },
          createdAt: this.options.createdAt,
        }),
      };
    }

    const capabilityRequirements: CapabilityRequirement[] = [
      {
        id: 'capability-coding-body',
        description: 'A coding body advertising terminal, filesystem and repository-operations capabilities (§3 vocabulary).',
        harnessCapabilities: [...REFERENCE_CODING_CAPABILITIES],
      },
      {
        id: 'capability-independent-evaluation',
        description: 'The P9 independent evaluator suite gates every node and the journey completion.',
        harnessCapabilities: ['terminal', 'filesystem'],
      },
    ];

    const assuranceConstraints: AssuranceConstraint[] = [
      { id: 'assurance-tests', description: 'The P9 tests evaluator must pass.', evaluationType: 'tests' },
      { id: 'assurance-static-contract-checks', description: 'The P9 static/contract checks evaluator must pass.', evaluationType: 'static-contract-checks' },
      { id: 'assurance-deployment-checks', description: 'The deployment checks evaluator must pass for the deployed revision.', evaluationType: 'deployment-checks' },
      { id: 'assurance-runtime-verification', description: 'The runtime-verification evaluator must pass for the deployed revision.', evaluationType: 'runtime-verification' },
      { id: 'assurance-security-checks', description: 'The security-checks evaluator must pass for the deployed revision.', evaluationType: 'security-checks' },
    ];

    const components: PlannedComponent[] = [
      referenceScaffoldComponent(mission),
      ...mission.content.goals.map((goal, index) => referenceGoalComponent(goal.id, goal.statement, index)),
    ];

    const plan: ImplementationPlan = buildImplementationPlan({
      missionRef: mission.envelope.id,
      createdAt: this.options.createdAt,
      capabilityRequirements,
      assuranceConstraints,
      components,
      maxRepairAttempts: this.options.maxRepairAttempts ?? 2,
    });
    return { kind: 'PLANNED', plan };
  }
}

/** The scaffold component every goal component depends on (workspace provisioning). */
function referenceScaffoldComponent(mission: MissionArtifact): PlannedComponent {
  return {
    id: 'scaffold',
    title: 'Provision the repository scaffold',
    ownedPaths: ['README.md', 'sos-manifest.json'],
    files: [
      {
        path: 'README.md',
        contents: `# ${mission.content.purpose}\n\nRealized by the SOS 2.0 mission-to-implementation pipeline.\n`,
      },
      {
        path: 'sos-manifest.json',
        contents:
          '{"mission_ref":' +
          JSON.stringify(mission.envelope.id) +
          ',"generated_by":"sos-2 mission-to-implementation pipeline (reference planner)"}\n',
      },
    ],
    requiredCapabilities: [...REFERENCE_CODING_CAPABILITIES],
    placement: 'cloud',
    evaluationTypes: [...REFERENCE_NODE_EVALUATION_TYPES],
    dependsOn: [],
  };
}

/** One goal component: deterministic file contents under a disjoint scope. */
function referenceGoalComponent(goalId: string, statement: string, index: number): PlannedComponent {
  const scope = `src/${goalId}`;
  const moduleFile = `${scope}/module.ts`;
  const testFile = `${scope}/module.test.ts`;
  return {
    id: goalId,
    title: `Implement: ${statement}`,
    ownedPaths: [scope],
    files: [
      {
        path: moduleFile,
        contents: referenceModuleContents(goalId, statement, index),
      },
      {
        path: testFile,
        contents: referenceTestContents(goalId),
      },
    ],
    requiredCapabilities: [...REFERENCE_CODING_CAPABILITIES],
    placement: 'cloud',
    evaluationTypes: [...REFERENCE_NODE_EVALUATION_TYPES],
    dependsOn: ['scaffold'],
  };
}

/** Deterministic module contents (the reference implementation of the goal). */
export function referenceModuleContents(goalId: string, statement: string, index: number): string {
  return [
    '/**',
    ` * ${statement}`,
    ' *',
    ` * Component ${goalId} of the mission implementation (deterministic reference output).`,
    ' */',
    '',
    `export const componentId = ${JSON.stringify(goalId)};`,
    `export const componentIndex = ${index};`,
    `export const statement = ${JSON.stringify(statement)};`,
    '',
    'export function deliver(): string {',
    `  return ${JSON.stringify(`${goalId}: ${statement}`)};`,
    '}',
    '',
  ].join('\n');
}

/** Deterministic test contents (the reference checks of the goal). */
export function referenceTestContents(goalId: string): string {
  return [
    '/**',
    ` * Reference checks for component ${goalId}.`,
    ' */',
    '',
    `import { componentId, deliver, statement } from './module.js';`,
    '',
    'export function runReferenceChecks(): { check: string; passed: boolean }[] {',
    '  return [',
    `    { check: ${JSON.stringify(`${goalId}:component-id`)}, passed: componentId === ${JSON.stringify(goalId)} },`,
    `    { check: ${JSON.stringify(`${goalId}:deliver-statement`)}, passed: deliver().startsWith(componentId + ':') },`,
    `    { check: ${JSON.stringify(`${goalId}:statement-non-empty`)}, passed: statement.length > 0 },`,
    '  ];',
    '}',
    '',
  ].join('\n');
}
